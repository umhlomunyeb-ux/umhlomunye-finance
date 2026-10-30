-- Remove Term Rule 3 and enforce the two configured repayment-term rules.
BEGIN;

ALTER TABLE public.system_settings
  DROP CONSTRAINT IF EXISTS system_settings_term_rules_valid;

ALTER TABLE public.system_settings
  DROP COLUMN IF EXISTS term_3_months;

ALTER TABLE public.system_settings
  ADD CONSTRAINT system_settings_term_rules_valid
  CHECK (
    term_1_max_amount > 0
    AND term_2_max_amount > term_1_max_amount
    AND term_1_months > 0
    AND term_2_months > term_1_months
  );

CREATE OR REPLACE FUNCTION public.approve_loan_application (
  p_application_id uuid,
  p_approved_by    uuid
)
  RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
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
BEGIN

    ------------------------------------------------------------------
    -- 0. SECURITY
    -- Only an authenticated user may approve.
    -- The supplied approver must be the logged-in user.
    ------------------------------------------------------------------
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION
            'Authentication is required to approve a loan application.';
    END IF;

    IF p_approved_by IS NULL THEN
        RAISE EXCEPTION
            'An approving user is required.';
    END IF;

    IF p_approved_by <> auth.uid() THEN
        RAISE EXCEPTION
            'The approving user must match the currently logged-in user.';
    END IF;


    ------------------------------------------------------------------
    -- 1. Load and lock application
    ------------------------------------------------------------------
    SELECT *
    INTO v_application
    FROM public.loan_applications
    WHERE id = p_application_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loan application not found.';
    END IF;

    IF UPPER(COALESCE(v_application.status, '')) <> 'PENDING' THEN
        RAISE EXCEPTION
            'Loan application cannot be approved because its current status is "%".',
            v_application.status;
    END IF;


    ------------------------------------------------------------------
    -- 2. Load current Settings
    ------------------------------------------------------------------
    SELECT
        company_name,
        minimum_loan_amount,
        maximum_loan_amount,
        tier_1_max_amount,
        tier_1_interest_rate,
        tier_2_interest_rate,
        maximum_loan_term_months,
        interest_cycle_days,
        timezone,
        term_1_max_amount,
        term_1_months,
        term_2_max_amount,
        term_2_months,
        interest_cycle_enabled,
        interest_cycle_time
    INTO v_settings
    FROM public.system_settings
    ORDER BY updated_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loan Settings have not been configured.';
    END IF;


    ------------------------------------------------------------------
    -- 3. Validate requested amount
    ------------------------------------------------------------------
    v_application_amount := v_application.amount_requested;

    IF v_application_amount IS NULL THEN
        RAISE EXCEPTION 'Loan application amount is required.';
    END IF;

    IF v_application_amount < v_settings.minimum_loan_amount THEN
        RAISE EXCEPTION
            'Requested amount R% is below the minimum loan amount of R%.',
            v_application_amount,
            v_settings.minimum_loan_amount;
    END IF;

    IF v_application_amount > v_settings.maximum_loan_amount THEN
        RAISE EXCEPTION
            'Requested amount R% exceeds the maximum loan amount of R%.',
            v_application_amount,
            v_settings.maximum_loan_amount;
    END IF;


    ------------------------------------------------------------------
    -- 4. Determine interest rate FROM SETTINGS
    ------------------------------------------------------------------
    IF v_application_amount <= v_settings.tier_1_max_amount THEN
        v_interest_rate := v_settings.tier_1_interest_rate;
    ELSE
        v_interest_rate := v_settings.tier_2_interest_rate;
    END IF;


    ------------------------------------------------------------------
    -- 5. Determine loan term FROM SETTINGS
    ------------------------------------------------------------------
    IF v_application_amount <= v_settings.term_1_max_amount THEN

        v_term_months := v_settings.term_1_months;

    ELSIF v_application_amount <= v_settings.term_2_max_amount THEN

        v_term_months := v_settings.term_2_months;

    ELSE

        RAISE EXCEPTION
            'Requested loan amount does not match either configured repayment-term rule.';

    END IF;

    IF v_term_months IS NULL OR v_term_months <= 0 THEN
        RAISE EXCEPTION
            'A valid loan term could not be determined from Settings.';
    END IF;

    IF v_term_months > v_settings.maximum_loan_term_months THEN
        RAISE EXCEPTION
            'Calculated loan term of % months exceeds the configured maximum of % months.',
            v_term_months,
            v_settings.maximum_loan_term_months;
    END IF;


    ------------------------------------------------------------------
    -- 6. Calculate loan financial values
    ------------------------------------------------------------------
    v_interest_amount :=
        ROUND(
            v_application_amount * v_interest_rate / 100,
            2
        );

    v_total_repayment :=
        ROUND(
            v_application_amount + v_interest_amount,
            2
        );

    v_current_balance := v_total_repayment;

    v_monthly_repayment :=
        ROUND(
            v_total_repayment / v_term_months,
            2
        );


    ------------------------------------------------------------------
    -- 7. Find or create customer
    ------------------------------------------------------------------
    v_customer_id := v_application.customer_id;


    ------------------------------------------------------------------
    -- 7A. Application already has a customer
    ------------------------------------------------------------------
    IF v_customer_id IS NOT NULL THEN

        SELECT *
        INTO v_customer
        FROM public.customers
        WHERE id = v_customer_id
          AND COALESCE(is_deleted, false) = false
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'The customer linked to this application could not be found or is deleted.';
        END IF;


    ELSE

        ----------------------------------------------------------------
        -- 7B. Find existing customer by ID number
        ----------------------------------------------------------------
        IF NULLIF(TRIM(v_application.id_number), '') IS NOT NULL THEN

            SELECT *
            INTO v_customer
            FROM public.customers
            WHERE id_number = TRIM(v_application.id_number)
              AND COALESCE(is_deleted, false) = false
            LIMIT 1
            FOR UPDATE;

            IF FOUND THEN
                v_customer_id := v_customer.id;
            END IF;

        END IF;


        ----------------------------------------------------------------
        -- 7C. Create new customer if none was found
        ----------------------------------------------------------------
        IF v_customer_id IS NULL THEN

            SELECT
                COALESCE(
                    MAX(
                        NULLIF(
                            regexp_replace(
                                customer_number,
                                '[^0-9]',
                                '',
                                'g'
                            ),
                            ''
                        )::integer
                    ),
                    0
                ) + 1
            INTO v_new_customer_number
            FROM public.customers
            WHERE customer_number ~ '^CUS[0-9]+$';

            v_customer_number :=
                'CUS' || LPAD(
                    v_new_customer_number::text,
                    6,
                    '0'
                );

            INSERT INTO public.customers (
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
            VALUES (
                v_customer_number,
                v_application.first_name,
                v_application.last_name,
                NULLIF(TRIM(v_application.id_number), ''),
                NULLIF(TRIM(v_application.cellphone), ''),
                v_application.employer,
                v_application.monthly_income,
                NULLIF(TRIM(v_application.email), ''),
                v_application.physical_address,
                true,
                false,
                p_approved_by,
                now(),
                now()
            )
            RETURNING id
            INTO v_customer_id;

        END IF;

    END IF;


    ------------------------------------------------------------------
    -- 8. Validate final customer
    ------------------------------------------------------------------
    SELECT *
    INTO v_customer
    FROM public.customers
    WHERE id = v_customer_id
      AND COALESCE(is_deleted, false) = false
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Customer could not be found or is deleted.';
    END IF;

    IF COALESCE(v_customer.is_active, true) = false THEN
        RAISE EXCEPTION
            'The customer is inactive and cannot receive a loan.';
    END IF;


    ------------------------------------------------------------------
    -- 9. Determine payment dates
    ------------------------------------------------------------------
    IF v_application.preferred_payment_date IS NOT NULL THEN

        v_first_payment_date :=
            v_application.preferred_payment_date;

    ELSE

        v_first_payment_date :=
            (
                v_application.application_date
                + INTERVAL '1 month'
            )::date;

    END IF;

    v_next_payment_date := v_first_payment_date;


    ------------------------------------------------------------------
    -- 10. Calculate first interest-cycle date FROM SETTINGS
    ------------------------------------------------------------------
    IF COALESCE(v_settings.interest_cycle_enabled, true) THEN

        v_company_timezone :=
            COALESCE(
                NULLIF(v_settings.timezone, ''),
                'Africa/Johannesburg'
            );

        v_interest_time :=
            COALESCE(
                v_settings.interest_cycle_time,
                TIME '00:01:00'
            );

        v_next_interest_date :=
            (
                (
                    v_first_payment_date
                    + (
                        COALESCE(
                            v_settings.interest_cycle_days,
                            8
                        )
                        * INTERVAL '1 day'
                    )
                )::date
                + v_interest_time
            ) AT TIME ZONE v_company_timezone;

    ELSE

        v_next_interest_date := NULL;

    END IF;


    ------------------------------------------------------------------
    -- 11. Generate loan number
    ------------------------------------------------------------------
    SELECT
        COALESCE(
            MAX(
                NULLIF(
                    regexp_replace(
                        loan_number,
                        '[^0-9]',
                        '',
                        'g'
                    ),
                    ''
                )::integer
            ),
            0
        ) + 1
    INTO v_new_loan_number
    FROM public.loans
    WHERE loan_number ~ '^LN[0-9]+$';

    v_loan_number :=
        'LN' || LPAD(
            v_new_loan_number::text,
            6,
            '0'
        );


    ------------------------------------------------------------------
    -- 12. Create loan
    ------------------------------------------------------------------
    INSERT INTO public.loans (
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
    VALUES (
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
        NULL,
        NULL,
        false,
        p_approved_by,
        now(),
        now(),
        v_term_months,
        v_monthly_repayment
    )
    RETURNING id
    INTO v_loan_id;


    ------------------------------------------------------------------
    -- 13. Create initial LOAN transaction
    ------------------------------------------------------------------
    INSERT INTO public.loan_transactions (
        loan_id,
        transaction_type,
        description,
        debit,
        credit,
        balance,
        transaction_date,
        created_at
    )
    VALUES (
        v_loan_id,
        'LOAN',
        'Loan approved and disbursed',
        v_application_amount,
        0,
        v_current_balance,
        now(),
        now()
    );


    ------------------------------------------------------------------
    -- 14. Update application
    ------------------------------------------------------------------
    UPDATE public.loan_applications
    SET
        status = 'APPROVED',
        customer_id = v_customer_id,
        approved_loan_id = v_loan_id,
        reviewed_by = p_approved_by,
        reviewed_at = now(),
        updated_at = now()
    WHERE id = v_application.id;


    ------------------------------------------------------------------
    -- 15. Create ONE loan agreement
    ------------------------------------------------------------------
    PERFORM public.create_loan_agreement(v_loan_id);

    SELECT id
    INTO v_agreement_id
    FROM public.loan_agreements
    WHERE loan_id = v_loan_id
    LIMIT 1;


    ------------------------------------------------------------------
    -- 16. Return approval result
    ------------------------------------------------------------------
    RETURN json_build_object(
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

END;
$function$;

REVOKE ALL ON FUNCTION "public"."approve_loan_application"(uuid, uuid) FROM PUBLIC, "anon";

COMMIT;
