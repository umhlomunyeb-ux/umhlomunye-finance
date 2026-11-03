-- Umhlomunye Finance: combine customer-profile eligibility and revised loan pricing rules.

-- All applicants are eligible for up to R6,000; first-time borrower cap removed.

-- Initial 40% is charged at issue. Two-month loans have equal instalments;

-- a single additional 40% charge is applied to the remaining balance 8 days after

-- the first scheduled payment date. It never repeats.

UPDATE public.system_settings

SET maximum_loan_amount = 6000, tier_1_max_amount = 6000,

    tier_1_interest_rate = 40, tier_2_interest_rate = 40,

    term_1_max_amount = 4999.99, term_1_months = 1,

    term_2_max_amount = 6000, term_2_months = 2,

    term_3_months = 2, maximum_loan_term_months = 2,

    interest_cycle_days = 8, interest_cycle_enabled = true,

    updated_at = now()

;

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
  SELECT * INTO v_app FROM public.loan_applications
  WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found.'; END IF;

  SELECT COALESCE(SUM(monthly_amount),0) INTO v_expenses
  FROM public.loan_application_expenses WHERE application_id = p_application_id;

  v_disposable := COALESCE(v_app.monthly_income,0)
    + COALESCE(v_app.other_income,0) - v_expenses;

  SELECT COALESCE(tier_1_interest_rate,40) INTO v_rate
  FROM public.system_settings ORDER BY updated_at DESC LIMIT 1;
  v_rate := COALESCE(v_rate,40);

  SELECT CASE
    WHEN v_app.amount_requested <= term_1_max_amount THEN term_1_months
    WHEN v_app.amount_requested <= term_2_max_amount THEN term_2_months
    ELSE NULL
  END INTO v_term
  FROM public.system_settings ORDER BY updated_at DESC LIMIT 1;

  IF v_app.amount_requested < 100 OR v_app.amount_requested > 6000 THEN
    RAISE EXCEPTION 'Loan amount must be between R100 and R6,000.';
  END IF;
  IF v_term IS NULL OR v_term NOT IN (1,2) THEN
    RAISE EXCEPTION 'No valid repayment term is configured for this loan amount.';
  END IF;

  v_initial_interest := round(v_app.amount_requested * v_rate / 100, 2);
  v_initial_balance := round(v_app.amount_requested + v_initial_interest, 2);

  IF v_term = 2 THEN
    v_repayment := round(
      v_initial_balance * (1 + v_rate / 100) / (2 + v_rate / 100), 2
    );
    v_total := round(v_repayment * 2, 2);
  ELSE
    v_repayment := v_initial_balance;
    v_total := v_initial_balance;
  END IF;

  UPDATE public.loan_applications SET
    monthly_expenses_total = v_expenses,
    disposable_income = v_disposable,
    affordability_status = CASE
      WHEN v_disposable <= 0 OR v_repayment > v_disposable THEN 'DECLINED'
      ELSE 'AFFORDABLE' END,
    affordability_reason = CASE
      WHEN v_disposable <= 0 THEN 'Disposable income is zero or negative.'
      WHEN v_repayment > v_disposable THEN 'Required instalment exceeds disposable income.'
      ELSE NULL END,
    assessed_at = now(),
    offer_amount = CASE WHEN v_disposable > 0 AND v_repayment <= v_disposable THEN v_app.amount_requested ELSE NULL END,
    offer_term_months = CASE WHEN v_disposable > 0 AND v_repayment <= v_disposable THEN v_term ELSE NULL END,
    offer_monthly_repayment = CASE WHEN v_disposable > 0 AND v_repayment <= v_disposable THEN v_repayment ELSE NULL END,
    offer_interest_amount = CASE WHEN v_disposable > 0 AND v_repayment <= v_disposable THEN v_total - v_app.amount_requested ELSE NULL END,
    offer_total_repayment = CASE WHEN v_disposable > 0 AND v_repayment <= v_disposable THEN v_total ELSE NULL END
  WHERE id = p_application_id;

  RETURN jsonb_build_object(
    'application_id',p_application_id,
    'monthly_expenses',v_expenses,
    'disposable_income',v_disposable,
    'monthly_repayment',v_repayment,
    'term_months',v_term,
    'initial_balance',v_initial_balance,
    'total_repayment',v_total,
    'status',CASE WHEN v_disposable > 0 AND v_repayment <= v_disposable THEN 'AFFORDABLE' ELSE 'DECLINED' END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_borrower_loan_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.amount_requested IS NULL OR NEW.amount_requested <= 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.amount_requested > 6000 THEN
    RAISE EXCEPTION 'LOAN_AMOUNT_LIMIT: All applicants may request no more than R6,000.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_first_time_borrower_loan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- First-time and returning borrowers follow the same amount and term rules.
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_borrower_loan_policy(p_id_number text)
RETURNS TABLE(is_first_time_borrower boolean, maximum_loan_amount numeric, maximum_term_months integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id_number text;
  v_first_time boolean;
  v_max_term integer;
BEGIN
  v_id_number := regexp_replace(coalesce(p_id_number, ''), '[^0-9]', '', 'g');
  IF length(v_id_number) <> 13 THEN
    RAISE EXCEPTION 'A valid 13-digit South African ID number is required.';
  END IF;
  v_first_time := public.is_first_time_borrower(NULL, v_id_number);
  SELECT CASE WHEN 6000 <= term_1_max_amount THEN term_1_months
              WHEN 6000 <= term_2_max_amount THEN term_2_months
              ELSE 2 END
  INTO v_max_term
  FROM public.system_settings ORDER BY updated_at DESC LIMIT 1;
  RETURN QUERY SELECT v_first_time, 6000::numeric, COALESCE(v_max_term,2);
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_loan_application(p_id_number text, p_first_name text, p_last_name text, p_cellphone text, p_email text, p_physical_address text, p_employer text, p_monthly_income numeric, p_other_income numeric, p_bank_name text, p_account_number text, p_amount_requested numeric, p_loan_purpose text, p_preferred_payment_date date, p_collection_preference text, p_notes text, p_employment_status text)
 RETURNS TABLE(application_id uuid, application_number text, upload_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

DECLARE
    v_id_number text;

    v_customer_id uuid;
    v_customer_number text;

    v_first_name text;
    v_last_name text;
    v_cellphone text;
    v_email text;
    v_physical_address text;
    v_employer text;
    v_employment_status text;
    v_monthly_income numeric;
    v_other_income numeric;

    v_bank_name text;
    v_account_number text;
    v_loan_purpose text;
    v_collection_preference text;

    v_previous_bank_name text;
    v_previous_account_number text;

    v_min_amount numeric;
    v_max_amount numeric;

    v_application_id uuid;
    v_application_number text;
    v_upload_token text;

BEGIN

    -- ========================================================
    -- NORMALISE ID NUMBER
    -- ========================================================

    v_id_number := regexp_replace(
        COALESCE(p_id_number, ''),
        '[^0-9]',
        '',
        'g'
    );

    IF length(v_id_number) <> 13
       OR v_id_number !~ '^[0-9]{13}$'
    THEN
        RAISE EXCEPTION
            'A valid 13-digit South African ID number is required.';
    END IF;


    -- ========================================================
    -- AMOUNT IS COMPULSORY
    -- ========================================================

    IF p_amount_requested IS NULL THEN
        RAISE EXCEPTION 'Loan amount is required.';
    END IF;

    IF p_amount_requested <= 0 THEN
        RAISE EXCEPTION 'Loan amount must be greater than zero.';
    END IF;


    -- ========================================================
    -- PAYMENT DATE IS COMPULSORY
    -- ========================================================

    IF p_preferred_payment_date IS NULL THEN
        RAISE EXCEPTION 'Payment date is required.';
    END IF;


    -- ========================================================
    -- LOAD LOAN LIMITS FROM SETTINGS
    -- ========================================================

    SELECT
        minimum_loan_amount,
        maximum_loan_amount
    INTO
        v_min_amount,
        v_max_amount
    FROM public.system_settings
    ORDER BY id
    LIMIT 1;

    IF v_min_amount IS NULL
       OR v_max_amount IS NULL
    THEN
        RAISE EXCEPTION
            'Loan settings are incomplete. Minimum and maximum loan amounts must be configured.';
    END IF;


    IF p_amount_requested < v_min_amount THEN
        RAISE EXCEPTION
            'The minimum loan amount is R% .',
            to_char(v_min_amount, 'FM999999990.00');
    END IF;

    IF p_amount_requested > v_max_amount THEN
        RAISE EXCEPTION
            'The maximum loan amount is R% .',
            to_char(v_max_amount, 'FM999999990.00');
    END IF;


    -- ========================================================
    -- FIND EXISTING CUSTOMER
    -- ========================================================

    SELECT
        c.id,
        c.customer_number,
        c.first_name,
        c.last_name,
        c.cellphone,
        c.email,
        c.physical_address,
        c.employer,
        c.monthly_income
    INTO
        v_customer_id,
        v_customer_number,
        v_first_name,
        v_last_name,
        v_cellphone,
        v_email,
        v_physical_address,
        v_employer,
        v_monthly_income
    FROM public.customers c
    WHERE
        regexp_replace(
            COALESCE(c.id_number, ''),
            '[^0-9]',
            '',
            'g'
        ) = v_id_number
        AND COALESCE(c.is_deleted, false) = false
        AND COALESCE(c.is_active, true) = true
    ORDER BY c.created_at DESC NULLS LAST
    LIMIT 1;


    -- ========================================================
    -- EXISTING CUSTOMER
    -- ========================================================

    IF v_customer_id IS NOT NULL THEN

        /*
         * Personal information comes from the registered
         * customer record.
         *
         * Banking information may come from the latest
         * application, but the current application is allowed
         * to provide/confirm the banking information.
         */

        SELECT
            la.bank_name,
            la.account_number,
            la.employment_status,
            la.other_income,
            la.loan_purpose,
            la.collection_preference
        INTO
            v_previous_bank_name,
            v_previous_account_number,
            v_employment_status,
            v_other_income,
            v_loan_purpose,
            v_collection_preference
        FROM public.loan_applications la
        WHERE
            la.customer_id = v_customer_id
            OR (
                la.customer_id IS NULL
                AND regexp_replace(
                    COALESCE(la.id_number, ''),
                    '[^0-9]',
                    '',
                    'g'
                ) = v_id_number
            )
        ORDER BY la.created_at DESC NULLS LAST
        LIMIT 1;


        /*
         * Current application values take priority.
         * Previous values are used only when the current
         * application did not provide them.
         */

        v_bank_name :=
            COALESCE(
                NULLIF(trim(COALESCE(p_bank_name, '')), ''),
                NULLIF(trim(COALESCE(v_previous_bank_name, '')), '')
            );

        v_account_number :=
            COALESCE(
                NULLIF(trim(COALESCE(p_account_number, '')), ''),
                NULLIF(trim(COALESCE(v_previous_account_number, '')), '')
            );


        /*
         * Banking details are compulsory for every application.
         */

        IF NULLIF(trim(COALESCE(v_bank_name, '')), '') IS NULL THEN
            RAISE EXCEPTION
                'Bank name is required.';
        END IF;

        IF NULLIF(trim(COALESCE(v_account_number, '')), '') IS NULL THEN
            RAISE EXCEPTION
                'Bank account number is required.';
        END IF;


        /*
         * If the applicant supplied new banking details,
         * those details are saved with this application and
         * therefore become available for future applications.
         */

        IF NULLIF(trim(COALESCE(p_bank_name, '')), '') IS NOT NULL THEN
            v_bank_name := trim(p_bank_name);
        END IF;

        IF NULLIF(trim(COALESCE(p_account_number, '')), '') IS NOT NULL THEN
            v_account_number := trim(p_account_number);
        END IF;


        /*
         * Use the latest application information where
         * available.
         */

        IF NULLIF(trim(COALESCE(v_employment_status, '')), '') IS NULL THEN
            v_employment_status :=
                NULLIF(trim(COALESCE(p_employment_status, '')), '');
        END IF;

        IF v_other_income IS NULL THEN
            v_other_income := p_other_income;
        END IF;

        IF NULLIF(trim(COALESCE(v_loan_purpose, '')), '') IS NULL THEN
            v_loan_purpose :=
                NULLIF(trim(COALESCE(p_loan_purpose, '')), '');
        END IF;

        IF NULLIF(trim(COALESCE(v_collection_preference, '')), '') IS NULL THEN
            v_collection_preference :=
                NULLIF(trim(COALESCE(p_collection_preference, '')), '');
        END IF;


    -- ========================================================
    -- NEW CUSTOMER
    -- ========================================================

    ELSE

        IF NULLIF(trim(COALESCE(p_first_name, '')), '') IS NULL THEN
            RAISE EXCEPTION 'First name is required.';
        END IF;

        IF NULLIF(trim(COALESCE(p_last_name, '')), '') IS NULL THEN
            RAISE EXCEPTION 'Last name is required.';
        END IF;

        IF NULLIF(trim(COALESCE(p_cellphone, '')), '') IS NULL THEN
            RAISE EXCEPTION 'Cellphone number is required.';
        END IF;


        -- Banking details are compulsory.

        IF NULLIF(trim(COALESCE(p_bank_name, '')), '') IS NULL THEN
            RAISE EXCEPTION 'Bank name is required.';
        END IF;

        IF NULLIF(trim(COALESCE(p_account_number, '')), '') IS NULL THEN
            RAISE EXCEPTION 'Bank account number is required.';
        END IF;


        -- Use values supplied by the new applicant.

        v_first_name := trim(p_first_name);
        v_last_name := trim(p_last_name);
        v_cellphone := trim(p_cellphone);

        v_email :=
            NULLIF(trim(COALESCE(p_email, '')), '');

        v_physical_address :=
            NULLIF(trim(COALESCE(p_physical_address, '')), '');

        v_employer :=
            NULLIF(trim(COALESCE(p_employer, '')), '');

        v_employment_status :=
            NULLIF(trim(COALESCE(p_employment_status, '')), '');

        v_monthly_income := p_monthly_income;
        v_other_income := p_other_income;

        v_bank_name := trim(p_bank_name);
        v_account_number := trim(p_account_number);

        v_loan_purpose :=
            NULLIF(trim(COALESCE(p_loan_purpose, '')), '');

        v_collection_preference :=
            NULLIF(trim(COALESCE(p_collection_preference, '')), '');

    END IF;


    -- ========================================================
    -- APPLICATION NUMBER
    -- ========================================================

    SELECT
        'APP' ||
        LPAD(
            (
                COALESCE(
                    MAX(
                        CASE
                            WHEN la.application_number ~ '^APP[0-9]+$'
                            THEN substring(
                                la.application_number
                                FROM 4
                            )::bigint
                            ELSE 0
                        END
                    ),
                    0
                ) + 1
            )::text,
            6,
            '0'
        )
    INTO v_application_number
    FROM public.loan_applications la;


    -- ========================================================
    -- CREATE APPLICATION
    -- ========================================================

    INSERT INTO public.loan_applications (
        application_number,
        customer_id,

        first_name,
        last_name,
        cellphone,
        email,
        physical_address,
        employer,
        employment_status,
        monthly_income,
        other_income,

        bank_name,
        account_number,

        amount_requested,
        loan_purpose,
        preferred_payment_date,
        collection_preference,
        notes,

        id_number,

        status
    )
    VALUES (
        v_application_number,
        v_customer_id,

        v_first_name,
        v_last_name,
        v_cellphone,
        v_email,
        v_physical_address,
        v_employer,
        v_employment_status,
        v_monthly_income,
        v_other_income,

        v_bank_name,
        v_account_number,

        p_amount_requested,
        v_loan_purpose,
        p_preferred_payment_date,
        v_collection_preference,
        NULLIF(trim(COALESCE(p_notes, '')), ''),

        v_id_number,

        'PENDING'
    )
    RETURNING id
    INTO v_application_id;


    -- ========================================================
    -- CREATE SECURE DOCUMENT UPLOAD TOKEN
    -- ========================================================

    v_upload_token :=
        public.create_loan_application_upload_token(
            v_application_id
        );


    -- ========================================================
    -- RETURN RESULT
    -- ========================================================

    RETURN QUERY
    SELECT
        v_application_id,
        v_application_number,
        v_upload_token;

END;
$function$
;

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

  if v_application_amount <= v_settings.term_1_max_amount then
    v_term_months := v_settings.term_1_months;
  elsif v_application_amount <= v_settings.term_2_max_amount then
    v_term_months := v_settings.term_2_months;
  else
    raise exception 'No repayment term is configured for this loan amount.';
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

CREATE OR REPLACE FUNCTION public.apply_due_loan_interest(
  p_as_of timestamp without time zone DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  loan_record record;
  v_rate numeric(8,4);
  v_enabled boolean;
  v_balance numeric(14,2);
  v_interest numeric(14,2);
  v_new_balance numeric(14,2);
BEGIN
  SELECT COALESCE(tier_1_interest_rate,40),
         COALESCE(interest_cycle_enabled,true)
  INTO v_rate, v_enabled
  FROM public.system_settings
  ORDER BY updated_at DESC LIMIT 1;

  IF NOT COALESCE(v_enabled,true) THEN RETURN; END IF;
  v_rate := COALESCE(v_rate,40);

  FOR loan_record IN
    SELECT l.*
    FROM public.loans l
    WHERE l.loan_status = 'Active'
      AND COALESCE(l.is_deleted,false) = false
      AND COALESCE(l.current_balance,0) > 0
      AND l.next_interest_date IS NOT NULL
      AND l.next_interest_date <= p_as_of
    FOR UPDATE OF l
  LOOP
    -- The day-8 charge is permitted once per loan, never as a repeating cycle.
    IF EXISTS (
      SELECT 1 FROM public.loan_transactions t
      WHERE t.loan_id = loan_record.id
        AND upper(COALESCE(t.transaction_type,'')) = 'INTEREST'
    ) THEN
      UPDATE public.loans SET next_interest_date = NULL
      WHERE id = loan_record.id;
      CONTINUE;
    END IF;

    v_balance := round(COALESCE(loan_record.current_balance,0),2);
    v_interest := round(v_balance * COALESCE(NULLIF(loan_record.interest_rate,0),v_rate) / 100,2);
    v_new_balance := round(v_balance + v_interest,2);

    IF v_interest > 0 THEN
      INSERT INTO public.loan_transactions (
        loan_id, transaction_date, transaction_type, description,
        debit, credit, balance, created_by
      ) VALUES (
        loan_record.id, loan_record.next_interest_date, 'INTEREST',
        'One-time interest charged 8 days after the first scheduled payment date on the outstanding balance',
        v_interest, 0, v_new_balance, NULL
      );
    END IF;

    UPDATE public.loans
    SET current_balance = v_new_balance,
        last_interest_date = loan_record.next_interest_date,
        next_interest_date = NULL,
        updated_at = now()
    WHERE id = loan_record.id;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_loan_payment(p_loan_id uuid, p_amount numeric, p_payment_date date, p_notes text DEFAULT ''::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_loan public.loans%rowtype;
  v_new_balance numeric;
  v_new_total_paid numeric;
  v_new_status text;
  v_next_interest_date timestamp without time zone;
  v_next_payment_date date;
  v_due_payment_date date;
  v_transaction_id uuid;
  v_cycle_days integer;
  v_interest_cycle_enabled boolean;
  v_company_timezone text;
  v_interest_time time;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to record a loan payment.';
  end if;

  if p_loan_id is null then
    raise exception 'Loan ID is required.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  if p_payment_date is null then
    raise exception 'Payment date is required.';
  end if;

  select *
  into v_loan
  from public.loans
  where id = p_loan_id
  for update;

  if not found then
    raise exception 'Loan not found.';
  end if;

  if lower(coalesce(v_loan.loan_status, '')) in
     ('completed', 'void', 'cancelled') then
    raise exception
      'This loan is not available for repayment. Current status: %',
      v_loan.loan_status;
  end if;

  -- Allow a one-cent rounding tolerance so the two equal instalments
  -- can close the loan without leaving or rejecting a one-cent residue.
  if p_amount > coalesce(v_loan.current_balance, 0) + 0.01 then
    raise exception
      'Payment amount (%) cannot be greater than the current balance (%).',
      p_amount,
      coalesce(v_loan.current_balance, 0);
  end if;

  select
    coalesce(interest_cycle_days, 8),
    coalesce(interest_cycle_enabled, true),
    coalesce(nullif(timezone, ''), 'Africa/Johannesburg'),
    coalesce(interest_cycle_time, time '00:01:00')
  into
    v_cycle_days,
    v_interest_cycle_enabled,
    v_company_timezone,
    v_interest_time
  from public.system_settings
  order by updated_at desc
  limit 1;

  if not found then
    raise exception 'Loan Settings have not been configured.';
  end if;

  v_cycle_days := greatest(1, coalesce(v_cycle_days, 8));

  v_new_balance := round(
    greatest(
      coalesce(v_loan.current_balance, 0) - p_amount,
      0
    ),
    2
  );

  v_new_total_paid := round(
    coalesce(v_loan.total_paid, 0) + p_amount,
    2
  );

  if v_new_balance <= 0 then
    v_new_status := 'Completed';
  else
    v_new_status := 'Active';
  end if;

  v_due_payment_date := coalesce(
    v_loan.next_payment_date,
    p_payment_date
  );

  IF COALESCE(v_loan.term_months,0) = 2
     AND p_payment_date >= v_due_payment_date
     AND v_new_balance <= 0.01 THEN
    v_new_balance := 0;
  END IF;

  if v_new_balance <= 0 then
    v_next_payment_date := null;
    v_next_interest_date := null;
  elsif p_payment_date >= v_due_payment_date then
    -- Advance the next instalment date, but keep the one-time
    -- interest date anchored to the original first scheduled date.
    v_next_payment_date := (
      v_due_payment_date + interval '1 month'
    )::date;
    v_next_interest_date := v_loan.next_interest_date;
  else
    v_next_payment_date := v_loan.next_payment_date;
    v_next_interest_date := v_loan.next_interest_date;
  end if;

  update public.loans
  set
    current_balance = v_new_balance,
    total_paid = v_new_total_paid,
    loan_status = v_new_status,
    first_payment_date = coalesce(
      first_payment_date,
      p_payment_date
    ),
    last_payment_date = p_payment_date,
    next_interest_date = v_next_interest_date,
    next_payment_date = v_next_payment_date,
    updated_at = current_timestamp
  where id = p_loan_id;

  insert into public.loan_transactions (
    loan_id,
    transaction_date,
    transaction_type,
    description,
    debit,
    credit,
    balance,
    created_by
  )
  values (
    p_loan_id,
    p_payment_date::timestamp,
    'Payment',
    case
      when trim(coalesce(p_notes, '')) = '' then
        'Loan repayment'
      else
        p_notes
    end,
    0,
    p_amount,
    v_new_balance,
    auth.uid()
  )
  returning id into v_transaction_id;

  return json_build_object(
    'success', true,
    'loan_id', p_loan_id,
    'transaction_id', v_transaction_id,
    'payment_amount', p_amount,
    'payment_date', p_payment_date,
    'new_balance', v_new_balance,
    'total_paid', v_new_total_paid,
    'loan_status', v_new_status,
    'first_payment_date',
      coalesce(v_loan.first_payment_date, p_payment_date),
    'next_interest_date', v_next_interest_date,
    'next_payment_date', v_next_payment_date
  );
end;
$function$
;


-- Include the agreed term and scheduled instalment in the electronically signed agreement.
DROP FUNCTION IF EXISTS public.get_agreement_for_signing(uuid);

CREATE FUNCTION public.get_agreement_for_signing(p_signing_token uuid)
RETURNS TABLE(
  agreement_id uuid,
  agreement_number text,
  agreement_version text,
  status text,
  generated_at timestamp without time zone,
  verification_token text,
  customer_name text,
  loan_number text,
  principal_amount numeric,
  interest_rate numeric,
  interest_amount numeric,
  total_repayment numeric,
  current_balance numeric,
  first_payment_date date,
  next_payment_date date,
  term_months integer,
  monthly_repayment numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.agreement_number,
    a.agreement_version,
    a.status,
    a.generated_at,
    a.verification_token,
    c.first_name || ' ' || c.last_name,
    l.loan_number,
    l.principal_amount,
    l.interest_rate,
    l.interest_amount,
    l.total_repayment,
    l.current_balance,
    l.first_payment_date,
    l.next_payment_date,
    l.term_months,
    l.monthly_repayment
  FROM public.loan_agreements a
  JOIN public.loans l ON l.id = a.loan_id
  JOIN public.customers c ON c.id = a.customer_id
  WHERE a.signing_token = p_signing_token
    AND a.status IN ('Pending', 'Sent');
END;
$function$;
