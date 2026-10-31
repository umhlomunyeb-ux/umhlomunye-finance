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
    'offer_expires_at',a.offer_expires_at,
    'preferred_payment_date',a.preferred_payment_date,
    'interest_rate',s.tier_1_interest_rate,
    'signing_token',la.signing_token,
    'agreement_number',la.agreement_number
  ) INTO v_result
  FROM public.loan_applications a
  LEFT JOIN LATERAL (
    SELECT ss.tier_1_interest_rate
    FROM public.system_settings ss
    ORDER BY ss.updated_at DESC LIMIT 1
  ) s ON true
  LEFT JOIN public.loan_agreements la ON la.loan_id=a.approved_loan_id
  WHERE a.id=p_application_id
  ORDER BY la.created_at DESC NULLS LAST
  LIMIT 1;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_application_offer(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_application_offer(uuid,text) TO anon,authenticated;
