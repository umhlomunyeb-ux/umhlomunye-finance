-- Calculate verified company cash available after all active funding reservations.
CREATE OR REPLACE FUNCTION public.get_company_funding_position()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH verified AS (
    SELECT ba.id,ba.opening_balance,
      COALESCE((
        SELECT bt.balance_after
        FROM public.bank_transactions bt
        WHERE bt.bank_account_id=ba.id AND COALESCE(bt.is_void,false)=false
        ORDER BY bt.transaction_date DESC,bt.created_at DESC
        LIMIT 1
      ),ba.opening_balance) AS ledger_balance
    FROM public.bank_accounts ba
    WHERE ba.is_active=true AND ba.is_verified=true
  ),
  reserved AS (
    SELECT bank_account_id,COALESCE(SUM(reserved_amount),0) AS reserved_amount
    FROM public.loan_funding_reservations
    WHERE reservation_status='RESERVED' AND (expires_at IS NULL OR expires_at>now())
    GROUP BY bank_account_id
  )
  SELECT jsonb_build_object(
    'verified_account_count',(SELECT COUNT(*) FROM verified),
    'ledger_balance',COALESCE((SELECT SUM(ledger_balance) FROM verified),0),
    'active_reservations',COALESCE((SELECT SUM(reserved_amount) FROM reserved),0),
    'available_funds',COALESCE((
      SELECT SUM(v.ledger_balance-COALESCE(r.reserved_amount,0))
      FROM verified v LEFT JOIN reserved r ON r.bank_account_id=v.id
    ),0)
  );
$$;
REVOKE ALL ON FUNCTION public.get_company_funding_position() FROM PUBLIC,anon,authenticated;

-- Reserve money for the oldest eligible queue items. This function is service-role only.
CREATE OR REPLACE FUNCTION public.process_funding_queue()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record;
  v_account record;
  v_position jsonb;
  v_available numeric(14,2);
  v_remaining numeric(14,2);
  v_ready jsonb := '[]'::jsonb;
  v_reserved numeric(14,2) := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required to process funding queue.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('umhlomunye-funding-queue'));
  v_position := public.get_company_funding_position();
  v_available := COALESCE((v_position->>'available_funds')::numeric,0);
  v_remaining := v_available;

  FOR v_booking IN
    SELECT b.*,a.application_number,a.first_name,a.last_name,a.affordability_status,
           a.offer_amount,a.offer_term_months,a.offer_monthly_repayment,
           a.offer_interest_amount,a.offer_total_repayment
    FROM public.loan_funding_bookings b
    JOIN public.loan_applications a ON a.id=b.application_id
    WHERE b.queue_status='WAITING_FOR_FUNDS'
      AND a.affordability_status='AFFORDABLE'
      AND a.status='WAITING_FOR_FUNDS'
      AND (b.preferred_funding_date IS NULL OR b.preferred_funding_date<=current_date)
    ORDER BY b.preferred_funding_date NULLS FIRST,b.booked_at,b.id
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF v_booking.requested_amount > v_remaining THEN
      UPDATE public.loan_funding_bookings SET last_checked_at=now()
      WHERE id=v_booking.id;
      CONTINUE;
    END IF;

    SELECT ba.id,
      COALESCE((
        SELECT bt.balance_after FROM public.bank_transactions bt
        WHERE bt.bank_account_id=ba.id AND COALESCE(bt.is_void,false)=false
        ORDER BY bt.transaction_date DESC,bt.created_at DESC LIMIT 1
      ),ba.opening_balance)
      - COALESCE((
        SELECT SUM(fr.reserved_amount) FROM public.loan_funding_reservations fr
        WHERE fr.bank_account_id=ba.id AND fr.reservation_status='RESERVED'
          AND (fr.expires_at IS NULL OR fr.expires_at>now())
      ),0) AS account_available
    INTO v_account
    FROM public.bank_accounts ba
    WHERE ba.is_active=true AND ba.is_verified=true
    ORDER BY account_available DESC
    FOR UPDATE OF ba
    LIMIT 1;

    IF v_account.id IS NULL OR v_account.account_available < v_booking.requested_amount THEN
      UPDATE public.loan_funding_bookings SET last_checked_at=now()
      WHERE id=v_booking.id;
      CONTINUE;
    END IF;

    INSERT INTO public.loan_funding_reservations(
      application_id,bank_account_id,reserved_amount,reservation_status,expires_at
    ) VALUES (
      v_booking.application_id,v_account.id,v_booking.requested_amount,'RESERVED',now()+interval '24 hours'
    )
    ON CONFLICT (application_id) DO UPDATE SET
      bank_account_id=EXCLUDED.bank_account_id,
      reserved_amount=EXCLUDED.reserved_amount,
      reservation_status='RESERVED',
      expires_at=EXCLUDED.expires_at,
      updated_at=now();

    UPDATE public.loan_funding_bookings
    SET queue_status='READY_FOR_OFFER',last_checked_at=now(),updated_at=now()
    WHERE id=v_booking.id;

    UPDATE public.loan_applications
    SET status='OFFER_READY',offer_status='ISSUED',
        offer_expires_at=now()+interval '24 hours',
        funding_available_at=now(),updated_at=now()
    WHERE id=v_booking.application_id;

    v_remaining := v_remaining-v_booking.requested_amount;
    v_reserved := v_reserved+v_booking.requested_amount;
    v_ready := v_ready || jsonb_build_array(jsonb_build_object(
      'application_id',v_booking.application_id,
      'application_number',v_booking.application_number,
      'customer_name',trim(v_booking.first_name||' '||v_booking.last_name),
      'requested_amount',v_booking.requested_amount,
      'available_funds_before',v_available,
      'total_funding_required',v_reserved,
      'remaining_after',v_remaining,
      'offer_term_months',v_booking.offer_term_months,
      'monthly_repayment',v_booking.offer_monthly_repayment,
      'total_repayment',v_booking.offer_total_repayment
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'funding_position',v_position,
    'newly_fundable',v_ready,
    'total_reserved',v_reserved,
    'remaining_funds',v_remaining
  );
END;
$$;
REVOKE ALL ON FUNCTION public.process_funding_queue() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_funding_queue() TO service_role;

-- Public status lookup and acceptance are protected by the one-time application token.
CREATE OR REPLACE FUNCTION public.get_public_application_offer(
  p_application_id uuid,
  p_upload_token text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.loan_application_upload_tokens t
    WHERE t.application_id=p_application_id
      AND t.token_hash=encode(digest(trim(coalesce(p_upload_token,'')),'sha256'),'hex')
      AND t.expires_at>now() AND t.used_at IS NULL
  ) THEN RAISE EXCEPTION 'The application security token is invalid or expired.'; END IF;
  SELECT jsonb_build_object(
    'application_number',a.application_number,
    'status',a.status,
    'offer_status',a.offer_status,
    'offer_amount',a.offer_amount,
    'offer_term_months',a.offer_term_months,
    'offer_interest_amount',a.offer_interest_amount,
    'offer_total_repayment',a.offer_total_repayment,
    'offer_monthly_repayment',a.offer_monthly_repayment,
    'offer_expires_at',a.offer_expires_at
  ) INTO v_result
  FROM public.loan_applications a WHERE a.id=p_application_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_public_loan_offer(
  p_application_id uuid,
  p_upload_token text,
  p_accept boolean,
  p_acceptance_ip text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_app public.loan_applications%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.loan_application_upload_tokens t
    WHERE t.application_id=p_application_id
      AND t.token_hash=encode(digest(trim(coalesce(p_upload_token,'')),'sha256'),'hex')
      AND t.expires_at>now() AND t.used_at IS NULL
  ) THEN RAISE EXCEPTION 'The application security token is invalid or expired.'; END IF;
  SELECT * INTO v_app FROM public.loan_applications WHERE id=p_application_id FOR UPDATE;
  IF NOT FOUND OR v_app.offer_status<>'ISSUED' OR v_app.offer_expires_at<=now() THEN
    RAISE EXCEPTION 'This quotation is no longer available.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.loan_funding_reservations r
    JOIN public.bank_accounts ba ON ba.id=r.bank_account_id
    WHERE r.application_id=p_application_id
      AND r.reservation_status='RESERVED' AND r.expires_at>now()
      AND ba.is_active=true AND ba.is_verified=true
      AND r.reserved_amount>=v_app.offer_amount
  ) THEN RAISE EXCEPTION 'The reserved company funds are no longer available. Your application will return to the funding queue.'; END IF;

  IF p_accept THEN
    UPDATE public.loan_applications SET
      offer_status='ACCEPTED',offer_accepted_at=now(),
      offer_acceptance_ip=p_acceptance_ip,updated_at=now()
    WHERE id=p_application_id;
    RETURN jsonb_build_object('success',true,'status','ACCEPTED','message','Quotation accepted. Your final loan agreement will now be prepared.');
  ELSE
    UPDATE public.loan_applications SET offer_status='DECLINED',status='CANCELLED',updated_at=now()
    WHERE id=p_application_id;
    UPDATE public.loan_funding_reservations SET reservation_status='RELEASED',updated_at=now()
    WHERE application_id=p_application_id AND reservation_status='RESERVED';
    UPDATE public.loan_funding_bookings SET queue_status='CANCELLED',updated_at=now()
    WHERE application_id=p_application_id;
    RETURN jsonb_build_object('success',true,'status','DECLINED','message','Quotation declined and reserved funds released.');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_application_offer(uuid,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accept_public_loan_offer(uuid,text,boolean,text) TO anon,authenticated;
