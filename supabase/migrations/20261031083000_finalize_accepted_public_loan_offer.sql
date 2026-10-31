-- Finalize an accepted, funded public quotation through the existing loan/agreement workflow.
CREATE OR REPLACE FUNCTION public.finalize_accepted_public_loan_offer(
  p_application_id uuid,
  p_upload_token text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.loan_applications%ROWTYPE;
  v_admin_id uuid;
  v_reservation public.loan_funding_reservations%ROWTYPE;
  v_approval json;
  v_agreement record;
  v_previous_sub text;
BEGIN
  IF current_user <> 'postgres' AND current_setting('request.jwt.claim.role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required to finalize an accepted public quotation.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.loan_application_upload_tokens t
    WHERE t.application_id=p_application_id
      AND t.token_hash=encode(digest(trim(coalesce(p_upload_token,'')),'sha256'),'hex')
      AND t.expires_at>now() AND t.used_at IS NULL
  ) THEN
    RAISE EXCEPTION 'The application security token is invalid or expired.';
  END IF;

  SELECT * INTO v_app
  FROM public.loan_applications
  WHERE id=p_application_id
  FOR UPDATE;

  IF NOT FOUND OR v_app.offer_status <> 'ACCEPTED'
     OR v_app.offer_accepted_at IS NULL
     OR v_app.status <> 'OFFER_READY' THEN
    RAISE EXCEPTION 'This quotation has not been accepted or is no longer ready for finalization.';
  END IF;

  IF v_app.offer_expires_at IS NULL OR v_app.offer_expires_at <= now() THEN
    RAISE EXCEPTION 'The accepted quotation has expired.';
  END IF;

  SELECT * INTO v_reservation
  FROM public.loan_funding_reservations
  WHERE application_id=p_application_id
    AND reservation_status='RESERVED'
    AND expires_at>now()
  FOR UPDATE;

  IF NOT FOUND OR v_reservation.reserved_amount < v_app.offer_amount
     OR NOT EXISTS (
       SELECT 1 FROM public.bank_accounts ba
       WHERE ba.id=v_reservation.bank_account_id
         AND ba.is_active=true AND ba.is_verified=true
     ) THEN
    RAISE EXCEPTION 'The company funding reservation is no longer valid.';
  END IF;

  SELECT u.id INTO v_admin_id
  FROM public.users u
  WHERE lower(u.role)='admin'
    AND u.is_active=true
    AND coalesce(u.is_deleted,false)=false
  ORDER BY u.created_at
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'No active administrator is available to authorize the system-generated loan record.';
  END IF;

  v_previous_sub := current_setting('request.jwt.claim.sub', true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

  -- The legacy approval routine is deliberately reused so customer creation,
  -- first-time borrower enforcement, loan creation and agreement generation stay centralized.
  UPDATE public.loan_applications
  SET status='PENDING', updated_at=now()
  WHERE id=p_application_id;

  v_approval := public.approve_loan_application(p_application_id, v_admin_id);

  PERFORM set_config('request.jwt.claim.sub', coalesce(v_previous_sub,''), true);

  SELECT la.id,la.signing_token,la.agreement_number,la.status
  INTO v_agreement
  FROM public.loan_agreements la
  WHERE la.loan_id=(v_approval->>'loan_id')::uuid
  ORDER BY la.created_at DESC
  LIMIT 1;

  IF v_agreement.id IS NULL OR v_agreement.signing_token IS NULL THEN
    RAISE EXCEPTION 'Loan was created but its electronic signing agreement could not be loaded.';
  END IF;

  RETURN jsonb_build_object(
    'success',true,
    'application_id',p_application_id,
    'loan_id',v_approval->>'loan_id',
    'loan_number',v_approval->>'loan_number',
    'agreement_id',v_agreement.id,
    'agreement_number',v_agreement.agreement_number,
    'signing_token',v_agreement.signing_token,
    'principal_amount',v_approval->>'principal_amount',
    'total_repayment',v_approval->>'total_repayment',
    'term_months',v_approval->>'term_months',
    'monthly_repayment',v_approval->>'monthly_repayment'
  );
EXCEPTION WHEN OTHERS THEN
  IF v_previous_sub IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub',v_previous_sub,true);
  END IF;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_accepted_public_loan_offer(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_accepted_public_loan_offer(uuid,text) TO service_role;
