
CREATE OR REPLACE FUNCTION public.prepare_public_application_funding(
  p_application_id uuid,
  p_upload_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, extensions
AS $function$
DECLARE
  v_app public.loan_applications%ROWTYPE;
  v_account_id uuid;
  v_account_available numeric(14,2);
  v_position jsonb;
  v_available numeric(14,2);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.loan_application_upload_tokens t
    WHERE t.application_id=p_application_id
      AND t.token_hash=encode(digest(trim(coalesce(p_upload_token,'')),'sha256'),'hex')
      AND t.expires_at>now() AND t.used_at IS NULL
  ) THEN
    RAISE EXCEPTION 'The application security token is invalid or expired.';
  END IF;

  SELECT * INTO v_app FROM public.loan_applications WHERE id=p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found.'; END IF;
  IF v_app.affordability_status <> 'AFFORDABLE' THEN
    RETURN jsonb_build_object('sufficient',false,'reason','NOT_AFFORDABLE');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('umhlomunye-public-application-funding'));

  SELECT r.bank_account_id, r.reserved_amount
  INTO v_account_id, v_account_available
  FROM public.loan_funding_reservations r
  JOIN public.bank_accounts ba ON ba.id=r.bank_account_id
  WHERE r.application_id=p_application_id
    AND r.reservation_status='RESERVED'
    AND r.reserved_amount>=v_app.amount_requested
    AND (r.expires_at IS NULL OR r.expires_at>now())
    AND ba.is_active=true AND ba.is_verified=true
  LIMIT 1;

  IF v_account_id IS NOT NULL THEN
    v_position := public.get_company_funding_position();
    RETURN jsonb_build_object('sufficient',true,
      'available_funds',COALESCE((v_position->>'available_funds')::numeric,0),
      'reserved_amount',v_app.amount_requested,'reservation_exists',true);
  END IF;

  SELECT ba.id,
    round(
      COALESCE((SELECT bt.balance_after FROM public.bank_transactions bt
        WHERE bt.bank_account_id=ba.id AND COALESCE(bt.is_void,false)=false
        ORDER BY bt.transaction_date DESC,bt.created_at DESC LIMIT 1),ba.opening_balance)
      - COALESCE((SELECT SUM(fr.reserved_amount) FROM public.loan_funding_reservations fr
        WHERE fr.bank_account_id=ba.id AND fr.reservation_status='RESERVED'
          AND (fr.expires_at IS NULL OR fr.expires_at>now())),0),2
    ) AS available
  INTO v_account_id,v_account_available
  FROM public.bank_accounts ba
  WHERE ba.is_active=true AND ba.is_verified=true
  ORDER BY available DESC,ba.created_at
  LIMIT 1
  FOR UPDATE OF ba;

  v_account_available := COALESCE(v_account_available,0);
  IF v_account_id IS NULL OR v_account_available < v_app.amount_requested THEN
    v_position := public.get_company_funding_position();
    v_available := greatest(COALESCE((v_position->>'available_funds')::numeric,0),0);
    RETURN jsonb_build_object('sufficient',false,
      'available_funds',v_available,'requested_amount',v_app.amount_requested,
      'shortfall',round(greatest(v_app.amount_requested-v_available,0),2));
  END IF;

  INSERT INTO public.loan_funding_reservations(
    application_id,bank_account_id,reserved_amount,reservation_status,expires_at
  ) VALUES (p_application_id,v_account_id,v_app.amount_requested,'RESERVED',now()+interval '24 hours')
  ON CONFLICT (application_id) DO UPDATE SET
    bank_account_id=EXCLUDED.bank_account_id,reserved_amount=EXCLUDED.reserved_amount,
    reservation_status='RESERVED',expires_at=EXCLUDED.expires_at,updated_at=now();

  UPDATE public.loan_applications
  SET status='OFFER_READY',offer_status='ISSUED',offer_expires_at=now()+interval '24 hours',
      funding_available_at=now(),funding_decision='AUTO_RESERVED',updated_at=now()
  WHERE id=p_application_id;

  v_position := public.get_company_funding_position();
  RETURN jsonb_build_object('sufficient',true,
    'available_funds',COALESCE((v_position->>'available_funds')::numeric,0),
    'reserved_amount',v_app.amount_requested,'reservation_exists',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.prepare_public_application_funding(uuid,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_public_application_expenses(
  p_application_id uuid,p_upload_token text,p_expenses jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, extensions
AS $function$
DECLARE
  v_valid boolean;
  v_total numeric(14,2);
  v_item jsonb;
  v_assessment jsonb;
  v_funding jsonb;
  v_category text;
  v_required_categories text[] := ARRAY[
    'Grocery','Housing','Clothing','Transportation',
    'Existing Loan Repayments','Other Expenses'
  ];
BEGIN
  IF p_application_id IS NULL OR NULLIF(trim(p_upload_token),'') IS NULL THEN
    RAISE EXCEPTION 'Application and secure upload token are required.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.loan_application_upload_tokens t
    JOIN public.loan_applications a ON a.id=t.application_id
    WHERE t.application_id=p_application_id
      AND t.token_hash=encode(digest(trim(p_upload_token),'sha256'),'hex')
      AND t.expires_at>now() AND t.used_at IS NULL AND a.status='PENDING'
  ) INTO v_valid;
  IF NOT v_valid THEN RAISE EXCEPTION 'The application security token is invalid or expired.'; END IF;

  IF jsonb_typeof(COALESCE(p_expenses,'[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Expenses must be supplied as a list.';
  END IF;
  IF jsonb_array_length(COALESCE(p_expenses,'[]'::jsonb)) > 40 THEN
    RAISE EXCEPTION 'A maximum of 40 expense items is allowed.';
  END IF;

  FOREACH v_category IN ARRAY v_required_categories LOOP
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_expenses,'[]'::jsonb)) AS e(value)
      WHERE e.value->>'category'=v_category
        AND jsonb_typeof(e.value->'monthly_amount')='number'
        AND (e.value->>'monthly_amount')::numeric>=0
    ) THEN RAISE EXCEPTION 'A monthly amount of R0 or more is required for expense category: %.',v_category; END IF;
  END LOOP;

  DELETE FROM public.loan_application_expenses WHERE application_id=p_application_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_expenses,'[]'::jsonb))
  LOOP
    IF COALESCE((v_item->>'monthly_amount')::numeric,0)<0 THEN RAISE EXCEPTION 'Expense amounts cannot be negative.'; END IF;
    IF COALESCE((v_item->>'monthly_amount')::numeric,0)>0 THEN
      INSERT INTO public.loan_application_expenses(application_id,expense_category,description,monthly_amount)
      VALUES(p_application_id,COALESCE(NULLIF(trim(v_item->>'category'),''),'Other'),
        NULLIF(trim(v_item->>'description'),''),(v_item->>'monthly_amount')::numeric);
    END IF;
  END LOOP;

  SELECT COALESCE(SUM(monthly_amount),0) INTO v_total
  FROM public.loan_application_expenses WHERE application_id=p_application_id;
  UPDATE public.loan_applications SET monthly_expenses_total=v_total,updated_at=now()
  WHERE id=p_application_id;

  v_assessment := public.calculate_application_affordability(p_application_id);
  IF v_assessment->>'status'='AFFORDABLE' THEN
    v_funding := public.prepare_public_application_funding(p_application_id,p_upload_token);
  ELSE
    v_funding := jsonb_build_object('sufficient',false,'reason','NOT_AFFORDABLE');
  END IF;

  RETURN jsonb_build_object('success',true,'monthly_expenses_total',v_total,
    'assessment',v_assessment,'funding',v_funding);
END;
$function$;
