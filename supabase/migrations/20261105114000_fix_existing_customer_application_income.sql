-- Preserve the income values entered on the current public application.
-- The legacy submission function prefers historical customer income for existing
-- customers; the public wrapper must persist the current applicant's values.
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
SET search_path TO 'public'
AS $function$
DECLARE
  v_submission record;
BEGIN
  IF NULLIF(trim(COALESCE(p_email,'')), '') IS NULL
     OR position('@' in trim(p_email)) <= 1
     OR position('.' in split_part(trim(p_email),'@',2)) <= 1
     OR trim(p_email) LIKE '% %' THEN
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
  SET monthly_income = p_monthly_income,
      other_income = p_other_income,
      work_address = trim(p_work_address),
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
