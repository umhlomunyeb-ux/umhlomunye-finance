-- Require complete applicant contact details and all six affordability expense categories.
ALTER TABLE public.loan_applications
  ADD COLUMN IF NOT EXISTS work_address text;

CREATE OR REPLACE FUNCTION public.submit_loan_application(
  p_id_number text,
  p_first_name text,
  p_last_name text,
  p_cellphone text,
  p_email text,
  p_physical_address text,
  p_employer text,
  p_monthly_income numeric,
  p_other_income numeric,
  p_bank_name text,
  p_account_number text,
  p_amount_requested numeric,
  p_loan_purpose text,
  p_preferred_payment_date date,
  p_collection_preference text,
  p_notes text,
  p_employment_status text,
  p_selected_term_months integer,
  p_work_address text
)
RETURNS TABLE(application_id uuid, application_number text, upload_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_submission record;
BEGIN
  IF NULLIF(trim(COALESCE(p_email,'')), '') IS NULL
     OR trim(p_email) !~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9-]+([.][A-Z0-9-]+)+ THEN
    RAISE EXCEPTION 'A valid email address is required.';
  END IF;
  IF NULLIF(trim(COALESCE(p_physical_address,'')), '') IS NULL THEN
    RAISE EXCEPTION 'Physical address is required.';
  END IF;
  IF NULLIF(trim(COALESCE(p_work_address,'')), '') IS NULL THEN
    RAISE EXCEPTION 'Work address is required.';
  END IF;
  IF p_selected_term_months NOT IN (1, 2) THEN
    RAISE EXCEPTION 'The selected repayment term must be 1 or 2 months.';
  END IF;

  SELECT *
  INTO v_submission
  FROM public.submit_loan_application(
    p_id_number,
    p_first_name,
    p_last_name,
    p_cellphone,
    trim(p_email),
    trim(p_physical_address),
    p_employer,
    p_monthly_income,
    p_other_income,
    p_bank_name,
    p_account_number,
    p_amount_requested,
    p_loan_purpose,
    p_preferred_payment_date,
    p_collection_preference,
    p_notes,
    p_employment_status,
    p_selected_term_months
  );

  UPDATE public.loan_applications
  SET work_address = trim(p_work_address),
      email = trim(p_email),
      physical_address = trim(p_physical_address),
      updated_at = now()
  WHERE id = v_submission.application_id;

  RETURN QUERY
  SELECT v_submission.application_id,
         v_submission.application_number,
         v_submission.upload_token;
END;
$function$;

-- Keep the legacy overloads callable only from this security-definer wrapper.
REVOKE ALL ON FUNCTION public.submit_loan_application(text,text,text,text,text,text,text,numeric,numeric,text,text,numeric,text,date,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_loan_application(text,text,text,text,text,text,text,numeric,numeric,text,text,numeric,text,date,text,text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_loan_application(text,text,text,text,text,text,text,numeric,numeric,text,text,numeric,text,date,text,text,text,integer,text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_public_application_expenses(
  p_application_id uuid,
  p_upload_token text,
  p_expenses jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_valid boolean;
  v_total numeric(14,2);
  v_item jsonb;
  v_assessment jsonb;
  v_category text;
  v_required_categories text[] := ARRAY[
    'Grocery',
    'Housing',
    'Clothing',
    'Transportation',
    'Existing Loan Repayments',
    'Other Expenses'
  ];
BEGIN
  IF p_application_id IS NULL OR NULLIF(trim(p_upload_token),'') IS NULL THEN
    RAISE EXCEPTION 'Application and secure upload token are required.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.loan_application_upload_tokens t
    JOIN public.loan_applications a ON a.id=t.application_id
    WHERE t.application_id=p_application_id
      AND t.token_hash=encode(digest(trim(p_upload_token),'sha256'),'hex')
      AND t.expires_at > now()
      AND t.used_at IS NULL
      AND a.status='PENDING'
  ) INTO v_valid;
  IF NOT v_valid THEN
    RAISE EXCEPTION 'The application security token is invalid or expired.';
  END IF;

  IF jsonb_typeof(COALESCE(p_expenses,'[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Expenses must be supplied as a list.';
  END IF;
  IF jsonb_array_length(COALESCE(p_expenses,'[]'::jsonb)) > 40 THEN
    RAISE EXCEPTION 'A maximum of 40 expense items is allowed.';
  END IF;

  FOREACH v_category IN ARRAY v_required_categories LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_expenses,'[]'::jsonb)) AS e(value)
      WHERE e.value->>'category' = v_category
        AND jsonb_typeof(e.value->'monthly_amount') = 'number'
        AND (e.value->>'monthly_amount')::numeric >= 0
    ) THEN
      RAISE EXCEPTION 'A monthly amount of R0 or more is required for expense category: %.', v_category;
    END IF;
  END LOOP;

  DELETE FROM public.loan_application_expenses
  WHERE application_id=p_application_id;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_expenses,'[]'::jsonb))
  LOOP
    IF COALESCE((v_item->>'monthly_amount')::numeric,0) < 0 THEN
      RAISE EXCEPTION 'Expense amounts cannot be negative.';
    END IF;
    IF COALESCE((v_item->>'monthly_amount')::numeric,0) > 0 THEN
      INSERT INTO public.loan_application_expenses(
        application_id,expense_category,description,monthly_amount
      )
      VALUES (
        p_application_id,
        COALESCE(NULLIF(trim(v_item->>'category'),''),'Other'),
        NULLIF(trim(v_item->>'description'),''),
        (v_item->>'monthly_amount')::numeric
      );
    END IF;
  END LOOP;

  SELECT COALESCE(SUM(monthly_amount),0)
  INTO v_total
  FROM public.loan_application_expenses
  WHERE application_id=p_application_id;

  UPDATE public.loan_applications
  SET monthly_expenses_total=v_total, updated_at=now()
  WHERE id=p_application_id;

  v_assessment := public.calculate_application_affordability(p_application_id);
  RETURN jsonb_build_object(
    'success',true,
    'monthly_expenses_total',v_total,
    'assessment',v_assessment
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.save_public_application_expenses(uuid,text,jsonb) TO anon, authenticated;
 THEN
    RAISE EXCEPTION 'A valid email address is required.';
  END IF;
  IF NULLIF(trim(COALESCE(p_physical_address,'')), '') IS NULL THEN
    RAISE EXCEPTION 'Physical address is required.';
  END IF;
  IF NULLIF(trim(COALESCE(p_work_address,'')), '') IS NULL THEN
    RAISE EXCEPTION 'Work address is required.';
  END IF;
  IF p_selected_term_months NOT IN (1, 2) THEN
    RAISE EXCEPTION 'The selected repayment term must be 1 or 2 months.';
  END IF;

  SELECT *
  INTO v_submission
  FROM public.submit_loan_application(
    p_id_number,
    p_first_name,
    p_last_name,
    p_cellphone,
    trim(p_email),
    trim(p_physical_address),
    p_employer,
    p_monthly_income,
    p_other_income,
    p_bank_name,
    p_account_number,
    p_amount_requested,
    p_loan_purpose,
    p_preferred_payment_date,
    p_collection_preference,
    p_notes,
    p_employment_status,
    p_selected_term_months
  );

  UPDATE public.loan_applications
  SET work_address = trim(p_work_address),
      email = trim(p_email),
      physical_address = trim(p_physical_address),
      updated_at = now()
  WHERE id = v_submission.application_id;

  RETURN QUERY
  SELECT v_submission.application_id,
         v_submission.application_number,
         v_submission.upload_token;
END;
$function$;

-- Keep the legacy overloads callable only from this security-definer wrapper.
REVOKE ALL ON FUNCTION public.submit_loan_application(text,text,text,text,text,text,text,numeric,numeric,text,text,numeric,text,date,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_loan_application(text,text,text,text,text,text,text,numeric,numeric,text,text,numeric,text,date,text,text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_loan_application(text,text,text,text,text,text,text,numeric,numeric,text,text,numeric,text,date,text,text,text,integer,text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_public_application_expenses(
  p_application_id uuid,
  p_upload_token text,
  p_expenses jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_valid boolean;
  v_total numeric(14,2);
  v_item jsonb;
  v_assessment jsonb;
  v_category text;
  v_required_categories text[] := ARRAY[
    'Grocery',
    'Housing',
    'Clothing',
    'Transportation',
    'Existing Loan Repayments',
    'Other Expenses'
  ];
BEGIN
  IF p_application_id IS NULL OR NULLIF(trim(p_upload_token),'') IS NULL THEN
    RAISE EXCEPTION 'Application and secure upload token are required.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.loan_application_upload_tokens t
    JOIN public.loan_applications a ON a.id=t.application_id
    WHERE t.application_id=p_application_id
      AND t.token_hash=encode(digest(trim(p_upload_token),'sha256'),'hex')
      AND t.expires_at > now()
      AND t.used_at IS NULL
      AND a.status='PENDING'
  ) INTO v_valid;
  IF NOT v_valid THEN
    RAISE EXCEPTION 'The application security token is invalid or expired.';
  END IF;

  IF jsonb_typeof(COALESCE(p_expenses,'[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Expenses must be supplied as a list.';
  END IF;
  IF jsonb_array_length(COALESCE(p_expenses,'[]'::jsonb)) > 40 THEN
    RAISE EXCEPTION 'A maximum of 40 expense items is allowed.';
  END IF;

  FOREACH v_category IN ARRAY v_required_categories LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_expenses,'[]'::jsonb)) AS e(value)
      WHERE e.value->>'category' = v_category
        AND jsonb_typeof(e.value->'monthly_amount') = 'number'
        AND (e.value->>'monthly_amount')::numeric >= 0
    ) THEN
      RAISE EXCEPTION 'A monthly amount of R0 or more is required for expense category: %.', v_category;
    END IF;
  END LOOP;

  DELETE FROM public.loan_application_expenses
  WHERE application_id=p_application_id;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_expenses,'[]'::jsonb))
  LOOP
    IF COALESCE((v_item->>'monthly_amount')::numeric,0) < 0 THEN
      RAISE EXCEPTION 'Expense amounts cannot be negative.';
    END IF;
    IF COALESCE((v_item->>'monthly_amount')::numeric,0) > 0 THEN
      INSERT INTO public.loan_application_expenses(
        application_id,expense_category,description,monthly_amount
      )
      VALUES (
        p_application_id,
        COALESCE(NULLIF(trim(v_item->>'category'),''),'Other'),
        NULLIF(trim(v_item->>'description'),''),
        (v_item->>'monthly_amount')::numeric
      );
    END IF;
  END LOOP;

  SELECT COALESCE(SUM(monthly_amount),0)
  INTO v_total
  FROM public.loan_application_expenses
  WHERE application_id=p_application_id;

  UPDATE public.loan_applications
  SET monthly_expenses_total=v_total, updated_at=now()
  WHERE id=p_application_id;

  v_assessment := public.calculate_application_affordability(p_application_id);
  RETURN jsonb_build_object(
    'success',true,
    'monthly_expenses_total',v_total,
    'assessment',v_assessment
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.save_public_application_expenses(uuid,text,jsonb) TO anon, authenticated;
