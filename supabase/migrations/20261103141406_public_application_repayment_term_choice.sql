-- Persist and enforce the repayment term selected by the public applicant.
ALTER TABLE public.loan_applications
  ADD COLUMN IF NOT EXISTS selected_term_months integer;

UPDATE public.loan_applications
SET selected_term_months = CASE
  WHEN amount_requested < 5000 THEN 1
  ELSE 2
END
WHERE selected_term_months IS NULL;

ALTER TABLE public.loan_applications
  ALTER COLUMN selected_term_months SET DEFAULT 1,
  ALTER COLUMN selected_term_months SET NOT NULL;

ALTER TABLE public.loan_applications
  DROP CONSTRAINT IF EXISTS loan_applications_selected_term_months_check;

ALTER TABLE public.loan_applications
  ADD CONSTRAINT loan_applications_selected_term_months_check
  CHECK (
    selected_term_months IN (1, 2)
    AND (amount_requested >= 5000 OR selected_term_months = 1)
  );

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
  p_selected_term_months integer
)
RETURNS TABLE(application_id uuid, application_number text, upload_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_submission record;
BEGIN
  IF p_selected_term_months NOT IN (1, 2) THEN
    RAISE EXCEPTION 'The selected repayment term must be 1 or 2 months.';
  END IF;

  IF p_amount_requested < 5000 AND p_selected_term_months <> 1 THEN
    RAISE EXCEPTION 'Loans below R5,000 must be repaid over 1 month.';
  END IF;

  IF p_amount_requested >= 5000 AND p_amount_requested <= 6000
     AND p_selected_term_months NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Loans from R5,000 to R6,000 may be repaid over 1 or 2 months.';
  END IF;

  SELECT *
  INTO v_submission
  FROM public.submit_loan_application(
    p_id_number,
    p_first_name,
    p_last_name,
    p_cellphone,
    p_email,
    p_physical_address,
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
    p_employment_status
  );

  UPDATE public.loan_applications
  SET selected_term_months = p_selected_term_months
  WHERE id = v_submission.application_id;

  RETURN QUERY
  SELECT v_submission.application_id,
         v_submission.application_number,
         v_submission.upload_token;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_loan_application(
  text,text,text,text,text,text,text,numeric,numeric,text,text,numeric,text,date,text,text,text,integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_loan_application(
  text,text,text,text,text,text,text,numeric,numeric,text,text,numeric,text,date,text,text,text,integer
) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.calculate_application_affordability(p_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_app public.loan_applications%ROWTYPE;
  v_expenses numeric(14,2);
  v_disposable numeric(14,2);
  v_rate numeric(8,4);
  v_term integer;
  v_repayment numeric(14,2);
  v_total numeric(14,2);
  v_initial_interest numeric(14,2);
  v_initial_balance numeric(14,2);
BEGIN
  SELECT * INTO v_app
  FROM public.loan_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found.';
  END IF;

  SELECT COALESCE(SUM(monthly_amount), 0)
  INTO v_expenses
  FROM public.loan_application_expenses
  WHERE application_id = p_application_id;

  v_disposable := COALESCE(v_app.monthly_income, 0)
    + COALESCE(v_app.other_income, 0) - v_expenses;

  SELECT COALESCE(tier_1_interest_rate, 40)
  INTO v_rate
  FROM public.system_settings
  ORDER BY updated_at DESC
  LIMIT 1;

  v_rate := COALESCE(v_rate, 40);
  v_term := COALESCE(v_app.selected_term_months, 1);

  IF v_app.amount_requested < 100 OR v_app.amount_requested > 6000 THEN
    RAISE EXCEPTION 'Loan amount must be between R100 and R6,000.';
  END IF;

  IF v_term NOT IN (1, 2) THEN
    RAISE EXCEPTION 'The selected repayment term must be 1 or 2 months.';
  END IF;

  IF v_app.amount_requested < 5000 AND v_term <> 1 THEN
    RAISE EXCEPTION 'Loans below R5,000 must be repaid over 1 month.';
  END IF;

  v_initial_interest := ROUND(v_app.amount_requested * v_rate / 100, 2);
  v_initial_balance := ROUND(v_app.amount_requested + v_initial_interest, 2);

  IF v_term = 2 THEN
    v_repayment := ROUND(
      v_initial_balance * (1 + v_rate / 100) / (2 + v_rate / 100),
      2
    );
    v_total := ROUND(v_repayment * 2, 2);
  ELSE
    v_repayment := v_initial_balance;
    v_total := v_initial_balance;
  END IF;

  UPDATE public.loan_applications
  SET
    monthly_expenses_total = v_expenses,
    disposable_income = v_disposable,
    affordability_status = CASE
      WHEN v_disposable <= 0 OR v_repayment > v_disposable THEN 'DECLINED'
      ELSE 'AFFORDABLE'
    END,
    affordability_reason = CASE
      WHEN v_disposable <= 0 THEN 'Disposable income is zero or negative.'
      WHEN v_repayment > v_disposable THEN 'Required instalment exceeds disposable income.'
      ELSE NULL
    END,
    assessed_at = now(),
    offer_amount = CASE
      WHEN v_disposable > 0 AND v_repayment <= v_disposable THEN v_app.amount_requested
      ELSE NULL
    END,
    offer_term_months = CASE
      WHEN v_disposable > 0 AND v_repayment <= v_disposable THEN v_term
      ELSE NULL
    END,
    offer_monthly_repayment = CASE
      WHEN v_disposable > 0 AND v_repayment <= v_disposable THEN v_repayment
      ELSE NULL
    END,
    offer_interest_amount = CASE
      WHEN v_disposable > 0 AND v_repayment <= v_disposable THEN v_total - v_app.amount_requested
      ELSE NULL
    END,
    offer_total_repayment = CASE
      WHEN v_disposable > 0 AND v_repayment <= v_disposable THEN v_total
      ELSE NULL
    END
  WHERE id = p_application_id;

  RETURN jsonb_build_object(
    'application_id', p_application_id,
    'monthly_expenses', v_expenses,
    'disposable_income', v_disposable,
    'monthly_repayment', v_repayment,
    'term_months', v_term,
    'initial_balance', v_initial_balance,
    'total_repayment', v_total,
    'status', CASE
      WHEN v_disposable > 0 AND v_repayment <= v_disposable THEN 'AFFORDABLE'
      ELSE 'DECLINED'
    END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_loan_application(p_application_id uuid, p_approved_by uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_application record;
  v_customer record;
  v_settings record;
  v_loan_id uuid;
  v_customer_id uuid;
  v_loan_number text;
  v_customer_number text;
  v_agreement_id uuid;
  v_interest_rate numeric;
  v_interest_amount numeric;
  v_total_repayment numeric;
  v_current_balance numeric;
  v_first_payment_date date;
  v_next_payment_date date;
  v_next_interest_date timestamp without time zone;
  v_term_months integer;
  v_monthly_repayment numeric;
  v_company_timezone text;
  v_interest_time time;
  v_new_customer_number integer;
  v_new_loan_number integer;
  v_application_amount numeric;
  v_cycle_days integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to approve a loan application.';
  end if;

  if p_approved_by is null or p_approved_by <> auth.uid() then
    raise exception 'The approving user must match the currently logged-in user.';
  end if;

  select *
  into v_application
  from public.loan_applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'Loan application not found.';
  end if;

  if upper(coalesce(v_application.status, '')) <> 'PENDING' then
    raise exception 'Loan application cannot be approved because its current status is "%".', v_application.status;
  end if;

  select
    minimum_loan_amount,
    maximum_loan_amount,
    tier_1_interest_rate,
    term_1_max_amount,
    term_1_months,
    term_2_max_amount,
    term_2_months,
    maximum_loan_term_months,
    interest_cycle_days,
    timezone,
    interest_cycle_enabled,
    interest_cycle_time
  into v_settings
  from public.system_settings
  order by updated_at desc
  limit 1;

  if not found then
    raise exception 'Loan Settings have not been configured.';
  end if;

  v_application_amount := v_application.amount_requested;

  if v_application_amount is null then
    raise exception 'Loan application amount is required.';
  end if;

  if v_application_amount < v_settings.minimum_loan_amount then
    raise exception 'Requested amount R% is below the minimum loan amount of R%.',
      v_application_amount, v_settings.minimum_loan_amount;
  end if;

  if v_application_amount > v_settings.maximum_loan_amount then
    raise exception 'Requested amount R% exceeds the maximum loan amount of R%.',
      v_application_amount, v_settings.maximum_loan_amount;
  end if;

  v_interest_rate := coalesce(v_settings.tier_1_interest_rate, 0);

  if v_interest_rate < 0 or v_interest_rate > 100 then
    raise exception 'Configured interest rate must be between 0 and 100 percent.';
  end if;

  v_term_months := coalesce(
    v_application.selected_term_months,
    CASE
      WHEN v_application_amount <= v_settings.term_1_max_amount THEN v_settings.term_1_months
      WHEN v_application_amount <= v_settings.term_2_max_amount THEN v_settings.term_2_months
      ELSE NULL
    END
  );

  if v_term_months not in (1, 2) then
    raise exception 'The selected repayment term must be 1 or 2 months.';
  end if;

  if v_application_amount < 5000 and v_term_months <> 1 then
    raise exception 'Loans below R5,000 must be repaid over 1 month.';
  end if;

  if v_application_amount >= 5000 and v_application_amount <= 6000
     and v_term_months not in (1, 2) then
    raise exception 'Loans from R5,000 to R6,000 may be repaid over 1 or 2 months.';
  end if;

  if v_term_months > v_settings.maximum_loan_term_months then
    raise exception 'Calculated loan term exceeds the configured maximum.';
  end if;

  v_cycle_days := coalesce(v_settings.interest_cycle_days, 8);

  if coalesce(v_settings.interest_cycle_enabled, true)
     and v_cycle_days < 1 then
    raise exception 'Configured interest cycle must be at least 1 day.';
  end if;

  -- Initial 40% interest is charged when the loan is issued.
  v_interest_amount := round(
    v_application_amount * (v_interest_rate / 100),
    2
  );

  v_current_balance := round(
    v_application_amount + v_interest_amount,
    2
  );

  IF v_term_months = 2 THEN
    -- Equal instalments include the one-time day-8 interest on
    -- the balance remaining after instalment one.
    v_monthly_repayment := round(
      v_current_balance * (1 + v_interest_rate / 100)
      / (2 + v_interest_rate / 100),
      2
    );
    v_total_repayment := round(v_monthly_repayment * 2, 2);
  ELSE
    v_monthly_repayment := v_current_balance;
    v_total_repayment := v_current_balance;
  END IF;

  if v_application.preferred_payment_date is not null then
    v_first_payment_date := v_application.preferred_payment_date;
  else
    v_first_payment_date := (
      v_application.application_date + interval '1 month'
    )::date;
  end if;

  v_next_payment_date := v_first_payment_date;

  if coalesce(v_settings.interest_cycle_enabled, true) then
    v_company_timezone := coalesce(
      nullif(v_settings.timezone, ''),
      'Africa/Johannesburg'
    );

    v_interest_time := coalesce(
      v_settings.interest_cycle_time,
      time '00:01:00'
    );

    -- Interest is charged N days after the selected payment date.
    v_next_interest_date := (
      (
        v_next_payment_date
        + (v_cycle_days * interval '1 day')
      )::date
      + v_interest_time
    ) at time zone v_company_timezone;
  else
    v_next_interest_date := null;
  end if;

  if v_application.customer_id is not null then
    select *
    into v_customer
    from public.customers
    where id = v_application.customer_id
      and coalesce(is_deleted, false) = false
    for update;

    if not found then
      raise exception 'The customer linked to this application could not be found or is deleted.';
    end if;

    v_customer_id := v_customer.id;
  else
    if nullif(trim(v_application.id_number), '') is not null then
      select *
      into v_customer
      from public.customers
      where id_number = trim(v_application.id_number)
        and coalesce(is_deleted, false) = false
      limit 1
      for update;

      if found then
        v_customer_id := v_customer.id;
      end if;
    end if;

    if v_customer_id is null then
      select coalesce(
        max(
          nullif(
            regexp_replace(customer_number, '[^0-9]', '', 'g'),
            ''
          )::integer
        ),
        0
      ) + 1
      into v_new_customer_number
      from public.customers
      where customer_number ~ '^CUS[0-9]+$';

      v_customer_number :=
        'CUS' || lpad(v_new_customer_number::text, 6, '0');

      insert into public.customers (
        customer_number,
        first_name,
        last_name,
        id_number,
        cellphone,
        employer,
        monthly_income,
        email,
        physical_address,
        is_active,
        is_deleted,
        created_by,
        created_at,
        updated_at
      )
      values (
        v_customer_number,
        v_application.first_name,
        v_application.last_name,
        nullif(trim(v_application.id_number), ''),
        nullif(trim(v_application.cellphone), ''),
        v_application.employer,
        v_application.monthly_income,
        nullif(trim(v_application.email), ''),
        v_application.physical_address,
        true,
        false,
        p_approved_by,
        now(),
        now()
      )
      returning id into v_customer_id;
    end if;
  end if;

  select *
  into v_customer
  from public.customers
  where id = v_customer_id
    and coalesce(is_deleted, false) = false
  for update;

  if not found then
    raise exception 'Customer could not be found or is deleted.';
  end if;

  if coalesce(v_customer.is_active, true) = false then
    raise exception 'The customer is inactive and cannot receive a loan.';
  end if;

  select coalesce(
    max(
      nullif(
        regexp_replace(loan_number, '[^0-9]', '', 'g'),
        ''
      )::integer
    ),
    0
  ) + 1
  into v_new_loan_number
  from public.loans
  where loan_number ~ '^LN[0-9]+$';

  v_loan_number :=
    'LN' || lpad(v_new_loan_number::text, 6, '0');

  insert into public.loans (
    loan_number,
    customer_id,
    application_id,
    principal_amount,
    interest_rate,
    interest_amount,
    total_repayment,
    current_balance,
    total_paid,
    loan_status,
    first_payment_date,
    next_payment_date,
    next_interest_date,
    last_interest_date,
    last_payment_date,
    is_deleted,
    created_by,
    created_at,
    updated_at,
    term_months,
    monthly_repayment
  )
  values (
    v_loan_number,
    v_customer_id,
    v_application.id,
    v_application_amount,
    v_interest_rate,
    v_interest_amount,
    v_total_repayment,
    v_current_balance,
    0,
    'Active',
    v_first_payment_date,
    v_next_payment_date,
    v_next_interest_date,
    null,
    null,
    false,
    p_approved_by,
    now(),
    now(),
    v_term_months,
    v_monthly_repayment
  )
  returning id into v_loan_id;

  insert into public.loan_transactions (
    loan_id,
    transaction_type,
    description,
    debit,
    credit,
    balance,
    transaction_date,
    created_at
  )
  values (
    v_loan_id,
    'LOAN',
    'Loan approved and disbursed',
    v_application_amount,
    0,
    v_current_balance,
    now(),
    now()
  );

  update public.loan_applications
  set
    status = 'APPROVED',
    customer_id = v_customer_id,
    approved_loan_id = v_loan_id,
    reviewed_by = p_approved_by,
    reviewed_at = now(),
    updated_at = now()
  where id = v_application.id;

  perform public.create_loan_agreement(v_loan_id);

  select id
  into v_agreement_id
  from public.loan_agreements
  where loan_id = v_loan_id
  limit 1;

  return json_build_object(
    'success', true,
    'message', 'Loan application approved successfully.',
    'application_id', v_application.id,
    'application_number', v_application.application_number,
    'customer_id', v_customer_id,
    'loan_id', v_loan_id,
    'loan_number', v_loan_number,
    'principal_amount', v_application_amount,
    'interest_rate', v_interest_rate,
    'interest_amount', v_interest_amount,
    'total_repayment', v_total_repayment,
    'current_balance', v_current_balance,
    'term_months', v_term_months,
    'monthly_repayment', v_monthly_repayment,
    'first_payment_date', v_first_payment_date,
    'next_payment_date', v_next_payment_date,
    'next_interest_date', v_next_interest_date,
    'agreement_id', v_agreement_id
  );
end;
$function$
;
