-- Keep the public quotation resume token single-use and align cancellation with the existing decline workflow.
CREATE OR REPLACE FUNCTION public.resume_public_loan_application_by_id_number(p_id_number text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, private, extensions, pg_catalog
AS $function$
DECLARE v_fingerprint text; v_app public.loan_applications%ROWTYPE; v_token text; v_result jsonb;
BEGIN
  v_fingerprint := private.id_number_fingerprint(p_id_number);
  IF v_fingerprint IS NULL THEN RAISE EXCEPTION 'A valid 13-digit South African ID number is required.'; END IF;
  SELECT a.* INTO v_app FROM public.loan_applications a
  JOIN private.id_number_fingerprints f ON f.entity_type='loan_application' AND f.entity_id=a.id AND f.fingerprint=v_fingerprint
  WHERE a.status='OFFER_READY' AND a.offer_status IN ('ISSUED','ACCEPTED') AND a.offer_expires_at>now() AND a.approved_loan_id IS NULL
  ORDER BY a.created_at DESC LIMIT 1 FOR UPDATE OF a;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.loan_application_upload_tokens SET used_at=COALESCE(used_at,now()) WHERE application_id=v_app.id AND used_at IS NULL;
  v_token := encode(gen_random_bytes(32),'hex');
  INSERT INTO public.loan_application_upload_tokens(application_id,token_hash,expires_at,max_files,max_file_size_bytes)
  VALUES(v_app.id,encode(digest(v_token,'sha256'),'hex'),now()+interval '24 hours',10,10485760);
  SELECT jsonb_build_object(
    'application_id',v_app.id,'application_number',v_app.application_number,'upload_token',v_token,
    'status',v_app.status,'offer_status',v_app.offer_status,'offer_amount',v_app.offer_amount,
    'offer_term_months',v_app.offer_term_months,'offer_interest_amount',v_app.offer_interest_amount,
    'offer_total_repayment',v_app.offer_total_repayment,'offer_monthly_repayment',v_app.offer_monthly_repayment,
    'offer_expires_at',v_app.offer_expires_at,'preferred_payment_date',v_app.preferred_payment_date,
    'monthly_expenses_total',v_app.monthly_expenses_total,'disposable_income',v_app.disposable_income,
    'affordability_status',v_app.affordability_status,'affordability_reason',v_app.affordability_reason,
    'form',jsonb_build_object('first_name',v_app.first_name,'last_name',v_app.last_name,'cellphone',v_app.cellphone,
      'email',v_app.email,'physical_address',v_app.physical_address,'work_address',v_app.work_address,
      'work_telephone',v_app.work_telephone,'employer',v_app.employer,'employment_status',v_app.employment_status,
      'monthly_income',v_app.monthly_income,'other_income',v_app.other_income,'bank_name',v_app.bank_name,
      'account_number',v_app.account_number,'amount_requested',v_app.amount_requested,'loan_purpose',v_app.loan_purpose,
      'preferred_payment_date',v_app.preferred_payment_date,'collection_preference',v_app.collection_preference,'notes',v_app.notes),
    'expenses',COALESCE((SELECT jsonb_agg(jsonb_build_object('category',e.expense_category,'description',e.description,'monthly_amount',e.monthly_amount)
      ORDER BY e.created_at,e.expense_category) FROM public.loan_application_expenses e WHERE e.application_id=v_app.id),'[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_unfinished_public_application(p_application_id uuid,p_id_number text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,private,pg_catalog
AS $function$
DECLARE v_fingerprint text; v_app public.loan_applications%ROWTYPE;
BEGIN
  v_fingerprint:=private.id_number_fingerprint(p_id_number);
  IF v_fingerprint IS NULL THEN RAISE EXCEPTION 'A valid 13-digit South African ID number is required.'; END IF;
  SELECT a.* INTO v_app FROM public.loan_applications a
  JOIN private.id_number_fingerprints f ON f.entity_type='loan_application' AND f.entity_id=a.id AND f.fingerprint=v_fingerprint
  WHERE a.id=p_application_id FOR UPDATE OF a;
  IF NOT FOUND THEN RAISE EXCEPTION 'The unfinished application could not be verified.'; END IF;
  IF v_app.status<>'OFFER_READY' OR v_app.offer_status NOT IN ('ISSUED','ACCEPTED') OR v_app.approved_loan_id IS NOT NULL
  THEN RAISE EXCEPTION 'Only an unfinished quotation can be cancelled here.'; END IF;
  UPDATE public.loan_funding_reservations SET reservation_status='RELEASED',updated_at=now()
    WHERE application_id=v_app.id AND reservation_status='RESERVED';
  UPDATE public.loan_funding_bookings SET queue_status='CANCELLED',updated_at=now()
    WHERE application_id=v_app.id AND queue_status NOT IN ('CANCELLED','FUNDED');
  UPDATE public.loan_application_upload_tokens SET used_at=COALESCE(used_at,now()) WHERE application_id=v_app.id;
  UPDATE public.loan_applications SET status='CANCELLED',offer_status='DECLINED',updated_at=now() WHERE id=v_app.id;
  RETURN jsonb_build_object('success',true,'application_number',v_app.application_number);
END;
$function$;
REVOKE ALL ON FUNCTION public.resume_public_loan_application_by_id_number(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_unfinished_public_application(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resume_public_loan_application_by_id_number(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_unfinished_public_application(uuid,text) TO anon, authenticated;
