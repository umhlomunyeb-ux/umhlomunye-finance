-- Expire stale quotations and release reservations so the queue can safely re-offer.
CREATE OR REPLACE FUNCTION public.expire_public_loan_offers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.loan_applications
    SET offer_status='EXPIRED',status='WAITING_FOR_FUNDS',
        offer_expires_at=NULL,updated_at=now()
    WHERE offer_status='ISSUED' AND offer_expires_at<=now()
      AND status='OFFER_READY'
    RETURNING id
  )
  UPDATE public.loan_funding_bookings b
  SET queue_status='WAITING_FOR_FUNDS',last_checked_at=now(),updated_at=now()
  WHERE b.application_id IN (SELECT id FROM expired);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  UPDATE public.loan_funding_reservations r
  SET reservation_status='RELEASED',updated_at=now()
  WHERE r.reservation_status='RESERVED'
    AND r.expires_at<=now()
    AND EXISTS (SELECT 1 FROM public.loan_applications a
      WHERE a.id=r.application_id AND a.status='OFFER_READY' AND a.offer_status='ISSUED');
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_public_loan_offers() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.expire_public_loan_offers() TO service_role;

-- Customer can decline an issued or accepted quotation even if its reservation has expired.
CREATE OR REPLACE FUNCTION public.accept_public_loan_offer(
  p_application_id uuid,p_upload_token text,p_accept boolean,p_acceptance_ip text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_app public.loan_applications%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.loan_application_upload_tokens t
    WHERE t.application_id=p_application_id
      AND t.token_hash=encode(digest(trim(coalesce(p_upload_token,'')),'sha256'),'hex')
      AND t.expires_at>now() AND t.used_at IS NULL)
    THEN RAISE EXCEPTION 'The application security token is invalid or expired.'; END IF;
  SELECT * INTO v_app FROM public.loan_applications WHERE id=p_application_id FOR UPDATE;
  IF NOT FOUND OR v_app.offer_status NOT IN ('ISSUED','ACCEPTED') THEN
    RAISE EXCEPTION 'This quotation is no longer available.';
  END IF;

  IF NOT p_accept THEN
    UPDATE public.loan_applications SET offer_status='DECLINED',status='CANCELLED',updated_at=now()
    WHERE id=p_application_id;
    UPDATE public.loan_funding_reservations SET reservation_status='RELEASED',updated_at=now()
    WHERE application_id=p_application_id AND reservation_status='RESERVED';
    UPDATE public.loan_funding_bookings SET queue_status='CANCELLED',updated_at=now()
    WHERE application_id=p_application_id;
    RETURN jsonb_build_object('success',true,'status','DECLINED','message','Quotation declined and reserved funds released.');
  END IF;

  IF v_app.offer_status<>'ISSUED' OR v_app.offer_expires_at IS NULL OR v_app.offer_expires_at<=now() THEN
    RAISE EXCEPTION 'This quotation has expired. Your application will return to the funding queue.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.loan_funding_reservations r
    JOIN public.bank_accounts ba ON ba.id=r.bank_account_id
    WHERE r.application_id=p_application_id AND r.reservation_status='RESERVED'
      AND r.expires_at>now() AND ba.is_active=true AND ba.is_verified=true
      AND r.reserved_amount>=v_app.offer_amount
  ) THEN RAISE EXCEPTION 'The reserved company funds are no longer available. Your application will return to the funding queue.'; END IF;

  UPDATE public.loan_applications SET offer_status='ACCEPTED',offer_accepted_at=now(),
    offer_acceptance_ip=p_acceptance_ip,updated_at=now() WHERE id=p_application_id;
  RETURN jsonb_build_object('success',true,'status','ACCEPTED','message','Quotation accepted. Your final loan agreement will now be prepared.');
END;
$$;
REVOKE ALL ON FUNCTION public.accept_public_loan_offer(uuid,text,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_public_loan_offer(uuid,text,boolean,text) TO anon,authenticated;

-- Run expiry before checking the queue each minute.
DO $$
DECLARE v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname='umhlomunye-funding-queue-every-minute' LIMIT 1;
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
  PERFORM cron.schedule('umhlomunye-funding-queue-every-minute','* * * * *',
    'select public.expire_public_loan_offers(); select public.process_funding_queue();');
END;
$$;
