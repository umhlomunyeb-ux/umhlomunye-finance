--
-- PostgreSQL database dump
--

\restrict BjX34gydFcftzGonVECoIrVc7c32MahbSRQSaTiAIpj7OUAL2nlvZjGzw0ILelN

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: accept_loan_agreement(uuid, text, text, inet, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_loan_agreement(p_signing_token uuid, p_customer_name text, p_acceptance_text text, p_ip_address inet DEFAULT NULL::inet, p_user_agent text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_agreement_id UUID;
    v_agreement_number TEXT;
    v_customer_id UUID;
    v_signature_reference TEXT;
    v_accepted_at TIMESTAMP WITHOUT TIME ZONE;
BEGIN
    SELECT
        id,
        agreement_number,
        customer_id
    INTO
        v_agreement_id,
        v_agreement_number,
        v_customer_id
    FROM public.loan_agreements
    WHERE signing_token = p_signing_token
      AND status IN ('Pending', 'Sent')
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agreement not found or is no longer available for signing.';
    END IF;

    IF NULLIF(TRIM(p_customer_name), '') IS NULL THEN
        RAISE EXCEPTION 'Customer name is required.';
    END IF;

    IF NULLIF(TRIM(p_acceptance_text), '') IS NULL THEN
        RAISE EXCEPTION 'Acceptance confirmation is required.';
    END IF;

    v_signature_reference :=
        'SIG-' ||
        UPPER(REPLACE(gen_random_uuid()::TEXT, '-', ''));

    v_accepted_at := CURRENT_TIMESTAMP;

    UPDATE public.loan_agreements
    SET
        status = 'Signed',
        accepted_at = v_accepted_at,
        accepted_by = NULL,
        digital_signature_reference = v_signature_reference,
        accepted_ip_address = p_ip_address,
        accepted_user_agent = p_user_agent,
        acceptance_text = p_acceptance_text,
        customer_name_at_acceptance = p_customer_name,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_agreement_id;

    INSERT INTO public.audit_logs (
        user_id,
        entity_type,
        entity_id,
        action,
        description,
        old_data,
        new_data,
        created_at,
        module,
        table_name,
        record_id,
        channel,
        installation_id,
        ip_address,
        user_agent
    )
    VALUES (
        NULL,
        'loan_agreement',
        v_agreement_id,
        'Agreement Signed',
        'Customer electronically accepted loan agreement ' ||
        v_agreement_number,
        jsonb_build_object(
            'status', 'Pending',
            'agreement_number', v_agreement_number
        ),
        jsonb_build_object(
            'status', 'Signed',
            'agreement_number', v_agreement_number,
            'customer_id', v_customer_id,
            'customer_name', p_customer_name,
            'accepted_at', v_accepted_at,
            'digital_signature_reference', v_signature_reference,
            'acceptance_text', p_acceptance_text,
            'ip_address', p_ip_address,
            'user_agent', p_user_agent
        ),
        CURRENT_TIMESTAMP,
        'Agreements',
        'loan_agreements',
        v_agreement_id,
        'public',
        NULL,
        p_ip_address,
        p_user_agent
    );

    RETURN v_agreement_id;
END;
$$;


--
-- Name: acknowledge_document_storage_alert(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.acknowledge_document_storage_alert(p_alert_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN

  IF NOT public.current_user_is_active_admin() THEN
    RAISE EXCEPTION
      'Only an active Administrator can acknowledge storage alerts.';
  END IF;

  UPDATE public.document_storage_alerts
  SET
    status = 'ACKNOWLEDGED',
    acknowledged_by = auth.uid(),
    acknowledged_at = now()
  WHERE id = p_alert_id;

  RETURN FOUND;
END;
$$;


--
-- Name: add_bank_money(numeric, date, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_bank_money(p_amount numeric, p_transaction_date date, p_description text, p_reference text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

DECLARE
    v_account_id uuid;
    v_current_balance numeric;
    v_new_balance numeric;
    v_transaction_id uuid;
BEGIN

    IF NOT public.is_current_user_admin() THEN
        RAISE EXCEPTION 'Only administrators can add money.';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be greater than zero.';
    END IF;

    SELECT id
    INTO v_account_id
    FROM public.bank_accounts
    WHERE is_active = true
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'Create the initial bank balance first.';
    END IF;

    SELECT COALESCE(
        SUM(
            CASE
                WHEN direction = 'IN' THEN amount
                ELSE -amount
            END
        ),
        0
    )
    INTO v_current_balance
    FROM public.bank_transactions
    WHERE bank_account_id = v_account_id
      AND is_void = false;

    v_new_balance := ROUND(v_current_balance + p_amount, 2);

    INSERT INTO public.bank_transactions (
        bank_account_id,
        transaction_date,
        transaction_type,
        description,
        amount,
        direction,
        balance_after,
        reference,
        created_by
    )
    VALUES (
        v_account_id,
        COALESCE(p_transaction_date, CURRENT_DATE),
        'DEPOSIT',
        COALESCE(NULLIF(trim(p_description), ''), 'Money added'),
        p_amount,
        'IN',
        v_new_balance,
        NULLIF(trim(p_reference), ''),
        auth.uid()
    )
    RETURNING id INTO v_transaction_id;

    RETURN json_build_object(
        'success', true,
        'transaction_id', v_transaction_id,
        'new_balance', v_new_balance
    );

END;
$$;


--
-- Name: apply_due_loan_interest(timestamp without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_due_loan_interest(p_as_of timestamp without time zone DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text)) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

DECLARE
    loan_record RECORD;

    scheduled_payment_date DATE;
    interest_date TIMESTAMP WITHOUT TIME ZONE;

    working_balance NUMERIC;
    interest_amount NUMERIC;
    new_balance NUMERIC;

    calculated_next_payment_date DATE;
    calculated_next_interest_date TIMESTAMP WITHOUT TIME ZONE;

    target_day INTEGER;
    next_month_start DATE;
    last_day_of_next_month INTEGER;

    business_timezone TEXT;

    /*
     * Configurable system rules
     */
    minimum_loan_amount NUMERIC;
    maximum_loan_amount NUMERIC;

    tier_1_max_amount NUMERIC;
    tier_1_interest_rate NUMERIC;
    tier_2_interest_rate NUMERIC;

    interest_cycle_days INTEGER;

BEGIN

    /*
     * ============================================
     * LOAD CURRENT SYSTEM SETTINGS
     * ============================================
     */

    SELECT
        s.minimum_loan_amount,
        s.maximum_loan_amount,
        s.tier_1_max_amount,
        s.tier_1_interest_rate,
        s.tier_2_interest_rate,
        s.interest_cycle_days,
        s.timezone
    INTO
        minimum_loan_amount,
        maximum_loan_amount,
        tier_1_max_amount,
        tier_1_interest_rate,
        tier_2_interest_rate,
        interest_cycle_days,
        business_timezone
    FROM public.system_settings s
    ORDER BY s.updated_at DESC
    LIMIT 1;


    /*
     * If settings do not exist, use the official
     * Umhlomunye Finance defaults.
     */

    minimum_loan_amount :=
        COALESCE(minimum_loan_amount, 100);

    maximum_loan_amount :=
        COALESCE(maximum_loan_amount, 15000);

    tier_1_max_amount :=
        COALESCE(tier_1_max_amount, 2000);

    tier_1_interest_rate :=
        COALESCE(tier_1_interest_rate, 40);

    tier_2_interest_rate :=
        COALESCE(tier_2_interest_rate, 30);

    interest_cycle_days :=
        COALESCE(interest_cycle_days, 8);

    business_timezone :=
        COALESCE(
            business_timezone,
            'Africa/Johannesburg'
        );


    /*
     * ============================================
     * PROCESS DUE LOANS
     * ============================================
     */

    FOR loan_record IN

        SELECT l.*
        FROM public.loans AS l

        WHERE l.loan_status = 'Active'

          AND l.is_deleted = false

          AND l.current_balance > 0

          AND l.next_payment_date IS NOT NULL

          AND l.next_interest_date IS NOT NULL

          AND l.next_interest_date <= p_as_of

        FOR UPDATE OF l

    LOOP

        /*
         * ========================================
         * VALIDATE LOAN AMOUNT
         * ========================================
         */

        IF loan_record.principal_amount
            < minimum_loan_amount
        THEN

            RAISE WARNING
                'Loan % has principal % below minimum configured amount %.',
                loan_record.loan_number,
                loan_record.principal_amount,
                minimum_loan_amount;

        END IF;


        IF loan_record.principal_amount
            > maximum_loan_amount
        THEN

            RAISE WARNING
                'Loan % has principal % above maximum configured amount %.',
                loan_record.loan_number,
                loan_record.principal_amount,
                maximum_loan_amount;

        END IF;


        /*
         * ========================================
         * DETERMINE THE RATE FROM SETTINGS
         *
         * IMPORTANT:
         * For an already-issued loan, the rate
         * stored on the loan remains authoritative.
         *
         * If the stored rate is NULL/zero, we use
         * the current configurable rule.
         * ========================================
         */

        IF COALESCE(
            loan_record.interest_rate,
            0
        ) <= 0
        THEN

            IF loan_record.principal_amount
                <= tier_1_max_amount
            THEN

                loan_record.interest_rate :=
                    tier_1_interest_rate;

            ELSE

                loan_record.interest_rate :=
                    tier_2_interest_rate;

            END IF;

        END IF;


        /*
         * ========================================
         * START WITH CURRENT BALANCE
         * ========================================
         */

        working_balance :=
            ROUND(
                COALESCE(
                    loan_record.current_balance,
                    0
                ),
                2
            );


        scheduled_payment_date :=
            loan_record.next_payment_date;


        target_day :=
            COALESCE(
                loan_record.payment_day_anchor,

                EXTRACT(
                    DAY FROM scheduled_payment_date
                )::INTEGER
            );


        interest_date :=
            loan_record.next_interest_date;


        /*
         * ========================================
         * APPLY EVERY INTEREST EVENT THAT IS DUE
         * ========================================
         */

        WHILE interest_date <= p_as_of
              AND working_balance > 0

        LOOP

            /*
             * Interest uses the loan's locked rate.
             */

            interest_amount :=
                ROUND(
                    working_balance
                    *
                    (
                        COALESCE(
                            loan_record.interest_rate,
                            0
                        ) / 100
                    ),
                    2
                );


            new_balance :=
                ROUND(
                    working_balance
                    + interest_amount,
                    2
                );


            /*
             * ====================================
             * CREATE INTEREST TRANSACTION
             * ====================================
             */

            IF interest_amount > 0
            THEN

                INSERT INTO public.loan_transactions (
                    loan_id,
                    transaction_date,
                    transaction_type,
                    description,
                    debit,
                    credit,
                    balance,
                    created_by
                )

                VALUES (
                    loan_record.id,
                    interest_date,
                    'INTEREST',
                    'Interest charged',
                    interest_amount,
                    0,
                    new_balance,
                    NULL
                );

            END IF;


            /*
             * Update working balance.
             */

            working_balance :=
                new_balance;


            loan_record.last_interest_date :=
                interest_date;


            /*
             * ====================================
             * CALCULATE NEXT PAYMENT DATE
             * ====================================
             */

            next_month_start :=

                (
                    DATE_TRUNC(
                        'month',
                        scheduled_payment_date
                    )

                    + INTERVAL '1 month'

                )::DATE;


            last_day_of_next_month :=

                EXTRACT(
                    DAY FROM
                    (
                        next_month_start

                        + INTERVAL '1 month'

                        - INTERVAL '1 day'
                    )
                )::INTEGER;


            calculated_next_payment_date :=

                next_month_start

                + (
                    LEAST(
                        target_day,
                        last_day_of_next_month
                    ) - 1
                );


            /*
             * ====================================
             * NEXT INTEREST DATE
             *
             * Uses configurable cycle days.
             * Default = 8 days.
             * ====================================
             */

            calculated_next_interest_date :=

                (
                    (
                        calculated_next_payment_date

                        + (
                            interest_cycle_days
                            * INTERVAL '1 day'
                        )

                        + INTERVAL '1 minute'
                    )

                    AT TIME ZONE business_timezone

                )::TIMESTAMP WITHOUT TIME ZONE;


            scheduled_payment_date :=
                calculated_next_payment_date;


            interest_date :=
                calculated_next_interest_date;

        END LOOP;


        /*
         * ========================================
         * UPDATE LOAN
         * ========================================
         */

        UPDATE public.loans AS l

        SET

            current_balance =
                working_balance,

            next_payment_date =
                scheduled_payment_date,

            next_interest_date =
                interest_date,

            last_interest_date =
                loan_record.last_interest_date,

            /*
             * If the loan did not already have a
             * rate, save the rate determined from
             * Settings.
             */

            interest_rate =
                loan_record.interest_rate,

            updated_at =
                CURRENT_TIMESTAMP

        WHERE l.id =
            loan_record.id;

    END LOOP;

END;

$$;


--
-- Name: approve_loan_application(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_loan_application(p_application_id uuid, p_approved_by uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
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
        term_3_months,
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

        v_term_months := v_settings.term_3_months;

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
$_$;


--
-- Name: audit_bank_account_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_bank_account_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_action text;
    v_description text;
    v_old_data jsonb;
    v_new_data jsonb;
BEGIN

    IF TG_OP = 'INSERT' THEN

        v_action := 'Bank Account Created';

        v_description :=
            'Bank account ' ||
            COALESCE(NEW.account_name, NEW.id::text) ||
            ' was created.';

        v_new_data := jsonb_build_object(
            'account_name', NEW.account_name,
            'bank_name', NEW.bank_name,
            'account_number_last4', NEW.account_number_last4,
            'currency', NEW.currency,
            'opening_balance', NEW.opening_balance,
            'is_active', NEW.is_active,
            'created_by', NEW.created_by
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'bank_account',
            NEW.id,
            'Bank',
            'bank_accounts',
            NEW.id,
            NULL,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.created_by, auth.uid())
        );

        RETURN NEW;
    END IF;


    IF TG_OP = 'UPDATE' THEN

        IF OLD IS NOT DISTINCT FROM NEW THEN
            RETURN NEW;
        END IF;

        IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
            v_action := 'Bank Account Status Changed';
            v_description :=
                'Bank account ' ||
                COALESCE(NEW.account_name, NEW.id::text) ||
                ' active status changed from ' ||
                COALESCE(OLD.is_active::text, 'NULL') ||
                ' to ' ||
                COALESCE(NEW.is_active::text, 'NULL') || '.';
        ELSE
            v_action := 'Bank Account Updated';
            v_description :=
                'Bank account ' ||
                COALESCE(NEW.account_name, NEW.id::text) ||
                ' was updated.';
        END IF;

        v_old_data := jsonb_build_object(
            'account_name', OLD.account_name,
            'bank_name', OLD.bank_name,
            'account_number_last4', OLD.account_number_last4,
            'currency', OLD.currency,
            'opening_balance', OLD.opening_balance,
            'is_active', OLD.is_active,
            'created_by', OLD.created_by
        );

        v_new_data := jsonb_build_object(
            'account_name', NEW.account_name,
            'bank_name', NEW.bank_name,
            'account_number_last4', NEW.account_number_last4,
            'currency', NEW.currency,
            'opening_balance', NEW.opening_balance,
            'is_active', NEW.is_active,
            'created_by', NEW.created_by
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'bank_account',
            NEW.id,
            'Bank',
            'bank_accounts',
            NEW.id,
            v_old_data,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.created_by, auth.uid())
        );

        RETURN NEW;
    END IF;


    IF TG_OP = 'DELETE' THEN

        v_action := 'Bank Account Deleted';

        v_description :=
            'Bank account ' ||
            COALESCE(OLD.account_name, OLD.id::text) ||
            ' was deleted.';

        v_old_data := jsonb_build_object(
            'account_name', OLD.account_name,
            'bank_name', OLD.bank_name,
            'account_number_last4', OLD.account_number_last4,
            'currency', OLD.currency,
            'opening_balance', OLD.opening_balance,
            'is_active', OLD.is_active,
            'created_by', OLD.created_by
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'bank_account',
            OLD.id,
            'Bank',
            'bank_accounts',
            OLD.id,
            v_old_data,
            NULL,
            'system',
            NULL,
            NULL,
            NULL,
            auth.uid()
        );

        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;


--
-- Name: audit_bank_transaction_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_bank_transaction_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_action text;
    v_description text;
    v_old_data jsonb;
    v_new_data jsonb;
BEGIN

    IF TG_OP = 'INSERT' THEN

        v_action := 'Bank Transaction Created';

        v_description :=
            'Bank transaction ' ||
            COALESCE(NEW.reference, NEW.id::text) ||
            ' was created.';

        v_new_data := jsonb_build_object(
            'bank_account_id', NEW.bank_account_id,
            'transaction_date', NEW.transaction_date,
            'transaction_type', NEW.transaction_type,
            'description', NEW.description,
            'amount', NEW.amount,
            'direction', NEW.direction,
            'balance_after', NEW.balance_after,
            'borrowing_id', NEW.borrowing_id,
            'reference', NEW.reference,
            'created_by', NEW.created_by,
            'is_void', NEW.is_void
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'bank_transaction',
            NEW.id,
            'Bank',
            'bank_transactions',
            NEW.id,
            NULL,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.created_by, auth.uid())
        );

        RETURN NEW;
    END IF;


    IF TG_OP = 'UPDATE' THEN

        IF OLD IS NOT DISTINCT FROM NEW THEN
            RETURN NEW;
        END IF;

        IF OLD.is_void IS DISTINCT FROM NEW.is_void
           AND NEW.is_void = true
        THEN
            v_action := 'Bank Transaction Voided';

            v_description :=
                'Bank transaction ' ||
                COALESCE(NEW.reference, NEW.id::text) ||
                ' was voided.';

        ELSIF OLD.is_void IS DISTINCT FROM NEW.is_void THEN

            v_action := 'Bank Transaction Void Status Changed';

            v_description :=
                'Bank transaction ' ||
                COALESCE(NEW.reference, NEW.id::text) ||
                ' void status changed.';

        ELSE

            v_action := 'Bank Transaction Updated';

            v_description :=
                'Bank transaction ' ||
                COALESCE(NEW.reference, NEW.id::text) ||
                ' was updated.';

        END IF;

        v_old_data := jsonb_build_object(
            'bank_account_id', OLD.bank_account_id,
            'transaction_date', OLD.transaction_date,
            'transaction_type', OLD.transaction_type,
            'description', OLD.description,
            'amount', OLD.amount,
            'direction', OLD.direction,
            'balance_after', OLD.balance_after,
            'borrowing_id', OLD.borrowing_id,
            'reference', OLD.reference,
            'created_by', OLD.created_by,
            'is_void', OLD.is_void,
            'voided_at', OLD.voided_at,
            'voided_by', OLD.voided_by,
            'void_reason', OLD.void_reason
        );

        v_new_data := jsonb_build_object(
            'bank_account_id', NEW.bank_account_id,
            'transaction_date', NEW.transaction_date,
            'transaction_type', NEW.transaction_type,
            'description', NEW.description,
            'amount', NEW.amount,
            'direction', NEW.direction,
            'balance_after', NEW.balance_after,
            'borrowing_id', NEW.borrowing_id,
            'reference', NEW.reference,
            'created_by', NEW.created_by,
            'is_void', NEW.is_void,
            'voided_at', NEW.voided_at,
            'voided_by', NEW.voided_by,
            'void_reason', NEW.void_reason
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'bank_transaction',
            NEW.id,
            'Bank',
            'bank_transactions',
            NEW.id,
            v_old_data,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.voided_by, NEW.created_by, auth.uid())
        );

        RETURN NEW;
    END IF;


    IF TG_OP = 'DELETE' THEN

        v_action := 'Bank Transaction Deleted';

        v_description :=
            'Bank transaction ' ||
            COALESCE(OLD.reference, OLD.id::text) ||
            ' was deleted.';

        v_old_data := jsonb_build_object(
            'bank_account_id', OLD.bank_account_id,
            'transaction_date', OLD.transaction_date,
            'transaction_type', OLD.transaction_type,
            'description', OLD.description,
            'amount', OLD.amount,
            'direction', OLD.direction,
            'balance_after', OLD.balance_after,
            'borrowing_id', OLD.borrowing_id,
            'reference', OLD.reference,
            'created_by', OLD.created_by,
            'is_void', OLD.is_void,
            'voided_at', OLD.voided_at,
            'voided_by', OLD.voided_by,
            'void_reason', OLD.void_reason
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'bank_transaction',
            OLD.id,
            'Bank',
            'bank_transactions',
            OLD.id,
            v_old_data,
            NULL,
            'system',
            NULL,
            NULL,
            NULL,
            auth.uid()
        );

        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;


--
-- Name: audit_company_borrowing_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_company_borrowing_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_action text;
    v_description text;
    v_old_data jsonb;
    v_new_data jsonb;
BEGIN

    IF TG_OP = 'INSERT' THEN

        v_action := 'Company Borrowing Created';

        v_description :=
            'Company borrowing ' ||
            COALESCE(NEW.reference, NEW.id::text) ||
            ' was created.';

        v_new_data := jsonb_build_object(
            'lender_name', NEW.lender_name,
            'borrowing_date', NEW.borrowing_date,
            'original_amount', NEW.original_amount,
            'amount_repaid', NEW.amount_repaid,
            'outstanding_amount', NEW.outstanding_amount,
            'description', NEW.description,
            'reference', NEW.reference,
            'status', NEW.status,
            'borrowing_agreement_path',
                NEW.borrowing_agreement_path,
            'created_by', NEW.created_by
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'company_borrowing',
            NEW.id,
            'Company Borrowings',
            'company_borrowings',
            NEW.id,
            NULL,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.created_by, auth.uid())
        );

        RETURN NEW;
    END IF;


    IF TG_OP = 'UPDATE' THEN

        IF OLD IS NOT DISTINCT FROM NEW THEN
            RETURN NEW;
        END IF;

        IF OLD.status IS DISTINCT FROM NEW.status THEN

            v_action := 'Company Borrowing Status Changed';

            v_description :=
                'Company borrowing ' ||
                COALESCE(NEW.reference, NEW.id::text) ||
                ' status changed from ' ||
                COALESCE(OLD.status, 'NULL') ||
                ' to ' ||
                COALESCE(NEW.status, 'NULL') || '.';

        ELSIF OLD.amount_repaid IS DISTINCT FROM NEW.amount_repaid
           OR OLD.outstanding_amount IS DISTINCT FROM NEW.outstanding_amount
        THEN

            v_action := 'Company Borrowing Balance Updated';

            v_description :=
                'Company borrowing ' ||
                COALESCE(NEW.reference, NEW.id::text) ||
                ' repayment balance was updated.';

        ELSE

            v_action := 'Company Borrowing Updated';

            v_description :=
                'Company borrowing ' ||
                COALESCE(NEW.reference, NEW.id::text) ||
                ' was updated.';

        END IF;

        v_old_data := jsonb_build_object(
            'lender_name', OLD.lender_name,
            'borrowing_date', OLD.borrowing_date,
            'original_amount', OLD.original_amount,
            'amount_repaid', OLD.amount_repaid,
            'outstanding_amount', OLD.outstanding_amount,
            'description', OLD.description,
            'reference', OLD.reference,
            'status', OLD.status,
            'borrowing_agreement_path',
                OLD.borrowing_agreement_path,
            'created_by', OLD.created_by
        );

        v_new_data := jsonb_build_object(
            'lender_name', NEW.lender_name,
            'borrowing_date', NEW.borrowing_date,
            'original_amount', NEW.original_amount,
            'amount_repaid', NEW.amount_repaid,
            'outstanding_amount', NEW.outstanding_amount,
            'description', NEW.description,
            'reference', NEW.reference,
            'status', NEW.status,
            'borrowing_agreement_path',
                NEW.borrowing_agreement_path,
            'created_by', NEW.created_by
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'company_borrowing',
            NEW.id,
            'Company Borrowings',
            'company_borrowings',
            NEW.id,
            v_old_data,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.created_by, auth.uid())
        );

        RETURN NEW;
    END IF;


    IF TG_OP = 'DELETE' THEN

        v_action := 'Company Borrowing Deleted';

        v_description :=
            'Company borrowing ' ||
            COALESCE(OLD.reference, OLD.id::text) ||
            ' was deleted.';

        v_old_data := jsonb_build_object(
            'lender_name', OLD.lender_name,
            'borrowing_date', OLD.borrowing_date,
            'original_amount', OLD.original_amount,
            'amount_repaid', OLD.amount_repaid,
            'outstanding_amount', OLD.outstanding_amount,
            'description', OLD.description,
            'reference', OLD.reference,
            'status', OLD.status,
            'borrowing_agreement_path',
                OLD.borrowing_agreement_path,
            'created_by', OLD.created_by
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'company_borrowing',
            OLD.id,
            'Company Borrowings',
            'company_borrowings',
            OLD.id,
            v_old_data,
            NULL,
            'system',
            NULL,
            NULL,
            NULL,
            auth.uid()
        );

        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;


--
-- Name: audit_company_debt_repayment_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_company_debt_repayment_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_action text;
    v_description text;
    v_old_data jsonb;
    v_new_data jsonb;
    v_borrowing_reference text;
BEGIN
    IF TG_OP = 'INSERT' THEN

        SELECT reference
        INTO v_borrowing_reference
        FROM public.company_borrowings
        WHERE id = NEW.borrowing_id;

        v_action := 'Company Debt Repayment Created';

        v_description :=
            'Company debt repayment ' ||
            COALESCE(
                NEW.reference,
                'for borrowing ' ||
                COALESCE(v_borrowing_reference, NEW.borrowing_id::text)
            ) ||
            ' was created.';

        v_new_data := jsonb_build_object(
            'borrowing_id', NEW.borrowing_id,
            'borrowing_reference', v_borrowing_reference,
            'amount', NEW.amount,
            'repayment_date', NEW.repayment_date,
            'description', NEW.description,
            'reference', NEW.reference,
            'proof_of_payment_path', NEW.proof_of_payment_path,
            'created_by', NEW.created_by
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'company_debt_repayment',
            NEW.id,
            'Company Debt Repayments',
            'company_debt_repayments',
            NEW.id,
            NULL,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.created_by, auth.uid())
        );

        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN

        IF OLD IS NOT DISTINCT FROM NEW THEN
            RETURN NEW;
        END IF;

        SELECT reference
        INTO v_borrowing_reference
        FROM public.company_borrowings
        WHERE id = NEW.borrowing_id;

        IF OLD.amount IS DISTINCT FROM NEW.amount THEN
            v_action := 'Company Debt Repayment Amount Changed';
            v_description :=
                'Company debt repayment ' ||
                COALESCE(NEW.reference, NEW.id::text) ||
                ' amount changed from ' ||
                COALESCE(OLD.amount::text, 'NULL') ||
                ' to ' ||
                COALESCE(NEW.amount::text, 'NULL') || '.';

        ELSIF OLD.proof_of_payment_path IS DISTINCT FROM NEW.proof_of_payment_path THEN
            v_action := 'Company Debt Repayment Proof Updated';
            v_description :=
                'Proof of payment for company debt repayment ' ||
                COALESCE(NEW.reference, NEW.id::text) ||
                ' was updated.';

        ELSIF OLD.reference IS DISTINCT FROM NEW.reference THEN
            v_action := 'Company Debt Repayment Reference Changed';
            v_description :=
                'Company debt repayment reference changed from ' ||
                COALESCE(OLD.reference, 'NULL') ||
                ' to ' ||
                COALESCE(NEW.reference, 'NULL') || '.';

        ELSE
            v_action := 'Company Debt Repayment Updated';
            v_description :=
                'Company debt repayment ' ||
                COALESCE(NEW.reference, NEW.id::text) ||
                ' was updated.';
        END IF;

        v_old_data := jsonb_build_object(
            'borrowing_id', OLD.borrowing_id,
            'borrowing_reference', v_borrowing_reference,
            'amount', OLD.amount,
            'repayment_date', OLD.repayment_date,
            'description', OLD.description,
            'reference', OLD.reference,
            'proof_of_payment_path', OLD.proof_of_payment_path,
            'created_by', OLD.created_by
        );

        v_new_data := jsonb_build_object(
            'borrowing_id', NEW.borrowing_id,
            'borrowing_reference', v_borrowing_reference,
            'amount', NEW.amount,
            'repayment_date', NEW.repayment_date,
            'description', NEW.description,
            'reference', NEW.reference,
            'proof_of_payment_path', NEW.proof_of_payment_path,
            'created_by', NEW.created_by
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'company_debt_repayment',
            NEW.id,
            'Company Debt Repayments',
            'company_debt_repayments',
            NEW.id,
            v_old_data,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.created_by, auth.uid())
        );

        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN

        SELECT reference
        INTO v_borrowing_reference
        FROM public.company_borrowings
        WHERE id = OLD.borrowing_id;

        v_action := 'Company Debt Repayment Deleted';

        v_description :=
            'Company debt repayment ' ||
            COALESCE(OLD.reference, OLD.id::text) ||
            ' was deleted.';

        v_old_data := jsonb_build_object(
            'borrowing_id', OLD.borrowing_id,
            'borrowing_reference', v_borrowing_reference,
            'amount', OLD.amount,
            'repayment_date', OLD.repayment_date,
            'description', OLD.description,
            'reference', OLD.reference,
            'proof_of_payment_path', OLD.proof_of_payment_path,
            'created_by', OLD.created_by
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'company_debt_repayment',
            OLD.id,
            'Company Debt Repayments',
            'company_debt_repayments',
            OLD.id,
            v_old_data,
            NULL,
            'system',
            NULL,
            NULL,
            NULL,
            auth.uid()
        );

        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;


--
-- Name: audit_customer_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_customer_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_action text;
    v_description text;
    v_old_data jsonb;
    v_new_data jsonb;
BEGIN
    IF TG_OP = 'INSERT' THEN

        v_action := 'Customer Created';

        v_description :=
            'Customer ' ||
            COALESCE(NEW.customer_number, NEW.id::text) ||
            ' was created.';

        v_new_data := jsonb_build_object(
            'customer_number', NEW.customer_number,
            'first_name', NEW.first_name,
            'last_name', NEW.last_name,
            'cellphone', NEW.cellphone,
            'email', NEW.email,
            'employer', NEW.employer,
            'monthly_income', NEW.monthly_income,
            'occupation', NEW.occupation,
            'is_active', NEW.is_active,
            'is_deleted', NEW.is_deleted,
            'created_by', NEW.created_by
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'customer',
            NEW.id,
            'Customers',
            'customers',
            NEW.id,
            NULL,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.created_by, auth.uid())
        );

        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN

        IF OLD IS NOT DISTINCT FROM NEW THEN
            RETURN NEW;
        END IF;

        IF OLD.is_deleted IS DISTINCT FROM NEW.is_deleted THEN

            IF NEW.is_deleted = true THEN
                v_action := 'Customer Deleted';
                v_description :=
                    'Customer ' ||
                    COALESCE(NEW.customer_number, NEW.id::text) ||
                    ' was marked as deleted.';
            ELSE
                v_action := 'Customer Restored';
                v_description :=
                    'Customer ' ||
                    COALESCE(NEW.customer_number, NEW.id::text) ||
                    ' was restored.';
            END IF;

        ELSIF OLD.is_active IS DISTINCT FROM NEW.is_active THEN

            v_action := 'Customer Status Changed';

            v_description :=
                'Customer ' ||
                COALESCE(NEW.customer_number, NEW.id::text) ||
                ' active status changed from ' ||
                COALESCE(OLD.is_active::text, 'NULL') ||
                ' to ' ||
                COALESCE(NEW.is_active::text, 'NULL') ||
                '.';

        ELSE

            v_action := 'Customer Updated';

            v_description :=
                'Customer ' ||
                COALESCE(NEW.customer_number, NEW.id::text) ||
                ' was updated.';

        END IF;

        v_old_data := jsonb_build_object(
            'customer_number', OLD.customer_number,
            'first_name', OLD.first_name,
            'last_name', OLD.last_name,
            'cellphone', OLD.cellphone,
            'email', OLD.email,
            'employer', OLD.employer,
            'monthly_income', OLD.monthly_income,
            'occupation', OLD.occupation,
            'is_active', OLD.is_active,
            'is_deleted', OLD.is_deleted,
            'created_by', OLD.created_by
        );

        v_new_data := jsonb_build_object(
            'customer_number', NEW.customer_number,
            'first_name', NEW.first_name,
            'last_name', NEW.last_name,
            'cellphone', NEW.cellphone,
            'email', NEW.email,
            'employer', NEW.employer,
            'monthly_income', NEW.monthly_income,
            'occupation', NEW.occupation,
            'is_active', NEW.is_active,
            'is_deleted', NEW.is_deleted,
            'created_by', NEW.created_by
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'customer',
            NEW.id,
            'Customers',
            'customers',
            NEW.id,
            v_old_data,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.created_by, auth.uid())
        );

        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN

        v_action := 'Customer Deleted';

        v_description :=
            'Customer ' ||
            COALESCE(OLD.customer_number, OLD.id::text) ||
            ' was permanently deleted.';

        v_old_data := jsonb_build_object(
            'customer_number', OLD.customer_number,
            'first_name', OLD.first_name,
            'last_name', OLD.last_name,
            'cellphone', OLD.cellphone,
            'email', OLD.email,
            'employer', OLD.employer,
            'monthly_income', OLD.monthly_income,
            'occupation', OLD.occupation,
            'is_active', OLD.is_active,
            'is_deleted', OLD.is_deleted,
            'created_by', OLD.created_by
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'customer',
            OLD.id,
            'Customers',
            'customers',
            OLD.id,
            v_old_data,
            NULL,
            'system',
            NULL,
            NULL,
            NULL,
            auth.uid()
        );

        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;


--
-- Name: audit_document_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_document_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_user_id uuid;
    v_action text;
    v_description text;
    v_document jsonb;
    v_document_id uuid;
    v_group_id uuid;
    v_version integer;
    v_document_type text;
    v_document_name text;
BEGIN
    v_user_id := auth.uid();

    -- ========================================================
    -- INSERT
    -- ========================================================

    IF TG_OP = 'INSERT' THEN

        v_action := 'CREATED';
        v_description := 'Document Created';

        v_document := to_jsonb(NEW);
        v_document_id := NEW.id;
        v_group_id := NEW.document_group_id;
        v_version := NEW.version_number;
        v_document_type := NEW.document_type;
        v_document_name := NEW.document_name;

        INSERT INTO public.document_history (
            document_id,
            action,
            performed_by,
            performed_at,
            previous_document_id,
            new_document_id,
            document_group_id,
            version_number,
            document_snapshot
        )
        VALUES (
            v_document_id,
            v_action,
            v_user_id,
            now(),
            NULL,
            v_document_id,
            v_group_id,
            v_version,
            v_document
        );

        PERFORM public.write_audit_log(
            'Document Created',
            'Document created: ' ||
                COALESCE(v_document_name, v_document_type, v_document_id::text),
            'document',
            v_document_id,
            'Documents',
            'documents',
            v_document_id,
            NULL,
            v_document,
            'system',
            NULL,
            NULL,
            NULL,
            v_user_id
        );

        RETURN NEW;
    END IF;


    -- ========================================================
    -- UPDATE
    -- ========================================================

    IF TG_OP = 'UPDATE' THEN

        IF COALESCE(OLD.is_archived, false) = false
           AND COALESCE(NEW.is_archived, false) = true
        THEN
            v_action := 'ARCHIVED';
            v_description := 'Document Archived';

        ELSIF COALESCE(OLD.is_archived, false) = true
           AND COALESCE(NEW.is_archived, false) = false
        THEN
            v_action := 'RESTORED';
            v_description := 'Document Restored';

        ELSIF OLD.replaced_by_document_id IS DISTINCT FROM NEW.replaced_by_document_id
           OR OLD.replacement_of_document_id IS DISTINCT FROM NEW.replacement_of_document_id
        THEN
            v_action := 'REPLACED';
            v_description := 'Document Replaced';

        ELSE
            v_action := 'UPDATED';
            v_description := 'Document Updated';
        END IF;

        v_document := to_jsonb(NEW);
        v_document_id := NEW.id;
        v_group_id := NEW.document_group_id;
        v_version := NEW.version_number;
        v_document_type := NEW.document_type;
        v_document_name := NEW.document_name;

        INSERT INTO public.document_history (
            document_id,
            action,
            performed_by,
            performed_at,
            previous_document_id,
            new_document_id,
            document_group_id,
            version_number,
            document_snapshot
        )
        VALUES (
            v_document_id,
            v_action,
            v_user_id,
            now(),
            CASE
                WHEN v_action = 'REPLACED'
                THEN OLD.id
                ELSE NULL
            END,
            CASE
                WHEN v_action = 'REPLACED'
                THEN NEW.id
                ELSE NULL
            END,
            v_group_id,
            v_version,
            v_document
        );

        PERFORM public.write_audit_log(
            CASE v_action
                WHEN 'ARCHIVED' THEN 'Document Archived'
                WHEN 'RESTORED' THEN 'Document Restored'
                WHEN 'REPLACED' THEN 'Document Replaced'
                ELSE 'Document Updated'
            END,
            v_description || ': ' ||
                COALESCE(v_document_name, v_document_type, v_document_id::text),
            'document',
            v_document_id,
            'Documents',
            'documents',
            v_document_id,
            to_jsonb(OLD),
            v_document,
            'system',
            NULL,
            NULL,
            NULL,
            v_user_id
        );

        RETURN NEW;
    END IF;


    -- ========================================================
    -- DELETE
    --
    -- This trigger is now BEFORE DELETE.
    --
    -- Therefore OLD.id still exists in documents and the
    -- document_history FK remains valid.
    -- ========================================================

    IF TG_OP = 'DELETE' THEN

        v_action := 'DELETED';
        v_description := 'Document Deleted';

        v_document := to_jsonb(OLD);
        v_document_id := OLD.id;
        v_group_id := OLD.document_group_id;
        v_version := OLD.version_number;
        v_document_type := OLD.document_type;
        v_document_name := OLD.document_name;

        INSERT INTO public.document_history (
            document_id,
            action,
            performed_by,
            performed_at,
            previous_document_id,
            new_document_id,
            document_group_id,
            version_number,
            document_snapshot
        )
        VALUES (
            v_document_id,
            v_action,
            v_user_id,
            now(),
            v_document_id,
            NULL,
            v_group_id,
            v_version,
            v_document
        );

        PERFORM public.write_audit_log(
            'Document Deleted',
            'Document deleted: ' ||
                COALESCE(v_document_name, v_document_type, v_document_id::text),
            'document',
            v_document_id,
            'Documents',
            'documents',
            v_document_id,
            v_document,
            NULL,
            'system',
            NULL,
            NULL,
            NULL,
            v_user_id
        );

        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;


--
-- Name: audit_loan_agreement_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_loan_agreement_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_action text;
    v_description text;
    v_old_data jsonb;
    v_new_data jsonb;
BEGIN

    -- --------------------------------------------------------
    -- INSERT
    -- --------------------------------------------------------
    IF TG_OP = 'INSERT' THEN

        v_action := 'Loan Agreement Created';

        v_description :=
            'Loan agreement ' ||
            COALESCE(NEW.agreement_number, NEW.id::text) ||
            ' was created.';

        v_new_data := jsonb_build_object(
            'loan_id', NEW.loan_id,
            'customer_id', NEW.customer_id,
            'agreement_number', NEW.agreement_number,
            'agreement_version', NEW.agreement_version,
            'status', NEW.status,
            'generated_at', NEW.generated_at,
            'sent_at', NEW.sent_at,
            'document_path', NEW.document_path
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'loan_agreement',
            NEW.id,
            'Agreements',
            'loan_agreements',
            NEW.id,
            NULL,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.accepted_by, auth.uid())
        );

        RETURN NEW;
    END IF;


    -- --------------------------------------------------------
    -- UPDATE
    -- --------------------------------------------------------
    IF TG_OP = 'UPDATE' THEN

        IF OLD IS NOT DISTINCT FROM NEW THEN
            RETURN NEW;
        END IF;

        /*
         * accept_loan_agreement() already writes the complete
         * "Agreement Signed" audit record, including IP,
         * user-agent, acceptance text and signature reference.
         *
         * Therefore do NOT create a second audit record for
         * Pending/Sent -> Signed.
         */
        IF OLD.status IS DISTINCT FROM NEW.status
           AND NEW.status = 'Signed'
        THEN
            RETURN NEW;
        END IF;

        IF OLD.status IS DISTINCT FROM NEW.status THEN

            v_action := 'Loan Agreement Status Changed';

            v_description :=
                'Loan agreement ' ||
                COALESCE(NEW.agreement_number, NEW.id::text) ||
                ' status changed from ' ||
                COALESCE(OLD.status, 'NULL') ||
                ' to ' ||
                COALESCE(NEW.status, 'NULL') || '.';

        ELSIF OLD.sent_at IS DISTINCT FROM NEW.sent_at THEN

            v_action := 'Loan Agreement Sent';

            v_description :=
                'Loan agreement ' ||
                COALESCE(NEW.agreement_number, NEW.id::text) ||
                ' sent timestamp was updated.';

        ELSIF OLD.document_path IS DISTINCT FROM NEW.document_path THEN

            v_action := 'Loan Agreement Document Updated';

            v_description :=
                'Document path for loan agreement ' ||
                COALESCE(NEW.agreement_number, NEW.id::text) ||
                ' was updated.';

        ELSE

            v_action := 'Loan Agreement Updated';

            v_description :=
                'Loan agreement ' ||
                COALESCE(NEW.agreement_number, NEW.id::text) ||
                ' was updated.';

        END IF;

        v_old_data := jsonb_build_object(
            'loan_id', OLD.loan_id,
            'customer_id', OLD.customer_id,
            'agreement_number', OLD.agreement_number,
            'agreement_version', OLD.agreement_version,
            'status', OLD.status,
            'generated_at', OLD.generated_at,
            'sent_at', OLD.sent_at,
            'accepted_at', OLD.accepted_at,
            'accepted_by', OLD.accepted_by,
            'digital_signature_reference',
                OLD.digital_signature_reference,
            'document_path', OLD.document_path,
            'accepted_ip_address', OLD.accepted_ip_address,
            'accepted_user_agent', OLD.accepted_user_agent,
            'customer_name_at_acceptance',
                OLD.customer_name_at_acceptance
        );

        v_new_data := jsonb_build_object(
            'loan_id', NEW.loan_id,
            'customer_id', NEW.customer_id,
            'agreement_number', NEW.agreement_number,
            'agreement_version', NEW.agreement_version,
            'status', NEW.status,
            'generated_at', NEW.generated_at,
            'sent_at', NEW.sent_at,
            'accepted_at', NEW.accepted_at,
            'accepted_by', NEW.accepted_by,
            'digital_signature_reference',
                NEW.digital_signature_reference,
            'document_path', NEW.document_path,
            'accepted_ip_address', NEW.accepted_ip_address,
            'accepted_user_agent', NEW.accepted_user_agent,
            'customer_name_at_acceptance',
                NEW.customer_name_at_acceptance
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'loan_agreement',
            NEW.id,
            'Agreements',
            'loan_agreements',
            NEW.id,
            v_old_data,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.accepted_by, auth.uid())
        );

        RETURN NEW;
    END IF;


    -- --------------------------------------------------------
    -- DELETE
    -- --------------------------------------------------------
    IF TG_OP = 'DELETE' THEN

        v_action := 'Loan Agreement Deleted';

        v_description :=
            'Loan agreement ' ||
            COALESCE(OLD.agreement_number, OLD.id::text) ||
            ' was deleted.';

        v_old_data := jsonb_build_object(
            'loan_id', OLD.loan_id,
            'customer_id', OLD.customer_id,
            'agreement_number', OLD.agreement_number,
            'agreement_version', OLD.agreement_version,
            'status', OLD.status,
            'generated_at', OLD.generated_at,
            'sent_at', OLD.sent_at,
            'accepted_at', OLD.accepted_at,
            'accepted_by', OLD.accepted_by,
            'digital_signature_reference',
                OLD.digital_signature_reference,
            'document_path', OLD.document_path,
            'accepted_ip_address', OLD.accepted_ip_address,
            'accepted_user_agent', OLD.accepted_user_agent,
            'customer_name_at_acceptance',
                OLD.customer_name_at_acceptance
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'loan_agreement',
            OLD.id,
            'Agreements',
            'loan_agreements',
            OLD.id,
            v_old_data,
            NULL,
            'system',
            NULL,
            NULL,
            NULL,
            auth.uid()
        );

        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;


--
-- Name: audit_loan_application_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_loan_application_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_action text;
    v_description text;
    v_old_data jsonb;
    v_new_data jsonb;
BEGIN
    IF TG_OP = 'INSERT' THEN

        v_action := 'Application Created';

        v_description :=
            'Loan application ' ||
            COALESCE(NEW.application_number, NEW.id::text) ||
            ' was created.';

        v_new_data := jsonb_build_object(
            'application_number', NEW.application_number,
            'customer_id', NEW.customer_id,
            'first_name', NEW.first_name,
            'last_name', NEW.last_name,
            'amount_requested', NEW.amount_requested,
            'application_date', NEW.application_date,
            'status', NEW.status,
            'created_by', NEW.created_by
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'loan_application',
            NEW.id,
            'Applications',
            'loan_applications',
            NEW.id,
            NULL,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.created_by, auth.uid())
        );

        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN

        IF OLD IS NOT DISTINCT FROM NEW THEN
            RETURN NEW;
        END IF;

        IF OLD.status IS DISTINCT FROM NEW.status THEN
            v_action := 'Application Status Changed';

            v_description :=
                'Loan application ' ||
                COALESCE(NEW.application_number, NEW.id::text) ||
                ' status changed from ' ||
                COALESCE(OLD.status, 'NULL') ||
                ' to ' ||
                COALESCE(NEW.status, 'NULL') ||
                '.';
        ELSE
            v_action := 'Application Updated';

            v_description :=
                'Loan application ' ||
                COALESCE(NEW.application_number, NEW.id::text) ||
                ' was updated.';
        END IF;

        v_old_data := jsonb_build_object(
            'application_number', OLD.application_number,
            'customer_id', OLD.customer_id,
            'first_name', OLD.first_name,
            'last_name', OLD.last_name,
            'amount_requested', OLD.amount_requested,
            'application_date', OLD.application_date,
            'status', OLD.status,
            'reviewed_by', OLD.reviewed_by,
            'reviewed_at', OLD.reviewed_at,
            'approved_loan_id', OLD.approved_loan_id
        );

        v_new_data := jsonb_build_object(
            'application_number', NEW.application_number,
            'customer_id', NEW.customer_id,
            'first_name', NEW.first_name,
            'last_name', NEW.last_name,
            'amount_requested', NEW.amount_requested,
            'application_date', NEW.application_date,
            'status', NEW.status,
            'reviewed_by', NEW.reviewed_by,
            'reviewed_at', NEW.reviewed_at,
            'approved_loan_id', NEW.approved_loan_id
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'loan_application',
            NEW.id,
            'Applications',
            'loan_applications',
            NEW.id,
            v_old_data,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.reviewed_by, NEW.created_by, auth.uid())
        );

        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN

        v_action := 'Application Deleted';

        v_description :=
            'Loan application ' ||
            COALESCE(OLD.application_number, OLD.id::text) ||
            ' was deleted.';

        v_old_data := jsonb_build_object(
            'application_number', OLD.application_number,
            'customer_id', OLD.customer_id,
            'first_name', OLD.first_name,
            'last_name', OLD.last_name,
            'amount_requested', OLD.amount_requested,
            'application_date', OLD.application_date,
            'status', OLD.status,
            'reviewed_by', OLD.reviewed_by,
            'reviewed_at', OLD.reviewed_at,
            'approved_loan_id', OLD.approved_loan_id
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'loan_application',
            OLD.id,
            'Applications',
            'loan_applications',
            OLD.id,
            v_old_data,
            NULL,
            'system',
            NULL,
            NULL,
            NULL,
            auth.uid()
        );

        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;


--
-- Name: audit_loan_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_loan_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_action text;
    v_description text;
    v_old_data jsonb;
    v_new_data jsonb;
BEGIN

    IF TG_OP = 'INSERT' THEN

        v_action := 'Loan Created';

        v_description :=
            'Loan ' ||
            COALESCE(NEW.loan_number, NEW.id::text) ||
            ' was created.';

        v_new_data := jsonb_build_object(
            'loan_number', NEW.loan_number,
            'customer_id', NEW.customer_id,
            'application_id', NEW.application_id,
            'principal_amount', NEW.principal_amount,
            'interest_rate', NEW.interest_rate,
            'interest_amount', NEW.interest_amount,
            'current_balance', NEW.current_balance,
            'total_paid', NEW.total_paid,
            'total_repayment', NEW.total_repayment,
            'loan_status', NEW.loan_status,
            'term_months', NEW.term_months,
            'monthly_repayment', NEW.monthly_repayment,
            'first_payment_date', NEW.first_payment_date,
            'next_payment_date', NEW.next_payment_date,
            'next_interest_date', NEW.next_interest_date,
            'created_by', NEW.created_by
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'loan',
            NEW.id,
            'Loans',
            'loans',
            NEW.id,
            NULL,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.created_by, auth.uid())
        );

        RETURN NEW;
    END IF;


    IF TG_OP = 'UPDATE' THEN

        -- Ignore updates where absolutely nothing changed.
        IF OLD IS NOT DISTINCT FROM NEW THEN
            RETURN NEW;
        END IF;

        IF OLD.loan_status IS DISTINCT FROM NEW.loan_status THEN

            v_action := 'Loan Status Changed';

            v_description :=
                'Loan ' ||
                COALESCE(NEW.loan_number, NEW.id::text) ||
                ' status changed from ' ||
                COALESCE(OLD.loan_status, 'NULL') ||
                ' to ' ||
                COALESCE(NEW.loan_status, 'NULL') ||
                '.';

        ELSIF OLD.current_balance IS DISTINCT FROM NEW.current_balance
           OR OLD.total_paid IS DISTINCT FROM NEW.total_paid
           OR OLD.last_payment_date IS DISTINCT FROM NEW.last_payment_date THEN

            v_action := 'Loan Balance Updated';

            v_description :=
                'Loan ' ||
                COALESCE(NEW.loan_number, NEW.id::text) ||
                ' financial balance was updated.';

        ELSIF OLD.interest_amount IS DISTINCT FROM NEW.interest_amount
           OR OLD.next_interest_date IS DISTINCT FROM NEW.next_interest_date
           OR OLD.last_interest_date IS DISTINCT FROM NEW.last_interest_date THEN

            v_action := 'Loan Interest Updated';

            v_description :=
                'Interest information for loan ' ||
                COALESCE(NEW.loan_number, NEW.id::text) ||
                ' was updated.';

        ELSIF OLD.is_deleted IS DISTINCT FROM NEW.is_deleted THEN

            IF NEW.is_deleted = true THEN
                v_action := 'Loan Deleted';
                v_description :=
                    'Loan ' ||
                    COALESCE(NEW.loan_number, NEW.id::text) ||
                    ' was marked as deleted.';
            ELSE
                v_action := 'Loan Restored';
                v_description :=
                    'Loan ' ||
                    COALESCE(NEW.loan_number, NEW.id::text) ||
                    ' was restored.';
            END IF;

        ELSIF OLD.agreement_sent_at IS DISTINCT FROM NEW.agreement_sent_at
           OR OLD.agreement_accepted_at IS DISTINCT FROM NEW.agreement_accepted_at
           OR OLD.agreement_version IS DISTINCT FROM NEW.agreement_version THEN

            v_action := 'Loan Agreement Updated';

            v_description :=
                'Agreement information for loan ' ||
                COALESCE(NEW.loan_number, NEW.id::text) ||
                ' was updated.';

        ELSE

            v_action := 'Loan Updated';

            v_description :=
                'Loan ' ||
                COALESCE(NEW.loan_number, NEW.id::text) ||
                ' was updated.';

        END IF;


        v_old_data := jsonb_build_object(
            'loan_number', OLD.loan_number,
            'customer_id', OLD.customer_id,
            'application_id', OLD.application_id,
            'principal_amount', OLD.principal_amount,
            'interest_rate', OLD.interest_rate,
            'interest_amount', OLD.interest_amount,
            'current_balance', OLD.current_balance,
            'total_paid', OLD.total_paid,
            'total_repayment', OLD.total_repayment,
            'loan_status', OLD.loan_status,
            'term_months', OLD.term_months,
            'monthly_repayment', OLD.monthly_repayment,
            'first_payment_date', OLD.first_payment_date,
            'next_payment_date', OLD.next_payment_date,
            'next_interest_date', OLD.next_interest_date,
            'last_interest_date', OLD.last_interest_date,
            'last_payment_date', OLD.last_payment_date,
            'is_deleted', OLD.is_deleted,
            'agreement_sent_at', OLD.agreement_sent_at,
            'agreement_accepted_at', OLD.agreement_accepted_at,
            'agreement_version', OLD.agreement_version,
            'document_check_skipped', OLD.document_check_skipped,
            'notes', OLD.notes
        );

        v_new_data := jsonb_build_object(
            'loan_number', NEW.loan_number,
            'customer_id', NEW.customer_id,
            'application_id', NEW.application_id,
            'principal_amount', NEW.principal_amount,
            'interest_rate', NEW.interest_rate,
            'interest_amount', NEW.interest_amount,
            'current_balance', NEW.current_balance,
            'total_paid', NEW.total_paid,
            'total_repayment', NEW.total_repayment,
            'loan_status', NEW.loan_status,
            'term_months', NEW.term_months,
            'monthly_repayment', NEW.monthly_repayment,
            'first_payment_date', NEW.first_payment_date,
            'next_payment_date', NEW.next_payment_date,
            'next_interest_date', NEW.next_interest_date,
            'last_interest_date', NEW.last_interest_date,
            'last_payment_date', NEW.last_payment_date,
            'is_deleted', NEW.is_deleted,
            'agreement_sent_at', NEW.agreement_sent_at,
            'agreement_accepted_at', NEW.agreement_accepted_at,
            'agreement_version', NEW.agreement_version,
            'document_check_skipped', NEW.document_check_skipped,
            'notes', NEW.notes
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'loan',
            NEW.id,
            'Loans',
            'loans',
            NEW.id,
            v_old_data,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.created_by, auth.uid())
        );

        RETURN NEW;
    END IF;


    IF TG_OP = 'DELETE' THEN

        v_action := 'Loan Deleted';

        v_description :=
            'Loan ' ||
            COALESCE(OLD.loan_number, OLD.id::text) ||
            ' was permanently deleted.';

        v_old_data := jsonb_build_object(
            'loan_number', OLD.loan_number,
            'customer_id', OLD.customer_id,
            'application_id', OLD.application_id,
            'principal_amount', OLD.principal_amount,
            'interest_rate', OLD.interest_rate,
            'interest_amount', OLD.interest_amount,
            'current_balance', OLD.current_balance,
            'total_paid', OLD.total_paid,
            'total_repayment', OLD.total_repayment,
            'loan_status', OLD.loan_status,
            'term_months', OLD.term_months,
            'monthly_repayment', OLD.monthly_repayment,
            'first_payment_date', OLD.first_payment_date,
            'next_payment_date', OLD.next_payment_date,
            'next_interest_date', OLD.next_interest_date,
            'last_interest_date', OLD.last_interest_date,
            'last_payment_date', OLD.last_payment_date,
            'is_deleted', OLD.is_deleted,
            'agreement_sent_at', OLD.agreement_sent_at,
            'agreement_accepted_at', OLD.agreement_accepted_at,
            'agreement_version', OLD.agreement_version,
            'document_check_skipped', OLD.document_check_skipped,
            'notes', OLD.notes
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'loan',
            OLD.id,
            'Loans',
            'loans',
            OLD.id,
            v_old_data,
            NULL,
            'system',
            NULL,
            NULL,
            NULL,
            auth.uid()
        );

        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;


--
-- Name: audit_loan_transaction_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_loan_transaction_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_action text;
    v_description text;
    v_old_data jsonb;
    v_new_data jsonb;
BEGIN

    IF TG_OP = 'INSERT' THEN

        v_action := 'Loan Transaction Created';

        v_description :=
            'Loan transaction ' ||
            COALESCE(NEW.reference_number, NEW.id::text) ||
            ' was created.';

        v_new_data := jsonb_build_object(
            'loan_id', NEW.loan_id,
            'transaction_date', NEW.transaction_date,
            'transaction_type', NEW.transaction_type,
            'description', NEW.description,
            'debit', NEW.debit,
            'credit', NEW.credit,
            'balance', NEW.balance,
            'created_by', NEW.created_by,
            'reference_number', NEW.reference_number,
            'payment_method', NEW.payment_method
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'loan_transaction',
            NEW.id,
            'Loan Transactions',
            'loan_transactions',
            NEW.id,
            NULL,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.created_by, auth.uid())
        );

        RETURN NEW;
    END IF;


    IF TG_OP = 'UPDATE' THEN

        IF OLD IS NOT DISTINCT FROM NEW THEN
            RETURN NEW;
        END IF;

        v_action := 'Loan Transaction Updated';

        v_description :=
            'Loan transaction ' ||
            COALESCE(NEW.reference_number, NEW.id::text) ||
            ' was updated.';

        v_old_data := jsonb_build_object(
            'loan_id', OLD.loan_id,
            'transaction_date', OLD.transaction_date,
            'transaction_type', OLD.transaction_type,
            'description', OLD.description,
            'debit', OLD.debit,
            'credit', OLD.credit,
            'balance', OLD.balance,
            'created_by', OLD.created_by,
            'reference_number', OLD.reference_number,
            'payment_method', OLD.payment_method
        );

        v_new_data := jsonb_build_object(
            'loan_id', NEW.loan_id,
            'transaction_date', NEW.transaction_date,
            'transaction_type', NEW.transaction_type,
            'description', NEW.description,
            'debit', NEW.debit,
            'credit', NEW.credit,
            'balance', NEW.balance,
            'created_by', NEW.created_by,
            'reference_number', NEW.reference_number,
            'payment_method', NEW.payment_method
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'loan_transaction',
            NEW.id,
            'Loan Transactions',
            'loan_transactions',
            NEW.id,
            v_old_data,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.created_by, auth.uid())
        );

        RETURN NEW;
    END IF;


    IF TG_OP = 'DELETE' THEN

        v_action := 'Loan Transaction Deleted';

        v_description :=
            'Loan transaction ' ||
            COALESCE(OLD.reference_number, OLD.id::text) ||
            ' was deleted.';

        v_old_data := jsonb_build_object(
            'loan_id', OLD.loan_id,
            'transaction_date', OLD.transaction_date,
            'transaction_type', OLD.transaction_type,
            'description', OLD.description,
            'debit', OLD.debit,
            'credit', OLD.credit,
            'balance', OLD.balance,
            'created_by', OLD.created_by,
            'reference_number', OLD.reference_number,
            'payment_method', OLD.payment_method
        );

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'loan_transaction',
            OLD.id,
            'Loan Transactions',
            'loan_transactions',
            OLD.id,
            v_old_data,
            NULL,
            'system',
            NULL,
            NULL,
            NULL,
            auth.uid()
        );

        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;


--
-- Name: audit_mobile_device_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_mobile_device_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_action text;
    v_description text;
    v_old_data jsonb;
    v_new_data jsonb;
    v_channel text;
    v_installation_id uuid;
    v_record_id uuid;
BEGIN

    IF TG_OP = 'INSERT' THEN

        v_record_id := NEW.id;
        v_installation_id := NEW.system_settings_id;

        v_action := 'Mobile Device Paired';

        v_description :=
            'Mobile device "' ||
            COALESCE(NEW.device_name, NEW.device_id, 'Unknown Device') ||
            '" was paired with the LMS.';

        v_old_data := NULL;
        v_new_data := to_jsonb(NEW);

        -- A device record is created by the mobile pairing flow.
        v_channel := 'mobile';

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'mobile_device',
            v_record_id,
            'Mobile',
            'mobile_devices',
            v_record_id,
            v_old_data,
            v_new_data,
            v_channel,
            v_installation_id,
            NULL,
            NULL,
            auth.uid()
        );

        RETURN NEW;


    ELSIF TG_OP = 'UPDATE' THEN

        v_record_id := NEW.id;
        v_installation_id := NEW.system_settings_id;

        -- ----------------------------------------------------
        -- Revocation
        -- ----------------------------------------------------

        IF OLD.revoked_at IS NULL
           AND NEW.revoked_at IS NOT NULL THEN

            v_action := 'Mobile Device Revoked';

            v_description :=
                'Mobile device "' ||
                COALESCE(NEW.device_name, NEW.device_id, 'Unknown Device') ||
                '" was revoked.';

            v_channel := 'system';


        -- ----------------------------------------------------
        -- Restoration / re-pairing
        -- ----------------------------------------------------

        ELSIF OLD.revoked_at IS NOT NULL
              AND NEW.revoked_at IS NULL THEN

            v_action := 'Mobile Device Re-linked';

            v_description :=
                'Previously revoked mobile device "' ||
                COALESCE(NEW.device_name, NEW.device_id, 'Unknown Device') ||
                '" was re-linked.';

            v_channel := 'mobile';


        -- ----------------------------------------------------
        -- Push notification state
        -- ----------------------------------------------------

        ELSIF OLD.push_enabled IS DISTINCT FROM NEW.push_enabled THEN

            IF NEW.push_enabled THEN
                v_action := 'Mobile Push Enabled';
                v_description :=
                    'Push notifications were enabled for mobile device "' ||
                    COALESCE(NEW.device_name, NEW.device_id, 'Unknown Device') ||
                    '".';
            ELSE
                v_action := 'Mobile Push Disabled';
                v_description :=
                    'Push notifications were disabled for mobile device "' ||
                    COALESCE(NEW.device_name, NEW.device_id, 'Unknown Device') ||
                    '".';
            END IF;

            v_channel := 'mobile';


        -- ----------------------------------------------------
        -- General device update
        -- ----------------------------------------------------

        ELSE

            v_action := 'Mobile Device Updated';

            v_description :=
                'Mobile device "' ||
                COALESCE(NEW.device_name, NEW.device_id, 'Unknown Device') ||
                '" was updated.';

            v_channel := 'mobile';

        END IF;

        v_old_data := to_jsonb(OLD);
        v_new_data := to_jsonb(NEW);

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'mobile_device',
            v_record_id,
            'Mobile',
            'mobile_devices',
            v_record_id,
            v_old_data,
            v_new_data,
            v_channel,
            v_installation_id,
            NULL,
            NULL,
            auth.uid()
        );

        RETURN NEW;


    ELSIF TG_OP = 'DELETE' THEN

        v_record_id := OLD.id;
        v_installation_id := OLD.system_settings_id;

        v_action := 'Mobile Device Deleted';

        v_description :=
            'Mobile device "' ||
            COALESCE(OLD.device_name, OLD.device_id, 'Unknown Device') ||
            '" was deleted.';

        v_old_data := to_jsonb(OLD);
        v_new_data := NULL;

        v_channel := 'system';

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'mobile_device',
            v_record_id,
            'Mobile',
            'mobile_devices',
            v_record_id,
            v_old_data,
            v_new_data,
            v_channel,
            v_installation_id,
            NULL,
            NULL,
            auth.uid()
        );

        RETURN OLD;

    END IF;

    RETURN NULL;

END;
$$;


--
-- Name: audit_system_settings_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_system_settings_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_action text;
    v_description text;
    v_old_data jsonb;
    v_new_data jsonb;
BEGIN

    IF TG_OP = 'INSERT' THEN

        v_action := 'Settings Created';

        v_description :=
            'System settings record created.';

        v_old_data := NULL;
        v_new_data := to_jsonb(NEW);

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'system_settings',
            NEW.id,
            'Settings',
            'system_settings',
            NEW.id,
            v_old_data,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.updated_by, auth.uid())
        );

        RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN

        v_action := 'Settings Updated';

        v_description :=
            'System settings were updated.';

        v_old_data := to_jsonb(OLD);
        v_new_data := to_jsonb(NEW);

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'system_settings',
            NEW.id,
            'Settings',
            'system_settings',
            NEW.id,
            v_old_data,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(NEW.updated_by, auth.uid())
        );

        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN

        v_action := 'Settings Deleted';

        v_description :=
            'System settings record deleted.';

        v_old_data := to_jsonb(OLD);
        v_new_data := NULL;

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'system_settings',
            OLD.id,
            'Settings',
            'system_settings',
            OLD.id,
            v_old_data,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(OLD.updated_by, auth.uid())
        );

        RETURN OLD;

    END IF;

    RETURN NULL;

END;
$$;


--
-- Name: audit_user_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_user_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_action text;
    v_description text;
    v_old_data jsonb;
    v_new_data jsonb;
    v_record_id uuid;
BEGIN

    IF TG_OP = 'INSERT' THEN

        v_record_id := NEW.id;

        v_action := 'User Created';

        v_description :=
            'System user account was created.';

        v_old_data := NULL;
        v_new_data := to_jsonb(NEW);

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'user',
            v_record_id,
            'Users',
            'users',
            v_record_id,
            v_old_data,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            COALESCE(auth.uid(), NEW.id)
        );

        RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN

        v_record_id := NEW.id;

        -- Identify important security/account changes.
        IF COALESCE(OLD.role, '') IS DISTINCT FROM COALESCE(NEW.role, '') THEN

            v_action := 'User Role Changed';

            v_description :=
                'User role changed from "' ||
                COALESCE(OLD.role, '') ||
                '" to "' ||
                COALESCE(NEW.role, '') ||
                '".';

        ELSIF COALESCE(OLD.is_active, false)
              IS DISTINCT FROM COALESCE(NEW.is_active, false) THEN

            v_action := 'User Active Status Changed';

            v_description :=
                'User active status changed from ' ||
                COALESCE(OLD.is_active, false)::text ||
                ' to ' ||
                COALESCE(NEW.is_active, false)::text ||
                '.';

        ELSIF COALESCE(OLD.is_deleted, false)
              IS DISTINCT FROM COALESCE(NEW.is_deleted, false) THEN

            IF COALESCE(NEW.is_deleted, false) THEN
                v_action := 'User Deleted';
                v_description := 'User account was marked as deleted.';
            ELSE
                v_action := 'User Restored';
                v_description := 'User account was restored.';
            END IF;

        ELSE

            v_action := 'User Updated';

            v_description :=
                'User account details were updated.';

        END IF;

        v_old_data := to_jsonb(OLD);
        v_new_data := to_jsonb(NEW);

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'user',
            v_record_id,
            'Users',
            'users',
            v_record_id,
            v_old_data,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            auth.uid()
        );

        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN

        v_record_id := OLD.id;

        v_action := 'User Deleted';

        v_description :=
            'User account was physically deleted.';

        v_old_data := to_jsonb(OLD);
        v_new_data := NULL;

        PERFORM public.write_audit_log(
            v_action,
            v_description,
            'user',
            v_record_id,
            'Users',
            'users',
            v_record_id,
            v_old_data,
            v_new_data,
            'system',
            NULL,
            NULL,
            NULL,
            auth.uid()
        );

        RETURN OLD;

    END IF;

    RETURN NULL;

END;
$$;


--
-- Name: authorize_loan_application_document_upload(uuid, text, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.authorize_loan_application_document_upload(p_application_id uuid, p_upload_token text, p_file_size_bytes bigint) RETURNS TABLE(authorized boolean, application_id uuid, application_number text, max_files integer, max_file_size_bytes bigint, uploaded_file_count bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_token_hash text;
    v_application_number text;
    v_max_files integer;
    v_max_file_size_bytes bigint;
    v_uploaded_file_count bigint;
BEGIN
    IF p_application_id IS NULL
       OR NULLIF(TRIM(p_upload_token), '') IS NULL
       OR p_file_size_bytes IS NULL
       OR p_file_size_bytes <= 0 THEN

        RETURN QUERY
        SELECT
            false,
            NULL::uuid,
            NULL::text,
            NULL::integer,
            NULL::bigint,
            0::bigint;

        RETURN;
    END IF;

    v_token_hash := encode(
        digest(TRIM(p_upload_token), 'sha256'),
        'hex'
    );

    SELECT
        la.application_number,
        t.max_files,
        t.max_file_size_bytes
    INTO
        v_application_number,
        v_max_files,
        v_max_file_size_bytes
    FROM public.loan_application_upload_tokens t
    JOIN public.loan_applications la
      ON la.id = t.application_id
    WHERE t.application_id = p_application_id
      AND t.token_hash = v_token_hash
      AND t.expires_at > now()
      AND t.used_at IS NULL
      AND la.status = 'PENDING'
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN QUERY
        SELECT
            false,
            NULL::uuid,
            NULL::text,
            NULL::integer,
            NULL::bigint,
            0::bigint;

        RETURN;
    END IF;

    SELECT COUNT(*)
    INTO v_uploaded_file_count
    FROM public.documents d
    WHERE d.application_id = p_application_id
      AND d.deleted_at IS NULL;

    IF p_file_size_bytes > v_max_file_size_bytes
       OR v_uploaded_file_count >= v_max_files THEN

        RETURN QUERY
        SELECT
            false,
            p_application_id,
            v_application_number,
            v_max_files,
            v_max_file_size_bytes,
            v_uploaded_file_count;

        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        true,
        p_application_id,
        v_application_number,
        v_max_files,
        v_max_file_size_bytes,
        v_uploaded_file_count;
END;
$$;


--
-- Name: calculate_initial_loan_balance(numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_initial_loan_balance(p_principal numeric, p_interest_rate numeric) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
begin

    return round(
        p_principal +
        (p_principal * p_interest_rate / 100),
        2
    );

end;
$$;


--
-- Name: calculate_loan_interest_rate(numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_loan_interest_rate(p_principal numeric) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
begin

    if p_principal <= 2000 then
        return 40.00;
    else
        return 30.00;
    end if;

end;
$$;


--
-- Name: can_apply_loan_interest(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_apply_loan_interest(p_loan_id uuid) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
declare
    v_status text;
    v_balance numeric;
    v_deleted boolean;
begin

    select
        loan_status,
        current_balance,
        is_deleted
    into
        v_status,
        v_balance,
        v_deleted
    from public.loans
    where id = p_loan_id;

    if not found then
        return false;
    end if;

    if v_deleted = true then
        return false;
    end if;

    if v_status <> 'Active' then
        return false;
    end if;

    if coalesce(v_balance, 0) <= 0 then
        return false;
    end if;

    return true;

end;
$$;


--
-- Name: check_document_storage_alert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_document_storage_alert() RETURNS TABLE(alert_created boolean, status text, usage_percent numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_usage bigint;
  v_capacity bigint;
  v_warning numeric;
  v_urgent numeric;
  v_critical numeric;
  v_percent numeric;
  v_status text;
  v_threshold numeric;
  v_alert_key text;
  v_inserted boolean := false;
BEGIN

  IF NOT public.current_user_is_active_admin() THEN
    RAISE EXCEPTION
      'Only an active Administrator can check document storage alerts.';
  END IF;

  SELECT
    s.storage_capacity_bytes,
    s.warning_threshold_percent,
    s.urgent_threshold_percent,
    s.critical_threshold_percent
  INTO
    v_capacity,
    v_warning,
    v_urgent,
    v_critical
  FROM public.document_storage_settings s
  LIMIT 1;

  SELECT COALESCE(
    SUM(
      CASE
        WHEN file_size_bytes IS NULL OR file_size_bytes < 0
          THEN 0::bigint
        ELSE file_size_bytes
      END
    ),
    0::bigint
  )
  INTO v_usage
  FROM public.documents;

  v_percent :=
    ROUND(
      ((v_usage::numeric / v_capacity::numeric) * 100),
      2
    );

  IF v_percent >= v_critical THEN
    v_status := 'CRITICAL';
    v_threshold := v_critical;

  ELSIF v_percent >= v_urgent THEN
    v_status := 'URGENT';
    v_threshold := v_urgent;

  ELSIF v_percent >= v_warning THEN
    v_status := 'WARNING';
    v_threshold := v_warning;

  ELSE
    v_status := 'NORMAL';
    v_threshold := v_warning;
  END IF;

  IF v_status <> 'NORMAL' THEN

    v_alert_key :=
      TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
      || ':'
      || v_threshold::text;

    INSERT INTO public.document_storage_alerts (
      threshold_percent,
      usage_bytes,
      capacity_bytes,
      usage_percent,
      alert_key,
      status
    )
    VALUES (
      v_threshold,
      v_usage,
      v_capacity,
      v_percent,
      v_alert_key,
      'ACTIVE'
    )
    ON CONFLICT (alert_key)
    DO NOTHING;

    v_inserted := FOUND;
  END IF;

  RETURN QUERY
  SELECT
    v_inserted,
    v_status,
    v_percent;
END;
$$;


--
-- Name: clear_resolved_storage_notifications(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clear_resolved_storage_notifications() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

DECLARE
    v_resolved_count integer := 0;
    v_monitor_result jsonb;
BEGIN

    /*
       A notification is considered resolved when
       metadata.resolved_at has been populated.
    */

    UPDATE public.document_storage_notifications
    SET metadata =
        COALESCE(metadata, '{}'::jsonb)
        ||
        jsonb_build_object(
            'cleanup_at',
            now()
        )
    WHERE COALESCE(
        metadata ->> 'resolved_at',
        ''
    ) <> '';

    GET DIAGNOSTICS v_resolved_count = ROW_COUNT;


    /* Re-run the monitor so storage state remains current. */

    v_monitor_result :=
        public.monitor_document_storage();


    RETURN jsonb_build_object(
        'success',
        true,

        'resolved_count',
        v_resolved_count,

        'monitor_result',
        v_monitor_result,

        'processed_at',
        now()
    );

END;
$$;


--
-- Name: create_company_borrowing(text, numeric, date, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_company_borrowing(p_lender_name text, p_amount numeric, p_borrowing_date date, p_description text, p_reference text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

DECLARE
    v_account_id uuid;
    v_current_balance numeric;
    v_new_balance numeric;
    v_borrowing_id uuid;
    v_transaction_id uuid;
BEGIN

    IF NOT public.is_current_user_admin() THEN
        RAISE EXCEPTION 'Only administrators can record company borrowing.';
    END IF;

    IF p_lender_name IS NULL
       OR trim(p_lender_name) = '' THEN
        RAISE EXCEPTION 'Lender name is required.';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Borrowing amount must be greater than zero.';
    END IF;

    SELECT id
    INTO v_account_id
    FROM public.bank_accounts
    WHERE is_active = true
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'Create the initial bank balance first.';
    END IF;

    SELECT COALESCE(
        SUM(
            CASE
                WHEN direction = 'IN' THEN amount
                ELSE -amount
            END
        ),
        0
    )
    INTO v_current_balance
    FROM public.bank_transactions
    WHERE bank_account_id = v_account_id
      AND is_void = false;

    v_new_balance := ROUND(v_current_balance + p_amount, 2);

    INSERT INTO public.company_borrowings (
        lender_name,
        borrowing_date,
        original_amount,
        amount_repaid,
        outstanding_amount,
        description,
        reference,
        status,
        created_by
    )
    VALUES (
        trim(p_lender_name),
        COALESCE(p_borrowing_date, CURRENT_DATE),
        p_amount,
        0,
        p_amount,
        NULLIF(trim(p_description), ''),
        NULLIF(trim(p_reference), ''),
        'Outstanding',
        auth.uid()
    )
    RETURNING id INTO v_borrowing_id;

    INSERT INTO public.bank_transactions (
        bank_account_id,
        transaction_date,
        transaction_type,
        description,
        amount,
        direction,
        balance_after,
        borrowing_id,
        reference,
        created_by
    )
    VALUES (
        v_account_id,
        COALESCE(p_borrowing_date, CURRENT_DATE),
        'BORROWING',
        'Company borrowing from ' || trim(p_lender_name),
        p_amount,
        'IN',
        v_new_balance,
        v_borrowing_id,
        NULLIF(trim(p_reference), ''),
        auth.uid()
    )
    RETURNING id INTO v_transaction_id;

    RETURN json_build_object(
        'success', true,
        'borrowing_id', v_borrowing_id,
        'transaction_id', v_transaction_id,
        'new_balance', v_new_balance,
        'outstanding_amount', p_amount
    );

END;
$$;


--
-- Name: create_company_borrowing_with_agreement(text, numeric, date, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_company_borrowing_with_agreement(p_lender_name text, p_amount numeric, p_borrowing_date date, p_description text DEFAULT NULL::text, p_reference text DEFAULT NULL::text, p_borrowing_agreement_path text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_borrowing public.company_borrowings%rowtype;
  v_bank_account_id uuid;
  v_balance_after numeric(15,2);
begin
  if not public.current_user_is_active_admin() then
    raise exception 'Only active administrators can record company borrowings.';
  end if;

  if coalesce(trim(p_lender_name), '') = '' then
    raise exception 'Lender name is required.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Borrowing amount must be greater than zero.';
  end if;

  if coalesce(trim(p_reference), '') = '' then
    raise exception 'Borrowing reference is required.';
  end if;

  if coalesce(trim(p_borrowing_agreement_path), '') = '' then
    raise exception 'Borrowing agreement is required.';
  end if;

  select id
    into v_bank_account_id
  from public.bank_accounts
  where is_active = true
  order by created_at asc
  limit 1;

  if v_bank_account_id is null then
    raise exception 'No active company bank account was found.';
  end if;

  insert into public.company_borrowings (
    lender_name,
    original_amount,
    amount_repaid,
    outstanding_amount,
    status,
    borrowing_date,
    description,
    reference,
    borrowing_agreement_path
  )
  values (
    trim(p_lender_name),
    p_amount,
    0,
    p_amount,
    'Unpaid',
    p_borrowing_date,
    p_description,
    trim(p_reference),
    p_borrowing_agreement_path
  )
  returning * into v_borrowing;

  select coalesce(sum(
    case when direction = 'IN' then amount else -amount end
  ), 0)
    into v_balance_after
  from public.bank_transactions
  where is_void = false;

  v_balance_after := v_balance_after + p_amount;

  insert into public.bank_transactions (
    bank_account_id,
    transaction_date,
    transaction_type,
    direction,
    amount,
    description,
    reference,
    is_void,
    balance_after
  )
  values (
    v_bank_account_id,
    p_borrowing_date,
    'BORROWING',
    'IN',
    p_amount,
    coalesce(p_description, 'Company borrowing from ' || trim(p_lender_name)),
    trim(p_reference),
    false,
    v_balance_after
  );

  return to_jsonb(v_borrowing);
end;
$$;


--
-- Name: create_initial_bank_balance(text, text, numeric, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_initial_bank_balance(p_account_name text, p_bank_name text, p_amount numeric, p_transaction_date date, p_description text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

DECLARE
    v_account_id uuid;
    v_transaction_id uuid;
BEGIN

    IF NOT public.is_current_user_admin() THEN
        RAISE EXCEPTION 'Only administrators can create the initial bank balance.';
    END IF;

    IF p_amount IS NULL OR p_amount < 0 THEN
        RAISE EXCEPTION 'Initial balance cannot be negative.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.bank_transactions
        WHERE transaction_type = 'INITIAL_BALANCE'
          AND is_void = false
    ) THEN
        RAISE EXCEPTION 'The initial bank balance has already been created.';
    END IF;

    INSERT INTO public.bank_accounts (
        account_name,
        bank_name,
        opening_balance,
        created_by
    )
    VALUES (
        COALESCE(NULLIF(trim(p_account_name), ''), 'Company Bank Account'),
        NULLIF(trim(p_bank_name), ''),
        p_amount,
        auth.uid()
    )
    RETURNING id INTO v_account_id;

    INSERT INTO public.bank_transactions (
        bank_account_id,
        transaction_date,
        transaction_type,
        description,
        amount,
        direction,
        balance_after,
        created_by
    )
    VALUES (
        v_account_id,
        COALESCE(p_transaction_date, CURRENT_DATE),
        'INITIAL_BALANCE',
        COALESCE(
            NULLIF(trim(p_description), ''),
            'Initial company bank balance'
        ),
        p_amount,
        'IN',
        p_amount,
        auth.uid()
    )
    RETURNING id INTO v_transaction_id;

    RETURN json_build_object(
        'success', true,
        'account_id', v_account_id,
        'transaction_id', v_transaction_id,
        'balance', p_amount
    );

END;
$$;


--
-- Name: create_loan_agreement(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_loan_agreement(p_loan_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_agreement_id UUID;
    v_customer_id UUID;
    v_agreement_number TEXT;
    v_signing_token UUID;
    v_verification_token TEXT;
BEGIN
    /*
     * 1. Confirm that the loan exists and is not deleted.
     */
    SELECT customer_id
    INTO v_customer_id
    FROM public.loans
    WHERE id = p_loan_id
      AND is_deleted = false;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loan not found.';
    END IF;

    /*
     * 2. A loan may have only one agreement.
     *
     * If an agreement already exists, return that agreement ID
     * instead of creating another agreement.
     */
    SELECT id
    INTO v_agreement_id
    FROM public.loan_agreements
    WHERE loan_id = p_loan_id
    LIMIT 1;

    IF v_agreement_id IS NOT NULL THEN
        RETURN v_agreement_id;
    END IF;

    /*
     * 3. Make sure the loan has a customer.
     */
    IF v_customer_id IS NULL THEN
        RAISE EXCEPTION 'Loan does not have a customer.';
    END IF;

    /*
     * 4. Generate the agreement details.
     */
    SELECT public.generate_agreement_number()
    INTO v_agreement_number;

    v_signing_token := gen_random_uuid();

    v_verification_token :=
        REPLACE(
            gen_random_uuid()::TEXT ||
            gen_random_uuid()::TEXT,
            '-',
            ''
        );

    /*
     * 5. Create the agreement.
     *
     * ON CONFLICT protects against two requests trying to create
     * an agreement for the same loan at exactly the same time.
     */
    INSERT INTO public.loan_agreements (
        loan_id,
        customer_id,
        agreement_number,
        agreement_version,
        status,
        signing_token,
        verification_token,
        generated_at,
        created_at,
        updated_at
    )
    VALUES (
        p_loan_id,
        v_customer_id,
        v_agreement_number,
        '1.0',
        'Pending',
        v_signing_token,
        v_verification_token,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    )
    ON CONFLICT (loan_id) DO NOTHING
    RETURNING id
    INTO v_agreement_id;

    /*
     * 6. If another request created the agreement first,
     * retrieve that existing agreement.
     */
    IF v_agreement_id IS NULL THEN
        SELECT id
        INTO v_agreement_id
        FROM public.loan_agreements
        WHERE loan_id = p_loan_id
        LIMIT 1;
    END IF;

    RETURN v_agreement_id;
END;
$$;


--
-- Name: create_loan_application_upload_token(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_loan_application_upload_token(p_application_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
    v_token text;
    v_token_hash text;
BEGIN
    IF p_application_id IS NULL THEN
        RAISE EXCEPTION 'Application ID is required.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.loan_applications
        WHERE id = p_application_id
          AND status = 'PENDING'
    ) THEN
        RAISE EXCEPTION 'Pending loan application not found.';
    END IF;

    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_token_hash := encode(
        extensions.digest(v_token::bytea, 'sha256'),
        'hex'
    );

    INSERT INTO public.loan_application_upload_tokens (
        application_id,
        token_hash,
        expires_at
    )
    VALUES (
        p_application_id,
        v_token_hash,
        now() + interval '24 hours'
    );

    RETURN v_token;
END;
$$;


--
-- Name: create_mobile_pairing(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_mobile_pairing() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
    v_system_settings_id uuid;
    v_token text;
    v_numeric_code text;
    v_token_hash text;
    v_numeric_hash text;
    v_pairing_id uuid;
    v_expires_at timestamptz;
BEGIN

    -- --------------------------------------------------------
    -- Administrator check
    -- --------------------------------------------------------

    IF NOT public.current_user_is_admin() THEN
        RAISE EXCEPTION 'Administrator access required';
    END IF;


    -- --------------------------------------------------------
    -- Get the LMS installation
    -- --------------------------------------------------------

    SELECT id
    INTO v_system_settings_id
    FROM public.system_settings
    ORDER BY updated_at DESC
    LIMIT 1;


    IF v_system_settings_id IS NULL THEN
        RAISE EXCEPTION 'System settings have not been configured';
    END IF;


    -- --------------------------------------------------------
    -- Generate secure credentials
    -- --------------------------------------------------------
    --
    -- QR token:
    -- 32 random bytes encoded as hexadecimal.
    --
    -- Numeric code:
    -- 8-digit temporary code.
    --
    -- The raw values are NEVER stored in the database.
    -- --------------------------------------------------------

    v_token := encode(gen_random_bytes(32), 'hex');

    v_numeric_code :=
        lpad(
            floor(random() * 100000000)::bigint::text,
            8,
            '0'
        );


    -- --------------------------------------------------------
    -- Hash credentials before storage
    -- --------------------------------------------------------

    v_token_hash :=
        encode(
            digest(v_token, 'sha256'),
            'hex'
        );

    v_numeric_hash :=
        encode(
            digest(v_numeric_code, 'sha256'),
            'hex'
        );


    -- --------------------------------------------------------
    -- Pairing credentials expire after 10 minutes
    -- --------------------------------------------------------

    v_expires_at :=
        now() + interval '10 minutes';


    -- --------------------------------------------------------
    -- Revoke any previous unused pairing credentials
    -- --------------------------------------------------------

    UPDATE public.mobile_pairing_codes
    SET revoked_at = now()
    WHERE system_settings_id = v_system_settings_id
      AND used_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > now();


    -- --------------------------------------------------------
    -- Create new pairing record
    -- --------------------------------------------------------

    INSERT INTO public.mobile_pairing_codes (
        system_settings_id,
        token_hash,
        numeric_code_hash,
        expires_at,
        max_attempts,
        attempt_count,
        created_by
    )
    VALUES (
        v_system_settings_id,
        v_token_hash,
        v_numeric_hash,
        v_expires_at,
        5,
        0,
        auth.uid()
    )
    RETURNING id
    INTO v_pairing_id;


    -- --------------------------------------------------------
    -- Return raw credentials ONCE
    -- --------------------------------------------------------

    RETURN jsonb_build_object(
        'pairing_id', v_pairing_id,
        'installation_id', v_system_settings_id,
        'pairing_token', v_token,
        'numeric_code', v_numeric_code,
        'expires_at', v_expires_at
    );

END;
$$;


--
-- Name: create_public_application_document(uuid, text, text, text, text, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_public_application_document(p_application_id uuid, p_document_name text, p_document_path text, p_document_type text, p_mime_type text, p_file_size_bytes bigint, p_file_hash_sha256 text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_document_id uuid;
    v_application_number text;
BEGIN
    IF p_application_id IS NULL THEN
        RAISE EXCEPTION 'Application ID is required.';
    END IF;

    IF NULLIF(TRIM(p_document_name), '') IS NULL THEN
        RAISE EXCEPTION 'Document name is required.';
    END IF;

    IF NULLIF(TRIM(p_document_path), '') IS NULL THEN
        RAISE EXCEPTION 'Document path is required.';
    END IF;

    IF p_file_size_bytes IS NULL
       OR p_file_size_bytes <= 0 THEN
        RAISE EXCEPTION 'Invalid document file size.';
    END IF;

    SELECT application_number
    INTO v_application_number
    FROM public.loan_applications
    WHERE id = p_application_id
      AND status = 'PENDING';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pending loan application not found.';
    END IF;

    IF p_document_type NOT IN (
        'ID Document',
        'Bank Statement',
        'Payslip',
        'Proof of Residence',
        'Other'
    ) THEN
        RAISE EXCEPTION 'Unsupported public application document type.';
    END IF;

    INSERT INTO public.documents (
        application_id,
        document_type,
        document_category,
        document_name,
        document_path,
        created_by,
        created_at,
        company_name_snapshot,
        loan_number_snapshot,
        mime_type,
        file_size_bytes,
        file_hash_sha256,
        source_type,
        retention_policy,
        retention_status,
        verification_status,
        is_archived,
        version_number
    )
    VALUES (
        p_application_id,
        p_document_type,
        'LOAN',
        TRIM(p_document_name),
        TRIM(p_document_path),
        NULL,
        now(),
        NULL,
        v_application_number,
        p_mime_type,
        p_file_size_bytes,
        p_file_hash_sha256,
        'CUSTOMER_UPLOAD',
        'OTHER',
        'ACTIVE',
        'PENDING',
        false,
        1
    )
    RETURNING id INTO v_document_id;

    RETURN v_document_id;
END;
$$;


--
-- Name: create_signed_agreement_document(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_signed_agreement_document(p_agreement_id uuid, p_document_path text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_document_id UUID;
    v_loan_id UUID;
    v_customer_id UUID;
    v_agreement_number TEXT;
    v_status TEXT;
BEGIN

    SELECT
        loan_id,
        customer_id,
        agreement_number,
        status
    INTO
        v_loan_id,
        v_customer_id,
        v_agreement_number,
        v_status
    FROM public.loan_agreements
    WHERE id = p_agreement_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agreement not found.';
    END IF;

    IF v_status <> 'Signed' THEN
        RAISE EXCEPTION
            'Only signed agreements can create a signed document.';
    END IF;

    IF NULLIF(TRIM(p_document_path), '') IS NULL THEN
        RAISE EXCEPTION 'Document path is required.';
    END IF;

    /*
     * If the document already exists, update its path and return it.
     */
    SELECT id
    INTO v_document_id
    FROM public.documents
    WHERE agreement_id = p_agreement_id
      AND document_type = 'Signed Loan Agreement'
    LIMIT 1;

    IF v_document_id IS NOT NULL THEN

        UPDATE public.documents
        SET
            document_path = p_document_path
        WHERE id = v_document_id;

        UPDATE public.loan_agreements
        SET
            document_path = p_document_path,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = p_agreement_id;

        RETURN v_document_id;
    END IF;

    /*
     * Create the official signed document record.
     */
    INSERT INTO public.documents (
        customer_id,
        loan_id,
        agreement_id,
        document_type,
        document_name,
        document_path,
        created_by
    )
    VALUES (
        v_customer_id,
        v_loan_id,
        p_agreement_id,
        'Signed Loan Agreement',
        'Signed Loan Agreement - ' || v_agreement_number,
        p_document_path,
        NULL
    )
    RETURNING id INTO v_document_id;

    /*
     * Link the official document to the agreement.
     */
    UPDATE public.loan_agreements
    SET
        document_path = p_document_path,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_agreement_id;

    RETURN v_document_id;

END;
$$;


--
-- Name: current_user_is_active_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_is_active_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and lower(coalesce(u.role, '')) = 'admin'
      and coalesce(u.is_active, false) = true
      and coalesce(u.is_deleted, false) = false
  );
$$;


--
-- Name: current_user_is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_is_admin() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_role text;
    v_is_active boolean;
    v_is_deleted boolean;
BEGIN

    SELECT
        role,
        is_active,
        is_deleted
    INTO
        v_role,
        v_is_active,
        v_is_deleted
    FROM public.users
    WHERE id = auth.uid()
    LIMIT 1;

    RETURN
        lower(trim(COALESCE(v_role, ''))) = 'admin'
        AND COALESCE(v_is_active, true) = true
        AND COALESCE(v_is_deleted, false) = false;

END;
$$;


--
-- Name: detect_due_loan_overdues(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_due_loan_overdues(p_as_of date DEFAULT CURRENT_DATE) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    loan_record RECORD;

    last_interest_transaction RECORD;

    cycle_opening_balance NUMERIC;
    cycle_interest_due NUMERIC;
    payments_by_due_date NUMERIC;
    overdue_amount NUMERIC;

BEGIN

    FOR loan_record IN
        SELECT l.*
        FROM public.loans l
        WHERE l.loan_status = 'Active'
          AND l.is_deleted = false
          AND l.current_balance > 0
          AND l.next_payment_date IS NOT NULL
          AND l.next_payment_date < p_as_of
        FOR UPDATE OF l
    LOOP

        /*
         * Find the most recent interest transaction.
         * That transaction marks the end of the previous
         * cycle and its balance becomes the opening balance
         * of the new cycle.
         */
        SELECT
            t.transaction_date,
            t.balance
        INTO last_interest_transaction
        FROM public.loan_transactions t
        WHERE t.loan_id = loan_record.id
          AND t.transaction_type = 'INTEREST'
        ORDER BY t.transaction_date DESC, t.created_at DESC
        LIMIT 1;


        /*
         * FIRST CYCLE
         *
         * No interest has been applied yet.
         * Therefore use the original loan interest amount.
         *
         * Example:
         * Principal = R1,000
         * Interest = R400
         */
        IF NOT FOUND THEN

            cycle_interest_due := ROUND(
                COALESCE(loan_record.interest_amount, 0),
                2
            );

            cycle_opening_balance := ROUND(
                COALESCE(loan_record.total_repayment, 0),
                2
            );

        ELSE

            /*
             * SUBSEQUENT CYCLES
             *
             * The balance after the previous interest event
             * is the opening balance for this cycle.
             */
            cycle_opening_balance := ROUND(
                COALESCE(
                    last_interest_transaction.balance,
                    loan_record.current_balance
                ),
                2
            );

            cycle_interest_due := ROUND(
                cycle_opening_balance *
                (COALESCE(loan_record.interest_rate, 0) / 100),
                2
            );

        END IF;


        /*
         * Add all payments belonging to this cycle that were
         * made on or before the scheduled payment date.
         */
        SELECT
            COALESCE(SUM(t.credit), 0)
        INTO payments_by_due_date
        FROM public.loan_transactions t
        WHERE t.loan_id = loan_record.id
          AND t.transaction_type = 'PAYMENT'

          /*
           * For subsequent cycles, only payments after the
           * previous interest event belong to this cycle.
           */
          AND (
              last_interest_transaction.transaction_date IS NULL
              OR t.transaction_date >
                 last_interest_transaction.transaction_date
          )

          AND t.transaction_date::DATE <=
              loan_record.next_payment_date;


        /*
         * The overdue amount is the unpaid portion of the
         * minimum interest required for this cycle.
         */
        overdue_amount := ROUND(
            cycle_interest_due -
            payments_by_due_date,
            2
        );


        /*
         * Only create an overdue record when the customer
         * paid less than the required cycle interest.
         */
        IF overdue_amount > 0 THEN

            INSERT INTO public.loan_overdues (
                loan_id,
                cycle_payment_date,
                overdue_start_date,
                overdue_amount,
                status
            )
            SELECT
                loan_record.id,
                loan_record.next_payment_date,
                loan_record.next_payment_date + 1,
                overdue_amount,
                'Open'
            WHERE NOT EXISTS (
                SELECT 1
                FROM public.loan_overdues o
                WHERE o.loan_id = loan_record.id
                  AND o.cycle_payment_date =
                      loan_record.next_payment_date
            );

        END IF;

    END LOOP;

END;
$$;


--
-- Name: find_active_document_duplicate(text, uuid, uuid, uuid, uuid, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_active_document_duplicate(p_document_type text, p_customer_id uuid DEFAULT NULL::uuid, p_loan_id uuid DEFAULT NULL::uuid, p_agreement_id uuid DEFAULT NULL::uuid, p_application_id uuid DEFAULT NULL::uuid, p_borrowing_id uuid DEFAULT NULL::uuid, p_debt_repayment_id uuid DEFAULT NULL::uuid, p_company_name_snapshot text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE sql STABLE
    AS $$

    SELECT d.id

    FROM public.documents d

    WHERE COALESCE(d.is_archived, false) = false

      AND d.deleted_at IS NULL

      AND lower(trim(d.document_type))
          = lower(trim(p_document_type))

      AND (
            (
                p_customer_id IS NOT NULL
                AND d.customer_id = p_customer_id
            )

            OR

            (
                p_loan_id IS NOT NULL
                AND d.loan_id = p_loan_id
            )

            OR

            (
                p_agreement_id IS NOT NULL
                AND d.agreement_id = p_agreement_id
            )

            OR

            (
                p_application_id IS NOT NULL
                AND d.application_id = p_application_id
            )

            OR

            (
                p_borrowing_id IS NOT NULL
                AND d.borrowing_id = p_borrowing_id
            )

            OR

            (
                p_debt_repayment_id IS NOT NULL
                AND d.debt_repayment_id = p_debt_repayment_id
            )

            OR

            (
                p_company_name_snapshot IS NOT NULL
                AND d.company_name_snapshot =
                    p_company_name_snapshot
            )
      )

    ORDER BY d.created_at DESC

    LIMIT 1;

$$;


--
-- Name: generate_agreement_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_agreement_number() RETURNS text
    LANGUAGE plpgsql
    AS $_$
DECLARE
    next_number INTEGER;
BEGIN
    SELECT COALESCE(
        MAX(
            CAST(
                SUBSTRING(agreement_number FROM 4)
                AS INTEGER
            )
        ),
        0
    ) + 1
    INTO next_number
    FROM public.loan_agreements
    WHERE agreement_number ~ '^AGR[0-9]+$';

    RETURN 'AGR' || LPAD(next_number::TEXT, 6, '0');
END;
$_$;


--
-- Name: generate_application_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_application_number() RETURNS text
    LANGUAGE plpgsql
    AS $_$
declare
    next_number integer;
begin

    select coalesce(
        max(
            case
                when application_number ~ '^APP-[0-9]+$'
                then substring(application_number from 5)::integer
                else 0
            end
        ),
        0
    ) + 1
    into next_number
    from public.loan_applications;

    return 'APP-' || lpad(next_number::text, 6, '0');

end;
$_$;


--
-- Name: generate_customer_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_customer_number() RETURNS text
    LANGUAGE plpgsql
    AS $_$
declare
    next_number integer;
begin

    select coalesce(
        max(
            case
                when customer_number ~ '^CUS[0-9]+$'
                then substring(customer_number from 4)::integer
                else 0
            end
        ),
        0
    ) + 1
    into next_number
    from public.customers;

    return 'CUS' || lpad(next_number::text, 6, '0');

end;
$_$;


--
-- Name: generate_loan_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_loan_number() RETURNS text
    LANGUAGE plpgsql
    AS $_$
declare
    next_number integer;
begin

    select coalesce(
        max(
            case
                when loan_number ~ '^LN-[0-9]+$'
                then substring(loan_number from 4)::integer
                else 0
            end
        ),
        0
    ) + 1
    into next_number
    from public.loans;

    return 'LN-' || lpad(next_number::text, 6, '0');

end;
$_$;


--
-- Name: get_agreement_for_signing(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_agreement_for_signing(p_signing_token uuid) RETURNS TABLE(agreement_id uuid, agreement_number text, agreement_version text, status text, generated_at timestamp without time zone, verification_token text, customer_name text, loan_number text, principal_amount numeric, interest_rate numeric, interest_amount numeric, total_repayment numeric, current_balance numeric, first_payment_date date, next_payment_date date)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
        l.next_payment_date
    FROM public.loan_agreements a
    JOIN public.loans l
        ON l.id = a.loan_id
    JOIN public.customers c
        ON c.id = a.customer_id
    WHERE a.signing_token = p_signing_token
      AND a.status IN ('Pending', 'Sent');
END;
$$;


--
-- Name: get_document_history_snapshot(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_document_history_snapshot(p_document_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
    SELECT to_jsonb(d)
    FROM public.documents d
    WHERE d.id = p_document_id;
$$;


--
-- Name: get_document_storage_statistics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_document_storage_statistics() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_capacity bigint;
    v_used bigint;
    v_available bigint;
    v_usage numeric;
    v_warning numeric;
    v_critical numeric;
    v_enabled boolean;
    v_status text;
    v_category_breakdown jsonb;
    v_mime_breakdown jsonb;
BEGIN
    IF NOT public.current_user_is_admin() THEN
        RAISE EXCEPTION 'Administrator access required';
    END IF;

    SELECT
        storage_capacity_bytes,
        warning_threshold_percent,
        critical_threshold_percent,
        is_enabled
    INTO
        v_capacity,
        v_warning,
        v_critical,
        v_enabled
    FROM public.document_storage_settings
    ORDER BY id
    LIMIT 1;

    SELECT COALESCE(SUM(file_size_bytes), 0)
    INTO v_used
    FROM public.documents
    WHERE COALESCE(is_archived, false) = false
      AND deleted_at IS NULL;

    v_available :=
        GREATEST(
            COALESCE(v_capacity, 0) - v_used,
            0
        );

    IF COALESCE(v_capacity, 0) > 0 THEN
        v_usage :=
            ROUND(
                (v_used::numeric / v_capacity::numeric) * 100,
                2
            );
    ELSE
        v_usage := 0;
    END IF;

    IF NOT COALESCE(v_enabled, true) THEN
        v_status := 'DISABLED';
    ELSIF v_usage >= COALESCE(v_critical, 95) THEN
        v_status := 'CRITICAL';
    ELSIF v_usage >= COALESCE(v_warning, 80) THEN
        v_status := 'WARNING';
    ELSE
        v_status := 'NORMAL';
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'category', category,
                'file_count', file_count,
                'bytes', bytes
            )
            ORDER BY bytes DESC
        ),
        '[]'::jsonb
    )
    INTO v_category_breakdown
    FROM (
        SELECT
            COALESCE(document_category, 'Uncategorized') AS category,
            COUNT(*) AS file_count,
            COALESCE(SUM(file_size_bytes), 0) AS bytes
        FROM public.documents
        WHERE COALESCE(is_archived, false) = false
          AND deleted_at IS NULL
        GROUP BY COALESCE(document_category, 'Uncategorized')
    ) categories;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'mime_type', mime_type,
                'file_count', file_count,
                'bytes', bytes
            )
            ORDER BY bytes DESC
        ),
        '[]'::jsonb
    )
    INTO v_mime_breakdown
    FROM (
        SELECT
            COALESCE(mime_type, 'Unknown') AS mime_type,
            COUNT(*) AS file_count,
            COALESCE(SUM(file_size_bytes), 0) AS bytes
        FROM public.documents
        WHERE COALESCE(is_archived, false) = false
          AND deleted_at IS NULL
        GROUP BY COALESCE(mime_type, 'Unknown')
    ) mime_types;

    RETURN jsonb_build_object(
        'storage_enabled', COALESCE(v_enabled, true),
        'capacity_bytes', COALESCE(v_capacity, 0),
        'used_bytes', v_used,
        'available_bytes', v_available,
        'usage_percent', v_usage,
        'warning_threshold_percent', COALESCE(v_warning, 80),
        'critical_threshold_percent', COALESCE(v_critical, 95),
        'status', v_status,
        'category_breakdown', v_category_breakdown,
        'mime_breakdown', v_mime_breakdown,
        'calculated_at', now()
    );
END;
$$;


--
-- Name: get_document_storage_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_document_storage_status() RETURNS TABLE(usage_bytes bigint, capacity_bytes bigint, usage_percent numeric, warning_threshold_percent numeric, urgent_threshold_percent numeric, critical_threshold_percent numeric, status text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_usage bigint;
  v_capacity bigint;
  v_warning numeric;
  v_urgent numeric;
  v_critical numeric;
  v_percent numeric;
  v_status text;
BEGIN

  IF NOT public.current_user_is_active_admin() THEN
    RAISE EXCEPTION
      'Only an active Administrator can view document storage status.';
  END IF;

  SELECT
    s.storage_capacity_bytes,
    s.warning_threshold_percent,
    s.urgent_threshold_percent,
    s.critical_threshold_percent
  INTO
    v_capacity,
    v_warning,
    v_urgent,
    v_critical
  FROM public.document_storage_settings s
  LIMIT 1;

  IF v_capacity IS NULL THEN
    RAISE EXCEPTION
      'Document storage settings have not been configured.';
  END IF;

  SELECT COALESCE(
    SUM(
      CASE
        WHEN file_size_bytes IS NULL OR file_size_bytes < 0
          THEN 0::bigint
        ELSE file_size_bytes
      END
    ),
    0::bigint
  )
  INTO v_usage
  FROM public.documents;

  v_percent :=
    ROUND(
      ((v_usage::numeric / v_capacity::numeric) * 100),
      2
    );

  IF v_percent >= v_critical THEN
    v_status := 'CRITICAL';
  ELSIF v_percent >= v_urgent THEN
    v_status := 'URGENT';
  ELSIF v_percent >= v_warning THEN
    v_status := 'WARNING';
  ELSE
    v_status := 'NORMAL';
  END IF;

  RETURN QUERY
  SELECT
    v_usage,
    v_capacity,
    v_percent,
    v_warning,
    v_urgent,
    v_critical,
    v_status;
END;
$$;


--
-- Name: get_mobile_device_status(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_mobile_device_status(p_device_id text) RETURNS TABLE(is_linked boolean, is_revoked boolean, installation_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query
  select
    (md.id is not null and md.revoked_at is null) as is_linked,
    (md.id is not null and md.revoked_at is not null) as is_revoked,
    md.system_settings_id as installation_id
  from (
    select 1
  ) x
  left join public.mobile_devices md
    on md.device_id = p_device_id
  limit 1;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: mobile_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mobile_devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system_settings_id uuid NOT NULL,
    device_id text NOT NULL,
    device_name text,
    platform text,
    app_version text,
    push_token text,
    push_enabled boolean DEFAULT false NOT NULL,
    paired_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: get_mobile_devices(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_mobile_devices() RETURNS SETOF public.mobile_devices
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN

    IF NOT public.current_user_is_admin() THEN
        RAISE EXCEPTION 'Administrator access required';
    END IF;


    RETURN QUERY
    SELECT d.*
    FROM public.mobile_devices d
    ORDER BY d.paired_at DESC;

END;
$$;


--
-- Name: get_mobile_installation_settings(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_mobile_installation_settings(p_installation_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_settings public.system_settings%rowtype;
  v_system_name text;
  v_mobile_app_name text;
begin
  if p_installation_id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'INVALID_INSTALLATION',
      'message', 'Installation ID is required.'
    );
  end if;

  select *
  into v_settings
  from public.system_settings
  where id = p_installation_id
  limit 1;

  if v_settings.id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'INSTALLATION_NOT_FOUND',
      'message', 'The LMS installation could not be found.'
    );
  end if;

  v_system_name :=
    coalesce(
      nullif(trim(v_settings.company_name), ''),
      'LMS'
    ) || ' LMS';

  v_mobile_app_name :=
    coalesce(
      nullif(trim(v_settings.short_name), ''),
      nullif(trim(v_settings.company_name), ''),
      'LMS'
    ) || ' LMS';

  return jsonb_build_object(
    'success', true,
    'installation_id', v_settings.id,
    'company_name', v_settings.company_name,
    'short_name', v_settings.short_name,
    'company_logo_url', v_settings.company_logo_url,
    'company_address', v_settings.company_address,
    'system_name', v_system_name,
    'mobile_app_name', v_mobile_app_name
  );
end;
$$;


--
-- Name: get_valid_customer_document(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_valid_customer_document(p_customer_id uuid, p_document_type text) RETURNS TABLE(document_id uuid, document_type text, document_name text, document_path text, created_at timestamp with time zone, retention_until date, retention_status text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_customer_id_number text;
BEGIN

    /*
     * Only authenticated users may perform customer
     * document reuse checks.
     */
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.';
    END IF;

    IF p_customer_id IS NULL THEN
        RAISE EXCEPTION 'Customer ID is required.';
    END IF;

    IF p_document_type NOT IN (
        'Bank Statement',
        'Payslip',
        'Proof of Residence'
    ) THEN
        RAISE EXCEPTION 'Document type is not eligible for 6-month reuse.';
    END IF;

    SELECT c.id_number
    INTO v_customer_id_number
    FROM public.customers c
    WHERE c.id = p_customer_id
      AND c.is_active = true
      AND c.is_deleted = false;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active customer not found.';
    END IF;

    RETURN QUERY
    SELECT
        d.id,
        d.document_type,
        d.document_name,
        d.document_path,
        d.created_at,
        d.retention_until,
        d.retention_status
    FROM public.documents d
    WHERE d.document_type = p_document_type
      AND (
          d.customer_id = p_customer_id
          OR (
              d.customer_id IS NULL
              AND d.customer_id_number_snapshot IS NOT NULL
              AND d.customer_id_number_snapshot = v_customer_id_number
          )
      )
      AND d.retention_until IS NOT NULL
      AND d.retention_until >= CURRENT_DATE
      AND COALESCE(d.retention_status, 'ACTIVE') = 'ACTIVE'
      AND COALESCE(d.is_archived, false) = false
    ORDER BY d.created_at DESC
    LIMIT 1;

END;
$$;


--
-- Name: is_active_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_active_admin(p_user_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users
        WHERE id = p_user_id
          AND role = 'admin'
          AND is_active = TRUE
          AND is_deleted = FALSE
    );
$$;


--
-- Name: is_current_user_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_current_user_admin() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET row_security TO 'off'
    AS $$
DECLARE
    v_is_admin boolean;
BEGIN
    SELECT
        lower(coalesce(role, '')) = 'admin'
        AND coalesce(is_active, true) = true
        AND coalesce(is_deleted, false) = false
    INTO v_is_admin
    FROM public.users
    WHERE id = auth.uid();

    RETURN coalesce(v_is_admin, false);
END;
$$;


--
-- Name: lookup_public_customer_by_id_number(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lookup_public_customer_by_id_number(p_id_number text) RETURNS TABLE(customer_id uuid, customer_number text, first_name text, last_name text, id_number text, cellphone text, email text, physical_address text, employer text, employment_status text, monthly_income numeric, other_income numeric, bank_name text, account_number text, loan_purpose text, collection_preference text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_id_number text;
BEGIN
    /*
     * Normalize the supplied South African ID number.
     */
    v_id_number := regexp_replace(
        COALESCE(p_id_number, ''),
        '[^0-9]',
        '',
        'g'
    );

    IF length(v_id_number) <> 13 THEN
        RAISE EXCEPTION 'A valid 13-digit ID number is required.';
    END IF;

    RETURN QUERY
    SELECT
        c.id AS customer_id,
        c.customer_number,
        c.first_name,
        c.last_name,
        c.id_number,
        c.cellphone,

        COALESCE(
            c.email,
            la.email
        ) AS email,

        COALESCE(
            c.physical_address,
            c.address,
            la.physical_address
        ) AS physical_address,

        COALESCE(
            c.employer,
            la.employer
        ) AS employer,

        la.employment_status,

        COALESCE(
            c.monthly_income,
            la.monthly_income
        ) AS monthly_income,

        la.other_income,

        la.bank_name,
        la.account_number,
        la.loan_purpose,
        la.collection_preference

    FROM public.customers c

    LEFT JOIN LATERAL (
        SELECT
            a.email,
            a.physical_address,
            a.employer,
            a.employment_status,
            a.monthly_income,
            a.other_income,
            a.bank_name,
            a.account_number,
            a.loan_purpose,
            a.collection_preference,
            a.created_at
        FROM public.loan_applications a
        WHERE a.customer_id = c.id
          AND COALESCE(a.id_number, '') = c.id_number
        ORDER BY a.created_at DESC
        LIMIT 1
    ) la ON TRUE

    WHERE regexp_replace(
              COALESCE(c.id_number, ''),
              '[^0-9]',
              '',
              'g'
          ) = v_id_number
      AND COALESCE(c.is_deleted, false) = false
      AND COALESCE(c.is_active, true) = true

    LIMIT 1;
END;
$$;


--
-- Name: mark_expired_documents_for_review(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_expired_documents_for_review() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    affected_rows integer;
BEGIN

    UPDATE public.documents
    SET retention_status = 'RETENTION_EXPIRED'
    WHERE retention_until IS NOT NULL
      AND retention_until < CURRENT_DATE
      AND COALESCE(is_archived, false) = false
      AND COALESCE(retention_status, 'ACTIVE') = 'ACTIVE';

    GET DIAGNOSTICS affected_rows = ROW_COUNT;

    RETURN affected_rows;

END;
$$;


--
-- Name: monitor_document_storage(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.monitor_document_storage() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

DECLARE
    v_settings public.document_storage_settings%ROWTYPE;

    v_used_bytes bigint := 0;
    v_capacity_bytes bigint := 0;

    v_usage_percent numeric(10,2) := 0;

    v_warning_threshold numeric(10,2);
    v_urgent_threshold numeric(10,2);
    v_critical_threshold numeric(10,2);

    v_status text := 'NORMAL';

    v_warning_exists boolean := false;
    v_critical_exists boolean := false;

    v_result jsonb;

BEGIN

    /* -----------------------------------------------------
       Load current settings
       ----------------------------------------------------- */

    SELECT *
    INTO v_settings
    FROM public.document_storage_settings
    ORDER BY created_at
    LIMIT 1;


    IF NOT FOUND THEN

        RETURN jsonb_build_object(
            'success', false,
            'status', 'CONFIGURATION_ERROR',
            'message', 'Document storage settings have not been configured.'
        );

    END IF;


    /* -----------------------------------------------------
       Monitoring disabled
       ----------------------------------------------------- */

    IF COALESCE(v_settings.monitoring_enabled, false) = false
       OR COALESCE(v_settings.is_enabled, false) = false THEN

        RETURN jsonb_build_object(
            'success', true,
            'status', 'DISABLED',
            'message', 'Document storage monitoring is disabled.',
            'usage_percent', 0
        );

    END IF;


    /* -----------------------------------------------------
       Storage capacity
       ----------------------------------------------------- */

    v_capacity_bytes :=
        COALESCE(v_settings.storage_capacity_bytes, 0);

    v_warning_threshold :=
        COALESCE(v_settings.warning_threshold_percent, 80.00);

    v_urgent_threshold :=
        COALESCE(v_settings.urgent_threshold_percent, 90.00);

    v_critical_threshold :=
        COALESCE(v_settings.critical_threshold_percent, 95.00);


    IF v_capacity_bytes <= 0 THEN

        RETURN jsonb_build_object(
            'success', false,
            'status', 'CONFIGURATION_ERROR',
            'message', 'Storage capacity must be greater than zero.'
        );

    END IF;


    /* -----------------------------------------------------
       Calculate active document storage.

       Archived and deleted documents are excluded.
       ----------------------------------------------------- */

    SELECT
        COALESCE(
            SUM(
                CASE
                    WHEN file_size_bytes IS NOT NULL
                         AND file_size_bytes > 0
                    THEN file_size_bytes
                    ELSE 0
                END
            ),
            0
        )
    INTO v_used_bytes
    FROM public.documents
    WHERE COALESCE(is_archived, false) = false
      AND deleted_at IS NULL;


    /* -----------------------------------------------------
       Usage percentage
       ----------------------------------------------------- */

    v_usage_percent :=
        ROUND(
            (
                v_used_bytes::numeric
                /
                v_capacity_bytes::numeric
            ) * 100,
            2
        );


    /* -----------------------------------------------------
       Determine storage status
       ----------------------------------------------------- */

    IF v_usage_percent >= v_critical_threshold THEN

        v_status := 'CRITICAL';

    ELSIF v_usage_percent >= v_urgent_threshold THEN

        v_status := 'URGENT';

    ELSIF v_usage_percent >= v_warning_threshold THEN

        v_status := 'WARNING';

    ELSE

        v_status := 'NORMAL';

    END IF;


    /* =====================================================
       6. CHECK EXISTING UNRESOLVED WARNING
       ===================================================== */

    SELECT EXISTS (
        SELECT 1
        FROM public.document_storage_notifications n
        WHERE n.notification_type = 'STORAGE_WARNING'
          AND COALESCE(
                n.metadata ->> 'resolved_at',
                ''
              ) = ''
    )
    INTO v_warning_exists;


    /* =====================================================
       7. CHECK EXISTING UNRESOLVED CRITICAL
       ===================================================== */

    SELECT EXISTS (
        SELECT 1
        FROM public.document_storage_notifications n
        WHERE n.notification_type = 'STORAGE_CRITICAL'
          AND COALESCE(
                n.metadata ->> 'resolved_at',
                ''
              ) = ''
    )
    INTO v_critical_exists;


    /* =====================================================
       8. NORMAL STORAGE
       ===================================================== */

    IF v_status = 'NORMAL' THEN

        UPDATE public.document_storage_notifications
        SET metadata =
            COALESCE(metadata, '{}'::jsonb)
            ||
            jsonb_build_object(
                'resolved_at',
                now(),
                'resolved_reason',
                'Storage usage returned below the warning threshold.'
            )
        WHERE notification_type IN (
            'STORAGE_WARNING',
            'STORAGE_CRITICAL'
        )
        AND COALESCE(
            metadata ->> 'resolved_at',
            ''
        ) = '';


    /* =====================================================
       9. WARNING STORAGE
       ===================================================== */

    ELSIF v_status IN ('WARNING', 'URGENT') THEN

        /* Resolve any active critical notification */

        UPDATE public.document_storage_notifications
        SET metadata =
            COALESCE(metadata, '{}'::jsonb)
            ||
            jsonb_build_object(
                'resolved_at',
                now(),
                'resolved_reason',
                'Storage usage is no longer at the critical threshold.'
            )
        WHERE notification_type = 'STORAGE_CRITICAL'
          AND COALESCE(
                metadata ->> 'resolved_at',
                ''
              ) = '';


        /* Create warning only once until resolved */

        IF NOT v_warning_exists THEN

            INSERT INTO public.document_storage_notifications (
                id,
                notification_type,
                severity,
                title,
                message,
                usage_percent,
                used_bytes,
                capacity_bytes,
                threshold_percent,
                metadata,
                created_at
            )
            VALUES (
                gen_random_uuid(),
                'STORAGE_WARNING',
                CASE
                    WHEN v_status = 'URGENT'
                    THEN 'URGENT'
                    ELSE 'WARNING'
                END,
                CASE
                    WHEN v_status = 'URGENT'
                    THEN 'Document Storage Urgent'
                    ELSE 'Document Storage Warning'
                END,
                CASE
                    WHEN v_status = 'URGENT'
                    THEN
                        'Document storage usage has reached '
                        || v_usage_percent
                        || '%. Please review storage and consider exporting or removing eligible documents.'
                    ELSE
                        'Document storage usage has reached '
                        || v_usage_percent
                        || '%, which is above the configured warning threshold.'
                END,
                v_usage_percent,
                v_used_bytes,
                v_capacity_bytes,
                CASE
                    WHEN v_status = 'URGENT'
                    THEN v_urgent_threshold
                    ELSE v_warning_threshold
                END,
                jsonb_build_object(
                    'status',
                    v_status,
                    'threshold_percent',
                    CASE
                        WHEN v_status = 'URGENT'
                        THEN v_urgent_threshold
                        ELSE v_warning_threshold
                    END,
                    'resolved_at',
                    null
                ),
                now()
            );

        END IF;


    /* =====================================================
       10. CRITICAL STORAGE
       ===================================================== */

    ELSIF v_status = 'CRITICAL' THEN

        /* Resolve warning notification */

        UPDATE public.document_storage_notifications
        SET metadata =
            COALESCE(metadata, '{}'::jsonb)
            ||
            jsonb_build_object(
                'resolved_at',
                now(),
                'resolved_reason',
                'Storage usage escalated to the critical notification.'
            )
        WHERE notification_type = 'STORAGE_WARNING'
          AND COALESCE(
                metadata ->> 'resolved_at',
                ''
              ) = '';


        /* Create critical notification only once */

        IF NOT v_critical_exists THEN

            INSERT INTO public.document_storage_notifications (
                id,
                notification_type,
                severity,
                title,
                message,
                usage_percent,
                used_bytes,
                capacity_bytes,
                threshold_percent,
                metadata,
                created_at
            )
            VALUES (
                gen_random_uuid(),
                'STORAGE_CRITICAL',
                'CRITICAL',
                'Document Storage Critical',
                'Document storage usage has reached '
                || v_usage_percent
                || '%. Immediate storage management action is required.',
                v_usage_percent,
                v_used_bytes,
                v_capacity_bytes,
                v_critical_threshold,
                jsonb_build_object(
                    'status',
                    'CRITICAL',
                    'threshold_percent',
                    v_critical_threshold,
                    'resolved_at',
                    null
                ),
                now()
            );

        END IF;

    END IF;


    /* =====================================================
       11. RETURN MONITORING RESULT
       ===================================================== */

    v_result :=
        jsonb_build_object(
            'success',
            true,

            'status',
            v_status,

            'used_bytes',
            v_used_bytes,

            'capacity_bytes',
            v_capacity_bytes,

            'available_bytes',
            GREATEST(
                v_capacity_bytes - v_used_bytes,
                0
            ),

            'usage_percent',
            v_usage_percent,

            'warning_threshold_percent',
            v_warning_threshold,

            'urgent_threshold_percent',
            v_urgent_threshold,

            'critical_threshold_percent',
            v_critical_threshold,

            'warning_notification_exists',
            v_warning_exists,

            'critical_notification_exists',
            v_critical_exists,

            'monitored_at',
            now()
        );


    RETURN v_result;

END;
$$;


--
-- Name: pair_mobile_device(uuid, text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pair_mobile_device(p_installation_id uuid, p_pairing_token text DEFAULT NULL::text, p_numeric_code text DEFAULT NULL::text, p_device_id text DEFAULT NULL::text, p_device_name text DEFAULT NULL::text, p_platform text DEFAULT NULL::text, p_app_version text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
    v_pairing public.mobile_pairing_codes%ROWTYPE;
    v_device public.mobile_devices%ROWTYPE;
    v_token_hash text;
    v_numeric_hash text;
    v_valid boolean := false;
BEGIN

    -- --------------------------------------------------------
    -- Basic validation
    -- --------------------------------------------------------

    IF p_installation_id IS NULL THEN
        RAISE EXCEPTION 'Installation ID is required';
    END IF;

    IF NULLIF(trim(COALESCE(p_device_id, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Device ID is required';
    END IF;


    -- --------------------------------------------------------
    -- Locate the latest active pairing credential.
    --
    -- FOR UPDATE locks this pairing row for the duration
    -- of this transaction. This prevents two devices from
    -- successfully consuming the same credential concurrently.
    -- --------------------------------------------------------

    SELECT *
    INTO v_pairing
    FROM public.mobile_pairing_codes
    WHERE system_settings_id = p_installation_id
      AND used_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > now()
      AND attempt_count < max_attempts
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;


    IF v_pairing.id IS NULL THEN
        RAISE EXCEPTION 'Pairing code is invalid or expired';
    END IF;


    -- --------------------------------------------------------
    -- Validate QR pairing token
    -- --------------------------------------------------------

    IF NULLIF(trim(COALESCE(p_pairing_token, '')), '') IS NOT NULL THEN

        v_token_hash :=
            encode(
                digest(trim(p_pairing_token), 'sha256'),
                'hex'
            );

        IF v_token_hash = v_pairing.token_hash THEN
            v_valid := true;
        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Validate numeric pairing code
    -- --------------------------------------------------------

    IF NOT v_valid
       AND NULLIF(trim(COALESCE(p_numeric_code, '')), '') IS NOT NULL THEN

        v_numeric_hash :=
            encode(
                digest(trim(p_numeric_code), 'sha256'),
                'hex'
            );

        IF v_numeric_hash = v_pairing.numeric_code_hash THEN
            v_valid := true;
        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Invalid credential
    -- --------------------------------------------------------

    IF NOT v_valid THEN

        UPDATE public.mobile_pairing_codes
        SET attempt_count = attempt_count + 1
        WHERE id = v_pairing.id;

        RAISE EXCEPTION 'Pairing code is invalid';

    END IF;


    -- --------------------------------------------------------
    -- IMPORTANT:
    --
    -- Consume the pairing credential BEFORE registering the
    -- device.
    --
    -- used_at = now()
    -- expires_at = now()
    --
    -- This makes the credential immediately unusable.
    -- Because the row is locked above, another concurrent
    -- request cannot consume the same credential.
    -- --------------------------------------------------------

    UPDATE public.mobile_pairing_codes
    SET
        used_at = now(),
        expires_at = now()
    WHERE id = v_pairing.id
      AND used_at IS NULL
      AND revoked_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pairing code has already been used or revoked';
    END IF;


    -- --------------------------------------------------------
    -- Register / update device
    -- --------------------------------------------------------

    INSERT INTO public.mobile_devices (
        system_settings_id,
        device_id,
        device_name,
        platform,
        app_version,
        paired_at,
        last_seen_at,
        revoked_at
    )
    VALUES (
        p_installation_id,
        trim(p_device_id),
        NULLIF(trim(p_device_name), ''),
        NULLIF(trim(p_platform), ''),
        NULLIF(trim(p_app_version), ''),
        now(),
        now(),
        NULL
    )
    ON CONFLICT (
        system_settings_id,
        device_id
    )
    DO UPDATE SET
        device_name = EXCLUDED.device_name,
        platform = EXCLUDED.platform,
        app_version = EXCLUDED.app_version,
        last_seen_at = now(),
        revoked_at = NULL,
        updated_at = now()
    RETURNING *
    INTO v_device;


    -- --------------------------------------------------------
    -- Return connection information
    -- --------------------------------------------------------

    RETURN jsonb_build_object(
        'success', true,
        'device_id', v_device.id,
        'installation_id', v_device.system_settings_id,
        'paired_at', v_device.paired_at
    );

END;
$$;


--
-- Name: pair_mobile_device_by_code(text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pair_mobile_device_by_code(p_numeric_code text, p_device_id text, p_device_name text, p_platform text, p_app_version text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $_$
declare
  v_pairing public.mobile_pairing_codes%rowtype;
  v_installation_id uuid;
begin

  if p_numeric_code is null
     or trim(p_numeric_code) !~ '^[0-9]{8}$' then

    return jsonb_build_object(
      'success', false,
      'error', 'INVALID_CODE',
      'message', 'The pairing code must contain exactly 8 digits.'
    );
  end if;

  if nullif(trim(coalesce(p_device_id, '')), '') is null then

    return jsonb_build_object(
      'success', false,
      'error', 'INVALID_DEVICE',
      'message', 'Device ID is required.'
    );
  end if;

  /*
   * Find the active pairing credential using the hashed
   * numeric code.
   *
   * This lookup does not consume the credential.
   * pair_mobile_device() performs the actual validation,
   * locking and consumption.
   */
  select *
  into v_pairing
  from public.mobile_pairing_codes
  where numeric_code_hash =
        encode(
          digest(trim(p_numeric_code), 'sha256'),
          'hex'
        )
    and used_at is null
    and revoked_at is null
    and expires_at > now()
  order by created_at desc
  limit 1;

  if v_pairing.id is null then

    return jsonb_build_object(
      'success', false,
      'error', 'INVALID_OR_EXPIRED_CODE',
      'message', 'The pairing code is invalid or has expired.'
    );

  end if;

  v_installation_id := v_pairing.system_settings_id;

  /*
   * Delegate the actual pairing to the existing secure function.
   *
   * That function:
   * - locks the pairing row
   * - validates the code
   * - increments attempts on invalid credentials
   * - immediately consumes successful credentials
   * - registers the device
   */
  return public.pair_mobile_device(
    v_installation_id,
    null,
    trim(p_numeric_code),
    trim(p_device_id),
    nullif(trim(p_device_name), ''),
    nullif(trim(p_platform), ''),
    nullif(trim(p_app_version), '')
  );

exception
  when others then
    return jsonb_build_object(
      'success', false,
      'error', 'PAIRING_FAILED',
      'message', sqlerrm
    );
end;
$_$;


--
-- Name: process_loan_statement_generation_queue(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_loan_statement_generation_queue(p_limit integer DEFAULT 20) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_queue record;

    v_sent integer := 0;

    v_failed integer := 0;

    v_request_id bigint;
BEGIN

    /*
     * Process a limited number at a time so a large number
     * of loans cannot create an uncontrolled number of
     * outbound requests.
     */

    FOR v_queue IN
        SELECT
            id
        FROM public.loan_statement_generation_queue
        WHERE status IN (
            'PENDING',
            'FAILED'
        )
        AND (
            status = 'PENDING'
            OR attempt_count < 5
        )
        ORDER BY requested_at ASC
        LIMIT GREATEST(
            LEAST(
                COALESCE(p_limit, 20),
                100
            ),
            1
        )
        FOR UPDATE SKIP LOCKED
    LOOP

        BEGIN

            v_request_id :=
                public.send_loan_statement_generation_request(
                    v_queue.id
                );

            IF v_request_id IS NOT NULL THEN

                v_sent :=
                    v_sent + 1;

            END IF;

        EXCEPTION
            WHEN OTHERS THEN

                v_failed :=
                    v_failed + 1;

                UPDATE public.loan_statement_generation_queue
                SET
                    status = 'FAILED',
                    failed_at = now(),
                    last_error = SQLERRM,
                    updated_at = now()
                WHERE id = v_queue.id;

        END;

    END LOOP;


    RETURN json_build_object(
        'sent',
        v_sent,

        'failed',
        v_failed,

        'processed_at',
        now()
    );

END;
$$;


--
-- Name: process_loan_statement_generation_responses(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_loan_statement_generation_responses(p_limit integer DEFAULT 50) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_queue record;

    v_processed integer := 0;
    v_completed integer := 0;
    v_failed integer := 0;
    v_pending integer := 0;

    v_http record;
    v_document_exists boolean;
    v_error text;
BEGIN

    FOR v_queue IN
        SELECT
            id,
            loan_id,
            last_request_id,
            attempt_count
        FROM public.loan_statement_generation_queue
        WHERE status = 'PROCESSING'
          AND last_request_id IS NOT NULL
        ORDER BY processing_started_at ASC
        LIMIT GREATEST(
            LEAST(
                COALESCE(p_limit, 50),
                200
            ),
            1
        )
        FOR UPDATE SKIP LOCKED
    LOOP

        v_processed := v_processed + 1;

        /*
         * Look for the asynchronous pg_net response.
         *
         * If no response exists yet, the HTTP request is still
         * being processed. Leave the queue item as PROCESSING.
         */
        SELECT
            id,
            status_code,
            content,
            timed_out,
            error_msg,
            created
        INTO v_http
        FROM net._http_response
        WHERE id = v_queue.last_request_id
        LIMIT 1;

        IF NOT FOUND THEN

            v_pending := v_pending + 1;

            CONTINUE;

        END IF;


        /*
         * Transport-level failure.
         */
        IF v_http.error_msg IS NOT NULL
           OR COALESCE(v_http.timed_out, false) = true
           OR COALESCE(v_http.status_code, 0) < 200
           OR COALESCE(v_http.status_code, 0) >= 300
        THEN

            v_error := COALESCE(
                v_http.error_msg,
                CASE
                    WHEN COALESCE(v_http.timed_out, false)
                        THEN 'Statement generator HTTP request timed out.'
                    ELSE
                        'Statement generator returned HTTP status '
                        || COALESCE(v_http.status_code::text, 'unknown')
                END
            );

            IF v_queue.attempt_count >= 5 THEN

                UPDATE public.loan_statement_generation_queue
                SET
                    status = 'FAILED',
                    failed_at = now(),
                    last_error = v_error,
                    updated_at = now()
                WHERE id = v_queue.id;

                v_failed := v_failed + 1;

            ELSE

                UPDATE public.loan_statement_generation_queue
                SET
                    status = 'FAILED',
                    failed_at = now(),
                    last_error = v_error,
                    updated_at = now()
                WHERE id = v_queue.id;

                v_failed := v_failed + 1;

            END IF;

            CONTINUE;

        END IF;


        /*
         * HTTP succeeded.
         *
         * A successful HTTP response is not enough.
         * Confirm that the statement document was actually
         * created for this loan.
         */
        SELECT EXISTS (
            SELECT 1
            FROM public.documents
            WHERE loan_id = v_queue.loan_id
              AND document_type = 'Loan Statement'
              AND document_path IS NOT NULL
        )
        INTO v_document_exists;


        IF v_document_exists THEN

            UPDATE public.loan_statement_generation_queue
            SET
                status = 'COMPLETED',
                completed_at = COALESCE(
                    completed_at,
                    now()
                ),
                failed_at = NULL,
                last_error = NULL,
                updated_at = now()
            WHERE id = v_queue.id;

            v_completed := v_completed + 1;

        ELSE

            UPDATE public.loan_statement_generation_queue
            SET
                status = 'FAILED',
                failed_at = now(),
                last_error =
                    'Statement generator returned success, but no Loan Statement document was found.',
                updated_at = now()
            WHERE id = v_queue.id;

            v_failed := v_failed + 1;

        END IF;

    END LOOP;


    RETURN json_build_object(
        'processed',
        v_processed,

        'completed',
        v_completed,

        'failed',
        v_failed,

        'pending',
        v_pending,

        'processed_at',
        now()
    );

END;
$$;


--
-- Name: queue_loan_statement_generation(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_loan_statement_generation(p_loan_id uuid, p_trigger_source text DEFAULT 'LOAN_TRANSACTION'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_queue_id uuid;
BEGIN

    IF p_loan_id IS NULL THEN
        RETURN NULL;
    END IF;


    /*
     * Do not queue deleted/non-existent loans.
     */

    IF NOT EXISTS (
        SELECT 1
        FROM public.loans
        WHERE id = p_loan_id
          AND COALESCE(is_deleted, false) = false
    ) THEN

        RETURN NULL;

    END IF;


    /*
     * If a pending/processing request already exists,
     * refresh its requested timestamp rather than creating
     * another queue record.
     */

    SELECT id
    INTO v_queue_id
    FROM public.loan_statement_generation_queue
    WHERE loan_id = p_loan_id
      AND status IN (
          'PENDING',
          'PROCESSING'
      )
    ORDER BY requested_at DESC
    LIMIT 1;


    IF v_queue_id IS NOT NULL THEN

        UPDATE public.loan_statement_generation_queue
        SET
            requested_at = now(),
            trigger_source = COALESCE(
                p_trigger_source,
                trigger_source
            ),
            updated_at = now()
        WHERE id = v_queue_id;

        RETURN v_queue_id;

    END IF;


    /*
     * If the previous request completed or failed,
     * create a fresh request.
     */

    INSERT INTO public.loan_statement_generation_queue (
        loan_id,
        status,
        trigger_source,
        requested_at,
        attempt_count
    )
    VALUES (
        p_loan_id,
        'PENDING',
        COALESCE(
            p_trigger_source,
            'LOAN_TRANSACTION'
        ),
        now(),
        0
    )
    RETURNING id
    INTO v_queue_id;


    RETURN v_queue_id;

END;
$$;


--
-- Name: queue_statement_after_interest_transaction(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_statement_after_interest_transaction() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_queue_id uuid;
BEGIN

    /*
     * Only INTEREST transactions trigger automatic
     * statement regeneration.
     *
     * Opening LOAN transactions and REPAYMENT transactions
     * are already handled by loanService.js.
     */

    IF UPPER(
        COALESCE(
            NEW.transaction_type,
            ''
        )
    ) <> 'INTEREST' THEN

        RETURN NEW;

    END IF;


    IF NEW.loan_id IS NULL THEN
        RETURN NEW;
    END IF;


    v_queue_id :=
        public.queue_loan_statement_generation(
            NEW.loan_id,
            'INTEREST_TRANSACTION'
        );


    RETURN NEW;

END;
$$;


--
-- Name: record_company_debt_repayment(uuid, numeric, date, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_company_debt_repayment(p_borrowing_id uuid, p_amount numeric, p_repayment_date date, p_description text DEFAULT NULL::text, p_proof_of_payment_path text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $function$
declare
  v_borrowing public.company_borrowings%rowtype;
  v_bank_account_id uuid;
  v_repayment_number integer;
  v_reference text;
  v_balance_after numeric(15,2);
  v_new_amount_repaid numeric(15,2);
  v_new_outstanding numeric(15,2);
  v_status text;
  v_repayment public.company_debt_repayments%rowtype;
begin
  if not public.current_user_is_active_admin() then
    raise exception 'Only active administrators can record company debt repayments.';
  end if;

  if p_borrowing_id is null then
    raise exception 'Company borrowing is required.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Repayment amount must be greater than zero.';
  end if;

  if coalesce(trim(p_proof_of_payment_path), '') = '' then
    raise exception 'Proof of payment is required.';
  end if;

  select *
    into v_borrowing
  from public.company_borrowings
  where id = p_borrowing_id
  for update;

  if not found then
    raise exception 'The recorded company borrowing could not be found.';
  end if;

  if v_borrowing.status = 'Voided' then
    raise exception 'A voided borrowing cannot be repaid.';
  end if;

  if coalesce(v_borrowing.outstanding_amount, 0) <= 0 then
    raise exception 'This borrowing has already been fully repaid.';
  end if;

  if p_amount > v_borrowing.outstanding_amount then
    raise exception 'Repayment cannot be greater than the outstanding debt.';
  end if;

  if coalesce(trim(v_borrowing.reference), '') = '' then
    raise exception 'The borrowing must have a reference before it can be repaid.';
  end if;

  v_reference := trim(v_borrowing.reference) || '-repayment';

  select count(*) + 1
    into v_repayment_number
  from public.company_debt_repayments
  where borrowing_id = p_borrowing_id;

  v_new_amount_repaid := coalesce(v_borrowing.amount_repaid, 0) + p_amount;
  v_new_outstanding := greatest(coalesce(v_borrowing.outstanding_amount, 0) - p_amount, 0);

  if v_new_outstanding = 0 then
    v_status := 'Paid';
  else
    v_status := 'Partially Paid';
  end if;

  insert into public.company_debt_repayments (
    borrowing_id,
    amount,
    repayment_date,
    description,
    reference,
    proof_of_payment_path,
    created_by
  )
  values (
    p_borrowing_id,
    p_amount,
    p_repayment_date,
    p_description,
    v_reference,
    p_proof_of_payment_path,
    auth.uid()
  )
  returning * into v_repayment;

  update public.company_borrowings
  set amount_repaid = v_new_amount_repaid,
      outstanding_amount = v_new_outstanding,
      status = v_status
  where id = p_borrowing_id;

  select id
    into v_bank_account_id
  from public.bank_accounts
  where is_active = true
  order by created_at asc
  limit 1;

  if v_bank_account_id is null then
    raise exception 'No active company bank account was found.';
  end if;

  select coalesce(sum(case when direction = 'IN' then amount else -amount end), 0)
    into v_balance_after
  from public.bank_transactions
  where is_void = false;

  v_balance_after := v_balance_after - p_amount;

  insert into public.bank_transactions (
    bank_account_id,
    transaction_date,
    transaction_type,
    direction,
    amount,
    description,
    reference,
    is_void,
    balance_after
  )
  values (
    v_bank_account_id,
    p_repayment_date,
    'DEBT_REPAYMENT',
    'OUT',
    p_amount,
    coalesce(p_description, 'Company debt repayment ' || v_repayment_number),
    v_reference,
    false,
    v_balance_after
  );

  return jsonb_build_object(
    'repayment', to_jsonb(v_repayment),
    'debt_repayment_id', v_repayment.id,
    'repayment_number', v_repayment_number,
    'reference', v_reference,
    'borrowing_id', p_borrowing_id,
    'amount_repaid', v_new_amount_repaid,
    'outstanding_amount', v_new_outstanding,
    'status', v_status
  );
end;
$function$;

--
-- Name: document_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid,
    action text NOT NULL,
    performed_by uuid,
    performed_at timestamp with time zone DEFAULT now() NOT NULL,
    previous_document_id uuid,
    new_document_id uuid,
    document_group_id uuid,
    version_number integer,
    document_snapshot jsonb,
    notes text,
    CONSTRAINT document_history_action_check CHECK ((action = ANY (ARRAY['CREATED'::text, 'UPDATED'::text, 'REPLACED'::text, 'ARCHIVED'::text, 'RESTORED'::text, 'DELETED'::text]))),
    CONSTRAINT document_history_version_positive CHECK (((version_number IS NULL) OR (version_number >= 1)))
);


--
-- Name: record_document_history(uuid, text, uuid, uuid, jsonb, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_document_history(p_document_id uuid, p_action text, p_previous_document_id uuid DEFAULT NULL::uuid, p_new_document_id uuid DEFAULT NULL::uuid, p_document_snapshot jsonb DEFAULT NULL::jsonb, p_previous_snapshot jsonb DEFAULT NULL::jsonb, p_notes text DEFAULT NULL::text) RETURNS public.document_history
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_history public.document_history;
BEGIN

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_action NOT IN (
        'CREATED',
        'UPDATED',
        'REPLACED',
        'ARCHIVED',
        'RESTORED',
        'DELETED'
    ) THEN
        RAISE EXCEPTION 'Invalid document history action: %', p_action;
    END IF;

    INSERT INTO public.document_history (
        document_id,
        action,
        performed_by,
        performed_at,
        previous_document_id,
        new_document_id,
        document_snapshot,
        previous_snapshot,
        notes
    )
    VALUES (
        p_document_id,
        p_action,
        auth.uid(),
        now(),
        p_previous_document_id,
        p_new_document_id,
        p_document_snapshot,
        p_previous_snapshot,
        p_notes
    )
    RETURNING *
    INTO v_history;

    RETURN v_history;

END;
$$;


--
-- Name: record_loan_payment(uuid, numeric, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_loan_payment(p_loan_id uuid, p_amount numeric, p_payment_date date, p_notes text DEFAULT ''::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_loan public.loans%rowtype;
    v_new_balance numeric;
    v_new_total_paid numeric;
    v_new_status text;
    v_next_interest_date date;
    v_next_payment_date date;
    v_transaction_id uuid;
BEGIN

    -- Caller must be authenticated.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication is required to record a loan payment.';
    END IF;

    -- 1. Validate input
    IF p_loan_id IS NULL THEN
        RAISE EXCEPTION 'Loan ID is required.';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero.';
    END IF;

    IF p_payment_date IS NULL THEN
        RAISE EXCEPTION 'Payment date is required.';
    END IF;


    -- 2. Lock the loan while processing the repayment
    SELECT *
    INTO v_loan
    FROM public.loans
    WHERE id = p_loan_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loan not found.';
    END IF;


    -- 3. Check loan status
    IF lower(coalesce(v_loan.loan_status, '')) IN
       ('completed', 'void', 'cancelled') THEN

        RAISE EXCEPTION
            'This loan is not available for repayment. Current status: %',
            v_loan.loan_status;

    END IF;


    -- 4. Prevent overpayment
    IF p_amount > coalesce(v_loan.current_balance, 0) THEN
        RAISE EXCEPTION
            'Payment amount (%) cannot be greater than the current balance (%).',
            p_amount,
            coalesce(v_loan.current_balance, 0);
    END IF;


    -- 5. Calculate new balance
    v_new_balance :=
        round(
            greatest(
                coalesce(v_loan.current_balance, 0) - p_amount,
                0
            ),
            2
        );


    -- 6. Calculate total paid
    v_new_total_paid :=
        round(
            coalesce(v_loan.total_paid, 0) + p_amount,
            2
        );


    -- 7. Determine loan status
    IF v_new_balance <= 0 THEN
        v_new_status := 'Completed';
    ELSE
        v_new_status := 'Active';
    END IF;


    -- 8. Calculate payment dates
    IF v_loan.first_payment_date IS NULL THEN

        v_next_interest_date :=
            (p_payment_date + interval '8 days')::date;

        v_next_payment_date :=
            (p_payment_date + interval '1 month')::date;

    ELSE

        v_next_interest_date :=
            v_loan.next_interest_date;

        v_next_payment_date :=
            v_loan.next_payment_date;

    END IF;


    -- 9. Update the loan
    UPDATE public.loans
    SET
        current_balance = v_new_balance,
        total_paid = v_new_total_paid,
        loan_status = v_new_status,

        first_payment_date =
            coalesce(
                first_payment_date,
                p_payment_date
            ),

        last_payment_date =
            p_payment_date,

        next_interest_date =
            CASE
                WHEN v_new_balance <= 0 THEN NULL
                ELSE v_next_interest_date
            END,

        next_payment_date =
            CASE
                WHEN v_new_balance <= 0 THEN NULL
                ELSE v_next_payment_date
            END

    WHERE id = p_loan_id;


    -- 10. Create repayment transaction
    INSERT INTO public.loan_transactions (
        loan_id,
        transaction_date,
        transaction_type,
        description,
        debit,
        credit,
        balance,
        created_by
    )
    VALUES (
        p_loan_id,
        p_payment_date::timestamp,
        'Payment',

        CASE
            WHEN trim(coalesce(p_notes, '')) = '' THEN
                'Loan repayment'
            ELSE
                p_notes
        END,

        0,
        p_amount,
        v_new_balance,
        auth.uid()
    )
    RETURNING id INTO v_transaction_id;


    -- 11. Return result
    RETURN json_build_object(
        'success', true,
        'loan_id', p_loan_id,
        'transaction_id', v_transaction_id,
        'payment_amount', p_amount,
        'payment_date', p_payment_date,
        'new_balance', v_new_balance,
        'total_paid', v_new_total_paid,
        'loan_status', v_new_status,
        'first_payment_date',
            CASE
                WHEN v_loan.first_payment_date IS NULL
                    THEN p_payment_date
                ELSE
                    v_loan.first_payment_date
            END,
        'next_interest_date', v_next_interest_date,
        'next_payment_date', v_next_payment_date
    );

END;
$$;


--
-- Name: recover_stuck_loan_statement_jobs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recover_stuck_loan_statement_jobs() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_count integer;
BEGIN

    UPDATE public.loan_statement_generation_queue
    SET
        status = 'PENDING',
        last_error =
            'Recovered automatically after a stuck processing attempt.',
        updated_at = now()
    WHERE status = 'PROCESSING'
      AND processing_started_at <
          now() - interval '10 minutes';


    GET DIAGNOSTICS
        v_count = ROW_COUNT;


    RETURN v_count;

END;
$$;


--
-- Name: reject_loan_application(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_loan_application(p_application_id uuid, p_rejected_by uuid, p_rejection_reason text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_application public.loan_applications%rowtype;
BEGIN

    -- Caller must be authenticated.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication is required to reject a loan application.';
    END IF;

    -- The recorded rejecting user must be the currently logged-in user.
    IF p_rejected_by IS NULL THEN
        RAISE EXCEPTION 'A rejecting user is required.';
    END IF;

    IF p_rejected_by <> auth.uid() THEN
        RAISE EXCEPTION 'The rejecting user must match the currently logged-in user.';
    END IF;

    -- Get application.
    SELECT *
    INTO v_application
    FROM public.loan_applications
    WHERE id = p_application_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loan application not found.';
    END IF;

    -- Only pending applications can be rejected.
    IF v_application.status <> 'PENDING' THEN
        RAISE EXCEPTION
            'Application cannot be rejected because its status is %.',
            v_application.status;
    END IF;

    -- Reason required.
    IF p_rejection_reason IS NULL
       OR trim(p_rejection_reason) = '' THEN
        RAISE EXCEPTION 'A rejection reason is required.';
    END IF;

    -- Update application.
    UPDATE public.loan_applications
    SET
        status = 'REJECTED',
        reviewed_by = p_rejected_by,
        reviewed_at = now(),
        notes = CASE
            WHEN notes IS NULL OR trim(notes) = ''
                THEN 'Rejection reason: ' || trim(p_rejection_reason)
            ELSE
                notes ||
                E'\n\nRejection reason: ' ||
                trim(p_rejection_reason)
        END,
        updated_at = now()
    WHERE id = p_application_id;

    RETURN json_build_object(
        'success', true,
        'application_id', p_application_id,
        'status', 'REJECTED',
        'rejection_reason', trim(p_rejection_reason)
    );

END;
$$;


--
-- Name: repay_company_debt(uuid, numeric, date, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.repay_company_debt(p_borrowing_id uuid, p_amount numeric, p_repayment_date date, p_description text, p_reference text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

DECLARE
    v_account_id uuid;
    v_borrowing public.company_borrowings%ROWTYPE;
    v_current_balance numeric;
    v_new_balance numeric;
    v_new_repaid numeric;
    v_new_outstanding numeric;
    v_new_status text;
    v_transaction_id uuid;
BEGIN

    IF NOT public.is_current_user_admin() THEN
        RAISE EXCEPTION 'Only administrators can repay company debt.';
    END IF;

    IF p_borrowing_id IS NULL THEN
        RAISE EXCEPTION 'Select a borrowing record.';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Repayment amount must be greater than zero.';
    END IF;

    SELECT *
    INTO v_borrowing
    FROM public.company_borrowings
    WHERE id = p_borrowing_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Borrowing record not found.';
    END IF;

    IF v_borrowing.status = 'Voided' THEN
        RAISE EXCEPTION 'This borrowing has been voided.';
    END IF;

    IF p_amount > v_borrowing.outstanding_amount THEN
        RAISE EXCEPTION
            'Repayment cannot exceed outstanding debt of %.',
            v_borrowing.outstanding_amount;
    END IF;

    SELECT id
    INTO v_account_id
    FROM public.bank_accounts
    WHERE is_active = true
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'Bank account not found.';
    END IF;

    SELECT COALESCE(
        SUM(
            CASE
                WHEN direction = 'IN' THEN amount
                ELSE -amount
            END
        ),
        0
    )
    INTO v_current_balance
    FROM public.bank_transactions
    WHERE bank_account_id = v_account_id
      AND is_void = false;

    IF p_amount > v_current_balance THEN
        RAISE EXCEPTION
            'Insufficient bank balance. Available balance: %.',
            v_current_balance;
    END IF;

    v_new_balance := ROUND(v_current_balance - p_amount, 2);

    v_new_repaid :=
        ROUND(v_borrowing.amount_repaid + p_amount, 2);

    v_new_outstanding :=
        ROUND(v_borrowing.original_amount - v_new_repaid, 2);

    IF v_new_outstanding <= 0 THEN
        v_new_status := 'Paid';
    ELSE
        v_new_status := 'Partially Paid';
    END IF;

    UPDATE public.company_borrowings
    SET
        amount_repaid = v_new_repaid,
        outstanding_amount = v_new_outstanding,
        status = v_new_status,
        updated_at = now()
    WHERE id = p_borrowing_id;

    INSERT INTO public.bank_transactions (
        bank_account_id,
        transaction_date,
        transaction_type,
        description,
        amount,
        direction,
        balance_after,
        borrowing_id,
        reference,
        created_by
    )
    VALUES (
        v_account_id,
        COALESCE(p_repayment_date, CURRENT_DATE),
        'DEBT_REPAYMENT',
        COALESCE(
            NULLIF(trim(p_description), ''),
            'Repayment of company borrowing'
        ),
        p_amount,
        'OUT',
        v_new_balance,
        p_borrowing_id,
        NULLIF(trim(p_reference), ''),
        auth.uid()
    )
    RETURNING id INTO v_transaction_id;

    RETURN json_build_object(
        'success', true,
        'transaction_id', v_transaction_id,
        'new_balance', v_new_balance,
        'amount_repaid', v_new_repaid,
        'outstanding_amount', v_new_outstanding,
        'status', v_new_status
    );

END;
$$;


--
-- Name: revoke_all_mobile_devices(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revoke_all_mobile_devices() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_count integer;
BEGIN

    IF NOT public.current_user_is_admin() THEN
        RAISE EXCEPTION 'Administrator access required';
    END IF;


    UPDATE public.mobile_devices
    SET
        revoked_at = now(),
        updated_at = now()
    WHERE revoked_at IS NULL;


    GET DIAGNOSTICS v_count = ROW_COUNT;


    RETURN jsonb_build_object(
        'success', true,
        'revoked_count', v_count
    );

END;
$$;


--
-- Name: revoke_mobile_device(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revoke_mobile_device(p_device_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN

    IF NOT public.current_user_is_admin() THEN
        RAISE EXCEPTION 'Administrator access required';
    END IF;


    UPDATE public.mobile_devices
    SET
        revoked_at = now(),
        updated_at = now()
    WHERE id = p_device_id;


    IF NOT FOUND THEN
        RAISE EXCEPTION 'Mobile device not found';
    END IF;


    RETURN jsonb_build_object(
        'success', true,
        'device_id', p_device_id,
        'revoked_at', now()
    );

END;
$$;


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: run_daily_loan_overdue_check(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.run_daily_loan_overdue_check() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    south_africa_date DATE;
BEGIN

    south_africa_date :=
        (
            CURRENT_TIMESTAMP
            AT TIME ZONE 'Africa/Johannesburg'
        )::DATE;

    PERFORM public.detect_due_loan_overdues(
        south_africa_date
    );

END;
$$;


--
-- Name: run_daily_loan_processing(timestamp without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.run_daily_loan_processing(p_as_of timestamp without time zone DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text)) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

DECLARE
    v_before_interest_transactions integer;
    v_after_interest_transactions integer;

    v_before_interest_amount numeric;
    v_after_interest_amount numeric;

    v_interest_transactions integer;
    v_total_interest numeric;

    v_active_loans integer;
    v_due_loans_before integer;
    v_due_loans_after integer;

    v_processed_at timestamp without time zone;

    v_statement_loan_ids json;

BEGIN

    /*
     * ============================================================
     * SNAPSHOT EXISTING INTEREST TRANSACTIONS
     *
     * These are the transactions that already existed before this
     * processing run.
     *
     * A temporary table allows us to identify exactly which interest
     * transactions were created by THIS run.
     * ============================================================
     */

    CREATE TEMP TABLE tmp_existing_interest_transactions
    ON COMMIT DROP
    AS
    SELECT id
    FROM public.loan_transactions
    WHERE transaction_type = 'INTEREST';


    /*
     * ============================================================
     * RECORD STATE BEFORE PROCESSING
     * ============================================================
     */

    SELECT
        COUNT(*),
        COALESCE(SUM(debit), 0)
    INTO
        v_before_interest_transactions,
        v_before_interest_amount
    FROM public.loan_transactions
    WHERE transaction_type = 'INTEREST';


    /*
     * ============================================================
     * COUNT LOANS CURRENTLY DUE
     * ============================================================
     */

    SELECT COUNT(*)
    INTO v_due_loans_before
    FROM public.loans
    WHERE loan_status = 'Active'
      AND is_deleted = false
      AND current_balance > 0
      AND next_payment_date IS NOT NULL
      AND next_interest_date IS NOT NULL
      AND next_interest_date <= p_as_of;


    /*
     * ============================================================
     * RUN THE EXISTING INTEREST ENGINE
     *
     * IMPORTANT:
     * Do not change the existing interest engine here.
     *
     * It remains responsible for:
     * - stored loan interest rate
     * - configured interest cycle
     * - configured timezone
     * - current loan balance
     * - compound interest processing
     * ============================================================
     */

    PERFORM public.apply_due_loan_interest(p_as_of);


    /*
     * ============================================================
     * RECORD STATE AFTER PROCESSING
     * ============================================================
     */

    SELECT
        COUNT(*),
        COALESCE(SUM(debit), 0)
    INTO
        v_after_interest_transactions,
        v_after_interest_amount
    FROM public.loan_transactions
    WHERE transaction_type = 'INTEREST';


    /*
     * ============================================================
     * CALCULATE ONLY WHAT THIS RUN CREATED
     * ============================================================
     */

    v_interest_transactions :=
        v_after_interest_transactions
        - v_before_interest_transactions;

    v_total_interest :=
        ROUND(
            v_after_interest_amount
            - v_before_interest_amount,
            2
        );


    /*
     * ============================================================
     * IDENTIFY LOANS THAT RECEIVED NEW INTEREST TRANSACTIONS
     *
     * These are the loans whose statements must be updated.
     *
     * DISTINCT is important because a loan could potentially have
     * more than one interest transaction during a catch-up run.
     * ============================================================
     */

    SELECT COALESCE(
        json_agg(DISTINCT loan_id ORDER BY loan_id),
        '[]'::json
    )
    INTO v_statement_loan_ids
    FROM public.loan_transactions
    WHERE transaction_type = 'INTEREST'
      AND id NOT IN (
          SELECT id
          FROM tmp_existing_interest_transactions
      );


    /*
     * ============================================================
     * COUNT ACTIVE LOANS AFTER PROCESSING
     * ============================================================
     */

    SELECT COUNT(*)
    INTO v_active_loans
    FROM public.loans
    WHERE loan_status = 'Active'
      AND is_deleted = false;


    /*
     * ============================================================
     * COUNT LOANS STILL DUE AFTER PROCESSING
     * ============================================================
     */

    SELECT COUNT(*)
    INTO v_due_loans_after
    FROM public.loans
    WHERE loan_status = 'Active'
      AND is_deleted = false
      AND current_balance > 0
      AND next_payment_date IS NOT NULL
      AND next_interest_date IS NOT NULL
      AND next_interest_date <= p_as_of;


    /*
     * ============================================================
     * PROCESSING TIMESTAMP
     * ============================================================
     */

    v_processed_at := p_as_of;


    /*
     * ============================================================
     * RETURN COMPLETE PROCESSING REPORT
     *
     * statement_loan_ids is consumed by the application layer so
     * that the corresponding single statement document can be
     * automatically updated.
     * ============================================================
     */

    RETURN json_build_object(
        'success', true,

        'processed_at',
            v_processed_at,

        'due_loans_before',
            v_due_loans_before,

        'interest_transactions',
            v_interest_transactions,

        'total_interest_charged',
            v_total_interest,

        'due_loans_after',
            v_due_loans_after,

        'active_loans',
            v_active_loans,

        'statement_loan_ids',
            v_statement_loan_ids
    );

END;
$$;


--
-- Name: send_loan_statement_generation_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.send_loan_statement_generation_request(p_queue_id uuid) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_loan_id uuid;
    v_secret text;
    v_request_id bigint;
    v_url text;
BEGIN

    /*
     * Find queue item.
     */

    SELECT loan_id
    INTO v_loan_id
    FROM public.loan_statement_generation_queue
    WHERE id = p_queue_id
      AND status IN (
          'PENDING',
          'FAILED'
      )
    LIMIT 1;


    IF v_loan_id IS NULL THEN
        RETURN NULL;
    END IF;


    /*
     * Retrieve the private Edge Function secret
     * from Supabase Vault.
     */

    SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name =
        'UMHLOMUNYE_STATEMENT_GENERATOR_SECRET'
    LIMIT 1;


    IF v_secret IS NULL
       OR length(trim(v_secret)) = 0 THEN

        UPDATE public.loan_statement_generation_queue
        SET
            status = 'FAILED',
            failed_at = now(),
            last_error =
                'Vault secret UMHLOMUNYE_STATEMENT_GENERATOR_SECRET is missing.',
            attempt_count =
                attempt_count + 1,
            updated_at = now()
        WHERE id = p_queue_id;

        RAISE EXCEPTION
            'Statement generator Vault secret is missing.';

    END IF;


    /*
     * Mark request as processing before sending it.
     */

    UPDATE public.loan_statement_generation_queue
    SET
        status = 'PROCESSING',
        processing_started_at = now(),
        attempt_count =
            attempt_count + 1,
        last_error = NULL,
        updated_at = now()
    WHERE id = p_queue_id;


    v_url :=
        'https://xralmilbzedtfdwwxton.supabase.co/functions/v1/generate-loan-statements';


    /*
     * pg_net queues the HTTP request.
     *
     * The Edge Function receives:
     *
     * {
     *   "loan_id": "..."
     * }
     */

    SELECT net.http_post(
        url := v_url,

        headers := jsonb_build_object(
            'Content-Type',
            'application/json',

            'Authorization',
            'Bearer ' || v_secret,

            'apikey',
            v_secret
        ),

        body := jsonb_build_object(
            'loan_id',
            v_loan_id
        )
    )
    INTO v_request_id;


    UPDATE public.loan_statement_generation_queue
    SET
        last_request_id = v_request_id,
        updated_at = now()
    WHERE id = p_queue_id;


    RETURN v_request_id;

END;
$$;


--
-- Name: set_agreement_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_agreement_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.agreement_number IS NULL OR NEW.agreement_number = '' THEN
        NEW.agreement_number := public.generate_agreement_number();
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: set_company_debt_repayment_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_company_debt_repayment_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: set_document_retention_defaults(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_document_retention_defaults() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN

    IF NEW.document_type = 'ID Document'
    THEN
        NEW.document_category := COALESCE(NEW.document_category, 'CUSTOMER');
        NEW.retention_policy := 'PERMANENT';
        NEW.retention_until := NULL;

    ELSIF NEW.document_type = 'Bank Statement'
    THEN
        NEW.document_category := COALESCE(NEW.document_category, 'CUSTOMER');
        NEW.retention_policy := 'SIX_MONTHS';
        NEW.retention_until :=
            COALESCE(NEW.created_at::date, CURRENT_DATE)
            + INTERVAL '6 months';

    ELSIF NEW.document_type = 'Payslip'
    THEN
        NEW.document_category := COALESCE(NEW.document_category, 'CUSTOMER');
        NEW.retention_policy := 'SIX_MONTHS';
        NEW.retention_until :=
            COALESCE(NEW.created_at::date, CURRENT_DATE)
            + INTERVAL '6 months';

    ELSIF NEW.document_type = 'Proof of Residence'
    THEN
        NEW.document_category := COALESCE(NEW.document_category, 'CUSTOMER');
        NEW.retention_policy := 'SIX_MONTHS';
        NEW.retention_until :=
            COALESCE(NEW.created_at::date, CURRENT_DATE)
            + INTERVAL '6 months';

    ELSIF NEW.document_category = 'LOAN'
    THEN
        NEW.retention_policy :=
            'THREE_YEARS_AFTER_LOAN_TERMINATION';
        NEW.retention_until := NULL;

    ELSIF NEW.document_category = 'FINANCIAL'
    THEN
        NEW.retention_policy := 'FINANCIAL_RECORD';
        NEW.retention_until := NULL;

    ELSIF NEW.document_category = 'COMPANY'
    THEN
        NEW.retention_policy := 'PERMANENT';
        NEW.retention_until := NULL;

    ELSIF NEW.document_category IN (
        'BORROWING',
        'DEBT_REPAYMENT'
    )
    THEN
        IF NEW.retention_policy IS NULL THEN
            NEW.retention_policy := 'OTHER';
        END IF;

    ELSIF NEW.document_category = 'OTHER'
    THEN
        IF NEW.retention_policy IS NULL THEN
            NEW.retention_policy := 'OTHER';
        END IF;
    END IF;

    RETURN NEW;

END;
$$;


--
-- Name: set_loan_document_retention_on_completion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_loan_document_retention_on_completion() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN

    /*
     * Only act when a loan becomes Completed.
     *
     * last_payment_date is the termination/paid-up date because
     * record_loan_payment() sets it when current_balance reaches zero.
     */
    IF NEW.loan_status = 'Completed'
       AND NEW.last_payment_date IS NOT NULL
       AND (
            OLD.loan_status IS DISTINCT FROM 'Completed'
            OR OLD.last_payment_date IS DISTINCT FROM NEW.last_payment_date
       )
    THEN

        UPDATE public.documents
        SET
            document_category = COALESCE(document_category, 'LOAN'),
            retention_policy = 'THREE_YEARS_AFTER_LOAN_TERMINATION',
            retention_until = NEW.last_payment_date + INTERVAL '3 years',
            retention_status = 'ACTIVE'
        WHERE loan_id = NEW.id
          AND COALESCE(is_archived, false) = false;

    END IF;

    RETURN NEW;

END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    new.updated_at = now();
    return new;
end;
$$;


--
-- Name: submit_loan_application(text, text, text, text, text, text, text, numeric, numeric, text, text, numeric, text, date, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_loan_application(p_id_number text, p_first_name text, p_last_name text, p_cellphone text, p_email text, p_physical_address text, p_employer text, p_monthly_income numeric, p_other_income numeric, p_bank_name text, p_account_number text, p_amount_requested numeric, p_loan_purpose text, p_preferred_payment_date date, p_collection_preference text, p_notes text, p_employment_status text) RETURNS TABLE(application_id uuid, application_number text, upload_token text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$

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
$_$;


--
-- Name: document_storage_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_storage_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    storage_capacity_bytes bigint DEFAULT ((((10)::bigint * 1024) * 1024) * 1024) NOT NULL,
    warning_threshold_percent numeric(5,2) DEFAULT 80 NOT NULL,
    urgent_threshold_percent numeric(5,2) DEFAULT 90 NOT NULL,
    critical_threshold_percent numeric(5,2) DEFAULT 95 NOT NULL,
    monitoring_enabled boolean DEFAULT true NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    CONSTRAINT document_storage_settings_capacity_positive CHECK ((storage_capacity_bytes > 0)),
    CONSTRAINT document_storage_settings_critical_valid CHECK (((critical_threshold_percent > (0)::numeric) AND (critical_threshold_percent <= (100)::numeric))),
    CONSTRAINT document_storage_settings_threshold_order CHECK (((warning_threshold_percent <= urgent_threshold_percent) AND (urgent_threshold_percent <= critical_threshold_percent))),
    CONSTRAINT document_storage_settings_urgent_valid CHECK (((urgent_threshold_percent > (0)::numeric) AND (urgent_threshold_percent <= (100)::numeric))),
    CONSTRAINT document_storage_settings_warning_valid CHECK (((warning_threshold_percent > (0)::numeric) AND (warning_threshold_percent <= (100)::numeric)))
);


--
-- Name: update_document_storage_settings(bigint, numeric, numeric, numeric, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_document_storage_settings(p_storage_capacity_bytes bigint, p_warning_threshold_percent numeric DEFAULT 80, p_urgent_threshold_percent numeric DEFAULT 90, p_critical_threshold_percent numeric DEFAULT 95, p_monitoring_enabled boolean DEFAULT true) RETURNS public.document_storage_settings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_result public.document_storage_settings;
BEGIN

  IF NOT public.current_user_is_active_admin() THEN
    RAISE EXCEPTION
      'Only an active Administrator can change document storage settings.';
  END IF;

  IF p_storage_capacity_bytes <= 0 THEN
    RAISE EXCEPTION
      'Storage capacity must be greater than zero.';
  END IF;

  IF p_warning_threshold_percent <= 0
     OR p_warning_threshold_percent > 100 THEN
    RAISE EXCEPTION
      'Warning threshold must be between 0 and 100 percent.';
  END IF;

  IF p_urgent_threshold_percent < p_warning_threshold_percent
     OR p_urgent_threshold_percent > 100 THEN
    RAISE EXCEPTION
      'Urgent threshold must be greater than or equal to the warning threshold.';
  END IF;

  IF p_critical_threshold_percent < p_urgent_threshold_percent
     OR p_critical_threshold_percent > 100 THEN
    RAISE EXCEPTION
      'Critical threshold must be greater than or equal to the urgent threshold.';
  END IF;

  UPDATE public.document_storage_settings
  SET
    storage_capacity_bytes = p_storage_capacity_bytes,
    warning_threshold_percent = p_warning_threshold_percent,
    urgent_threshold_percent = p_urgent_threshold_percent,
    critical_threshold_percent = p_critical_threshold_percent,
    monitoring_enabled = p_monitoring_enabled,
    updated_by = auth.uid(),
    updated_at = now();

  SELECT *
  INTO v_result
  FROM public.document_storage_settings
  LIMIT 1;

  RETURN v_result;
END;
$$;


--
-- Name: update_document_verification_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_document_verification_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


--
-- Name: update_loan_statement_queue_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_loan_statement_queue_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();

    RETURN NEW;
END;
$$;


--
-- Name: update_mobile_device_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_mobile_device_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


--
-- Name: validate_loan_application_upload_token(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_loan_application_upload_token(p_application_id uuid, p_upload_token text) RETURNS TABLE(valid boolean, application_id uuid, application_number text, max_files integer, max_file_size_bytes bigint, uploaded_file_count bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_token_hash text;
BEGIN

    IF p_application_id IS NULL
       OR NULLIF(TRIM(p_upload_token), '') IS NULL THEN

        RETURN QUERY
        SELECT
            false,
            NULL::uuid,
            NULL::text,
            NULL::integer,
            NULL::bigint,
            0::bigint;

        RETURN;
    END IF;

    v_token_hash := encode(
        digest(TRIM(p_upload_token), 'sha256'),
        'hex'
    );

    RETURN QUERY
    SELECT
        true,
        la.id,
        la.application_number,
        t.max_files,
        t.max_file_size_bytes,
        (
            SELECT COUNT(*)
            FROM public.documents d
            WHERE d.application_id = la.id
              AND d.deleted_at IS NULL
        )::bigint
    FROM public.loan_application_upload_tokens t
    JOIN public.loan_applications la
        ON la.id = t.application_id
    WHERE t.application_id = p_application_id
      AND t.token_hash = v_token_hash
      AND t.expires_at > now()
      AND t.used_at IS NULL
      AND la.status = 'PENDING'
    LIMIT 1;

    IF NOT FOUND THEN

        RETURN QUERY
        SELECT
            false,
            NULL::uuid,
            NULL::text,
            NULL::integer,
            NULL::bigint,
            0::bigint;

    END IF;

END;
$$;


--
-- Name: verify_loan_agreement(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.verify_loan_agreement(p_token text) RETURNS TABLE(agreement_number text, loan_number text, customer_name text, principal_amount numeric, interest_rate numeric, interest_amount numeric, total_repayment numeric, agreement_status text, accepted_at timestamp with time zone, agreement_valid boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        a.agreement_number,
        l.loan_number,
        TRIM(
            COALESCE(c.first_name, '') || ' ' ||
            COALESCE(c.last_name, '')
        ) AS customer_name,
        l.principal_amount,
        l.interest_rate,
        l.interest_amount,
        l.total_repayment,
        a.status AS agreement_status,
        a.accepted_at,
        TRUE AS agreement_valid
    FROM public.loan_agreements a
    LEFT JOIN public.loans l
        ON l.id = a.loan_id
    LEFT JOIN public.customers c
        ON c.id = l.customer_id
    WHERE a.verification_token = p_token;
END;
$$;


--
-- Name: verify_loan_statement(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.verify_loan_statement(p_token text) RETURNS TABLE(loan_number text, customer_name text, principal_amount numeric, interest_rate numeric, total_repayment numeric, current_balance numeric, total_paid numeric, loan_status text, statement_valid boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN

    RETURN QUERY

    SELECT
        l.loan_number,
        TRIM(
            COALESCE(c.first_name, '') || ' ' ||
            COALESCE(c.last_name, '')
        ) AS customer_name,
        l.principal_amount,
        l.interest_rate,
        l.total_repayment,
        l.current_balance,
        l.total_paid,
        l.loan_status,
        TRUE AS statement_valid

    FROM public.loans l

    LEFT JOIN public.customers c
        ON c.id = l.customer_id

    WHERE l.statement_verification_token = p_token
      AND l.is_deleted = FALSE;

END;
$$;


--
-- Name: write_audit_log(text, text, text, uuid, text, text, uuid, jsonb, jsonb, text, uuid, inet, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.write_audit_log(p_action text, p_description text DEFAULT NULL::text, p_entity_type text DEFAULT NULL::text, p_entity_id uuid DEFAULT NULL::uuid, p_module text DEFAULT NULL::text, p_table_name text DEFAULT NULL::text, p_record_id uuid DEFAULT NULL::uuid, p_old_data jsonb DEFAULT NULL::jsonb, p_new_data jsonb DEFAULT NULL::jsonb, p_channel text DEFAULT 'system'::text, p_installation_id uuid DEFAULT NULL::uuid, p_ip_address inet DEFAULT NULL::inet, p_user_agent text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_audit_id uuid;
    v_user_id uuid;
BEGIN
    IF NULLIF(TRIM(p_action), '') IS NULL THEN
        RAISE EXCEPTION 'Audit action is required.';
    END IF;

    v_user_id := COALESCE(p_user_id, auth.uid());

    INSERT INTO public.audit_logs (
        user_id,
        entity_type,
        entity_id,
        action,
        description,
        old_data,
        new_data,
        created_at,
        module,
        table_name,
        record_id,
        channel,
        installation_id,
        ip_address,
        user_agent
    )
    VALUES (
        v_user_id,
        p_entity_type,
        p_entity_id,
        p_action,
        p_description,
        p_old_data,
        p_new_data,
        CURRENT_TIMESTAMP,
        p_module,
        p_table_name,
        p_record_id,
        COALESCE(NULLIF(TRIM(p_channel), ''), 'system'),
        p_installation_id,
        p_ip_address,
        p_user_agent
    )
    RETURNING id INTO v_audit_id;

    RETURN v_audit_id;
END;
$$;


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    entity_type text,
    entity_id uuid,
    action text NOT NULL,
    description text,
    old_data jsonb,
    new_data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    module text,
    table_name text,
    record_id uuid,
    channel text,
    installation_id uuid,
    ip_address inet,
    user_agent text
);


--
-- Name: bank_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_name text DEFAULT 'Company Bank Account'::text NOT NULL,
    bank_name text,
    account_number_last4 text,
    currency text DEFAULT 'ZAR'::text NOT NULL,
    opening_balance numeric(15,2) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bank_accounts_opening_balance_non_negative CHECK ((opening_balance >= (0)::numeric))
);


--
-- Name: bank_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bank_account_id uuid NOT NULL,
    transaction_date date DEFAULT CURRENT_DATE NOT NULL,
    transaction_type text NOT NULL,
    description text NOT NULL,
    amount numeric(15,2) NOT NULL,
    direction text NOT NULL,
    balance_after numeric(15,2) NOT NULL,
    borrowing_id uuid,
    reference text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_void boolean DEFAULT false NOT NULL,
    voided_at timestamp with time zone,
    voided_by uuid,
    void_reason text,
    CONSTRAINT bank_transactions_amount_positive CHECK ((amount > (0)::numeric)),
    CONSTRAINT bank_transactions_direction_check CHECK ((direction = ANY (ARRAY['IN'::text, 'OUT'::text]))),
    CONSTRAINT bank_transactions_type_check CHECK ((transaction_type = ANY (ARRAY['INITIAL_BALANCE'::text, 'DEPOSIT'::text, 'BORROWING'::text, 'DEBT_REPAYMENT'::text, 'OTHER_INCOME'::text, 'OTHER_EXPENSE'::text, 'VOID'::text])))
);


--
-- Name: company_borrowings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_borrowings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lender_name text NOT NULL,
    borrowing_date date DEFAULT CURRENT_DATE NOT NULL,
    original_amount numeric(15,2) NOT NULL,
    amount_repaid numeric(15,2) DEFAULT 0 NOT NULL,
    outstanding_amount numeric(15,2) NOT NULL,
    description text,
    reference text,
    status text DEFAULT 'Outstanding'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    borrowing_agreement_path text,
    CONSTRAINT company_borrowings_amount_positive CHECK ((original_amount > (0)::numeric)),
    CONSTRAINT company_borrowings_outstanding_non_negative CHECK ((outstanding_amount >= (0)::numeric)),
    CONSTRAINT company_borrowings_repaid_non_negative CHECK ((amount_repaid >= (0)::numeric)),
    CONSTRAINT company_borrowings_status_check CHECK ((status = ANY (ARRAY['Outstanding'::text, 'Partially Paid'::text, 'Paid'::text, 'Voided'::text])))
);


--
-- Name: company_debt_repayments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_debt_repayments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    borrowing_id uuid NOT NULL,
    amount numeric(15,2) NOT NULL,
    repayment_date date NOT NULL,
    description text,
    reference text,
    proof_of_payment_path text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_debt_repayments_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: customer_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    rent_bond numeric DEFAULT 0 NOT NULL,
    electricity numeric DEFAULT 0 NOT NULL,
    water numeric DEFAULT 0 NOT NULL,
    groceries_food numeric DEFAULT 0 NOT NULL,
    transport numeric DEFAULT 0 NOT NULL,
    education_school numeric DEFAULT 0 NOT NULL,
    medical numeric DEFAULT 0 NOT NULL,
    insurance numeric DEFAULT 0 NOT NULL,
    existing_loan_repayments numeric DEFAULT 0 NOT NULL,
    credit_store_accounts numeric DEFAULT 0 NOT NULL,
    other_expenses numeric DEFAULT 0 NOT NULL,
    total_monthly_expenses numeric GENERATED ALWAYS AS (((((((((((rent_bond + electricity) + water) + groceries_food) + transport) + education_school) + medical) + insurance) + existing_loan_repayments) + credit_store_accounts) + other_expenses)) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_expenses_non_negative CHECK (((rent_bond >= (0)::numeric) AND (electricity >= (0)::numeric) AND (water >= (0)::numeric) AND (groceries_food >= (0)::numeric) AND (transport >= (0)::numeric) AND (education_school >= (0)::numeric) AND (medical >= (0)::numeric) AND (insurance >= (0)::numeric) AND (existing_loan_repayments >= (0)::numeric) AND (credit_store_accounts >= (0)::numeric) AND (other_expenses >= (0)::numeric)))
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_number text NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    id_number text,
    cellphone text,
    employer text,
    monthly_income numeric(14,2),
    address text,
    is_active boolean DEFAULT true NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    date_of_birth date,
    gender text,
    email text,
    physical_address text,
    occupation text,
    postal_address text,
    alternative_phone text
);


--
-- Name: document_backup_exports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_backup_exports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    exported_by uuid NOT NULL,
    destination_type text NOT NULL,
    status text DEFAULT 'STARTED'::text NOT NULL,
    file_name text,
    document_count integer DEFAULT 0 NOT NULL,
    total_size_bytes bigint DEFAULT 0 NOT NULL,
    storage_usage_bytes bigint,
    storage_capacity_bytes bigint,
    storage_usage_percent numeric(8,2),
    encrypted boolean DEFAULT true NOT NULL,
    backup_version text DEFAULT '1.0'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_backup_exports_destination_valid CHECK ((destination_type = ANY (ARRAY['LOCAL'::text, 'EXTERNAL_DRIVE'::text, 'GOOGLE_DRIVE'::text]))),
    CONSTRAINT document_backup_exports_document_count_valid CHECK ((document_count >= 0)),
    CONSTRAINT document_backup_exports_encrypted_required CHECK ((encrypted = true)),
    CONSTRAINT document_backup_exports_size_valid CHECK ((total_size_bytes >= 0)),
    CONSTRAINT document_backup_exports_status_valid CHECK ((status = ANY (ARRAY['STARTED'::text, 'COMPLETED'::text, 'FAILED'::text, 'CANCELLED'::text])))
);


--
-- Name: document_backup_google_drive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_backup_google_drive (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    connected_by uuid NOT NULL,
    google_account_email text,
    drive_folder_id text,
    drive_folder_name text,
    is_active boolean DEFAULT true NOT NULL,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    disconnected_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_backup_google_drive_single_active CHECK (((is_active = true) OR (disconnected_at IS NOT NULL)))
);


--
-- Name: document_cross_references; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_cross_references (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    compared_document_id uuid,
    source_record_type text,
    source_record_id uuid,
    field_name text NOT NULL,
    expected_value jsonb,
    observed_value jsonb,
    match_result text NOT NULL,
    confidence numeric(5,2),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_cross_references_match_valid CHECK ((match_result = ANY (ARRAY['MATCH'::text, 'MISMATCH'::text, 'PARTIAL_MATCH'::text, 'UNABLE_TO_VERIFY'::text])))
);


--
-- Name: TABLE document_cross_references; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.document_cross_references IS 'Comparisons between documents and/or internal records such as customers, applications and loans.';


--
-- Name: document_storage_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_storage_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    threshold_percent numeric(5,2) NOT NULL,
    usage_bytes bigint NOT NULL,
    capacity_bytes bigint NOT NULL,
    usage_percent numeric(8,2) NOT NULL,
    alert_key text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    acknowledged_by uuid,
    acknowledged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_storage_alerts_capacity_valid CHECK ((capacity_bytes > 0)),
    CONSTRAINT document_storage_alerts_status_valid CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'ACKNOWLEDGED'::text, 'RESOLVED'::text]))),
    CONSTRAINT document_storage_alerts_threshold_valid CHECK (((threshold_percent > (0)::numeric) AND (threshold_percent <= (100)::numeric))),
    CONSTRAINT document_storage_alerts_usage_valid CHECK ((usage_bytes >= 0))
);


--
-- Name: document_storage_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_storage_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    notification_type text NOT NULL,
    severity text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    usage_percent numeric(7,2) NOT NULL,
    used_bytes bigint NOT NULL,
    capacity_bytes bigint NOT NULL,
    threshold_percent numeric(7,2) NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    read_by uuid,
    CONSTRAINT document_storage_notifications_notification_type_check CHECK ((notification_type = ANY (ARRAY['WARNING'::text, 'CRITICAL'::text]))),
    CONSTRAINT document_storage_notifications_severity_check CHECK ((severity = ANY (ARRAY['WARNING'::text, 'CRITICAL'::text])))
);


--
-- Name: document_verification_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_verification_flags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    verification_id uuid,
    flag_code text NOT NULL,
    severity text DEFAULT 'MEDIUM'::text NOT NULL,
    field_name text,
    expected_value jsonb,
    actual_value jsonb,
    source_document_id uuid,
    source_record_type text,
    source_record_id uuid,
    description text NOT NULL,
    flag_status text DEFAULT 'OPEN'::text NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    resolution_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_verification_flags_severity_valid CHECK ((severity = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text, 'CRITICAL'::text]))),
    CONSTRAINT document_verification_flags_status_valid CHECK ((flag_status = ANY (ARRAY['OPEN'::text, 'REVIEWED'::text, 'RESOLVED'::text, 'DISMISSED'::text])))
);


--
-- Name: TABLE document_verification_flags; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.document_verification_flags IS 'Individual discrepancies, suspicious findings and verification warnings.';


--
-- Name: document_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    verification_status text DEFAULT 'PENDING'::text NOT NULL,
    risk_score numeric(5,2),
    verification_method text,
    verification_summary text,
    extracted_data jsonb,
    comparison_data jsonb,
    processed_at timestamp with time zone,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    reviewer_decision text,
    reviewer_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_verifications_decision_valid CHECK (((reviewer_decision IS NULL) OR (reviewer_decision = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text, 'REQUIRES_MORE_INFORMATION'::text, 'CONFIRMED_SUSPICIOUS'::text])))),
    CONSTRAINT document_verifications_status_valid CHECK ((verification_status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text, 'PASSED'::text, 'REVIEW_REQUIRED'::text, 'HIGH_RISK'::text, 'VERIFIED'::text, 'REJECTED'::text])))
);


--
-- Name: TABLE document_verifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.document_verifications IS 'Verification runs and final administrative review decisions for documents.';


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid,
    loan_id uuid,
    agreement_id uuid,
    document_type text NOT NULL,
    document_name text NOT NULL,
    document_path text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    document_category text,
    application_id uuid,
    company_name_snapshot text,
    customer_id_number_snapshot text,
    loan_number_snapshot text,
    borrowing_id uuid,
    debt_repayment_id uuid,
    mime_type text,
    file_size_bytes bigint,
    file_hash_sha256 text,
    source_type text,
    retention_policy text,
    retention_until date,
    retention_status text DEFAULT 'ACTIVE'::text,
    financial_period_type text,
    financial_period_start date,
    financial_period_end date,
    verification_status text DEFAULT 'PENDING'::text,
    is_archived boolean DEFAULT false,
    archived_at timestamp with time zone,
    archived_by uuid,
    document_group_id uuid,
    version_number integer,
    replacement_of_document_id uuid,
    replaced_by_document_id uuid,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    CONSTRAINT documents_category_valid CHECK (((document_category IS NULL) OR (document_category = ANY (ARRAY['CUSTOMER'::text, 'LOAN'::text, 'COMPANY'::text, 'BORROWING'::text, 'DEBT_REPAYMENT'::text, 'FINANCIAL'::text, 'OTHER'::text])))),
    CONSTRAINT documents_financial_period_type_valid CHECK (((financial_period_type IS NULL) OR (financial_period_type = ANY (ARRAY['MONTHLY'::text, 'YEARLY'::text])))),
    CONSTRAINT documents_retention_policy_valid CHECK (((retention_policy IS NULL) OR (retention_policy = ANY (ARRAY['PERMANENT'::text, 'SIX_MONTHS'::text, 'THREE_YEARS_AFTER_LOAN_TERMINATION'::text, 'FINANCIAL_RECORD'::text, 'OTHER'::text])))),
    CONSTRAINT documents_retention_status_valid CHECK (((retention_status IS NULL) OR (retention_status = ANY (ARRAY['ACTIVE'::text, 'ELIGIBLE_FOR_REVIEW'::text, 'RETENTION_EXPIRED'::text, 'ARCHIVED'::text])))),
    CONSTRAINT documents_source_type_valid CHECK (((source_type IS NULL) OR (source_type = ANY (ARRAY['CUSTOMER_UPLOAD'::text, 'STAFF_UPLOAD'::text, 'SYSTEM_GENERATED'::text, 'LOAN_AGREEMENT'::text, 'BORROWING_AGREEMENT'::text, 'DEBT_REPAYMENT'::text, 'FINANCIAL_SYSTEM'::text, 'OTHER'::text])))),
    CONSTRAINT documents_type_valid CHECK ((document_type = ANY (ARRAY['Loan Agreement'::text, 'Signed Loan Agreement'::text, 'Statement'::text, 'Settlement Letter'::text, 'ID Document'::text, 'Bank Statement'::text, 'Payslip'::text, 'Proof of Residence'::text, 'Paid-Up Letter'::text, 'Borrowing Agreement'::text, 'Proof of Payment'::text, 'Financial Report'::text, 'Company Document'::text, 'Other'::text]))),
    CONSTRAINT documents_verification_status_valid CHECK (((verification_status IS NULL) OR (verification_status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text, 'PASSED'::text, 'REVIEW_REQUIRED'::text, 'HIGH_RISK'::text, 'VERIFIED'::text, 'REJECTED'::text])))),
    CONSTRAINT documents_version_number_positive CHECK (((version_number IS NULL) OR (version_number >= 1)))
);


--
-- Name: TABLE documents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.documents IS 'Central Umhlomunye Finance document register. Documents may belong to customers, loans, applications, agreements, company borrowings, debt repayments, financial records or other categories.';


--
-- Name: COLUMN documents.document_category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.documents.document_category IS 'Document filing category: CUSTOMER, LOAN, COMPANY, BORROWING, DEBT_REPAYMENT, FINANCIAL or OTHER.';


--
-- Name: COLUMN documents.file_hash_sha256; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.documents.file_hash_sha256 IS 'SHA-256 hash used for duplicate/integrity detection.';


--
-- Name: COLUMN documents.retention_policy; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.documents.retention_policy IS 'Retention rule assigned to the document.';


--
-- Name: COLUMN documents.retention_until; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.documents.retention_until IS 'Date on which the document becomes eligible for retention review.';


--
-- Name: COLUMN documents.verification_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.documents.verification_status IS 'Current document verification state. A suspicious document is flagged for review rather than automatically declared fraudulent.';


--
-- Name: email_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid,
    loan_id uuid,
    recipient_email text NOT NULL,
    recipient_name text,
    notification_type text NOT NULL,
    subject text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    brevo_message_id text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    CONSTRAINT email_notifications_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'SENT'::text, 'FAILED'::text])))
);


--
-- Name: loan_agreement_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_agreement_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    loan_id uuid NOT NULL,
    application_id uuid,
    token_hash text NOT NULL,
    expires_at timestamp with time zone,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: loan_agreements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_agreements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    loan_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    agreement_number text NOT NULL,
    agreement_version text DEFAULT '1.0'::text NOT NULL,
    status text DEFAULT 'Pending'::text NOT NULL,
    generated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    sent_at timestamp without time zone,
    accepted_at timestamp without time zone,
    accepted_by uuid,
    digital_signature_reference text,
    document_path text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    signing_token uuid DEFAULT gen_random_uuid(),
    accepted_ip_address inet,
    accepted_user_agent text,
    acceptance_text text,
    customer_name_at_acceptance text,
    verification_token text,
    CONSTRAINT loan_agreements_status_valid CHECK ((status = ANY (ARRAY['Pending'::text, 'Sent'::text, 'Signed'::text, 'Cancelled'::text, 'Expired'::text])))
);


--
-- Name: loan_application_upload_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_application_upload_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    max_files integer DEFAULT 10 NOT NULL,
    max_file_size_bytes bigint DEFAULT 10485760 NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: loan_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_number text NOT NULL,
    customer_id uuid,
    first_name text NOT NULL,
    last_name text NOT NULL,
    id_number text,
    cellphone text,
    employer text,
    monthly_income numeric(14,2),
    amount_requested numeric(14,2) NOT NULL,
    application_date date DEFAULT CURRENT_DATE NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    notes text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    approved_loan_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    email text,
    physical_address text,
    employment_status text,
    other_income numeric,
    loan_purpose text,
    preferred_payment_date date,
    collection_preference text,
    bank_name text,
    account_number text,
    created_by uuid
);


--
-- Name: loan_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    loan_id uuid NOT NULL,
    note text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: loan_overdues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_overdues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    loan_id uuid NOT NULL,
    cycle_payment_date date NOT NULL,
    overdue_start_date date NOT NULL,
    overdue_amount numeric(12,2) NOT NULL,
    status text DEFAULT 'Open'::text NOT NULL,
    resolved_date date,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT loan_overdues_amount_positive CHECK ((overdue_amount > (0)::numeric)),
    CONSTRAINT loan_overdues_status_valid CHECK ((status = ANY (ARRAY['Open'::text, 'Resolved'::text])))
);


--
-- Name: loan_statement_generation_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_statement_generation_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    loan_id uuid NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    trigger_source text DEFAULT 'LOAN_TRANSACTION'::text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    processing_started_at timestamp with time zone,
    completed_at timestamp with time zone,
    failed_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_error text,
    last_request_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT loan_statement_generation_queue_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text, 'COMPLETED'::text, 'FAILED'::text])))
);


--
-- Name: loan_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    loan_id uuid NOT NULL,
    transaction_date timestamp without time zone DEFAULT now() NOT NULL,
    transaction_type text NOT NULL,
    description text,
    debit numeric(14,2) DEFAULT 0 NOT NULL,
    credit numeric(14,2) DEFAULT 0 NOT NULL,
    balance numeric(14,2) DEFAULT 0 NOT NULL,
    created_by uuid,
    reference_number text,
    payment_method text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT loan_transactions_amounts_positive CHECK (((debit >= (0)::numeric) AND (credit >= (0)::numeric)))
);


--
-- Name: TABLE loan_transactions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.loan_transactions IS 'Complete chronological financial ledger for each loan';


--
-- Name: COLUMN loan_transactions.balance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.loan_transactions.balance IS 'Running balance immediately after this transaction';


--
-- Name: loans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    loan_number text NOT NULL,
    customer_id uuid NOT NULL,
    application_id uuid,
    principal_amount numeric(14,2) NOT NULL,
    interest_rate numeric(7,2) NOT NULL,
    interest_amount numeric(14,2) DEFAULT 0 NOT NULL,
    current_balance numeric(14,2) DEFAULT 0 NOT NULL,
    total_paid numeric(14,2) DEFAULT 0 NOT NULL,
    loan_status text DEFAULT 'Pending'::text NOT NULL,
    first_payment_date date,
    next_payment_date date,
    next_interest_date timestamp without time zone,
    last_interest_date timestamp without time zone,
    last_payment_date date,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    total_repayment numeric(12,2),
    payment_day_anchor integer,
    statement_verification_token text,
    agreement_sent_at timestamp with time zone,
    agreement_accepted_at timestamp with time zone,
    agreement_version text,
    agreement_acceptance_ip text,
    term_months integer,
    monthly_repayment numeric(12,2),
    document_check_skipped boolean DEFAULT false NOT NULL,
    notes text,
    CONSTRAINT loans_interest_rate_positive CHECK ((interest_rate >= (0)::numeric)),
    CONSTRAINT loans_principal_positive CHECK ((principal_amount > (0)::numeric))
);


--
-- Name: TABLE loans; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.loans IS 'Umhlomunye Finance loan accounts';


--
-- Name: COLUMN loans.current_balance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.loans.current_balance IS 'Current outstanding balance after loans, payments and applicable interest';


--
-- Name: COLUMN loans.next_interest_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.loans.next_interest_date IS 'Next scheduled date on which the 8-day interest engine may evaluate the loan';


--
-- Name: mobile_pairing_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mobile_pairing_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system_settings_id uuid NOT NULL,
    token_hash text NOT NULL,
    numeric_code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mobile_pairing_codes_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT mobile_pairing_codes_max_attempts_check CHECK ((max_attempts > 0))
);


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_name text NOT NULL,
    minimum_loan_amount numeric DEFAULT 100 NOT NULL,
    maximum_loan_amount numeric DEFAULT 15000 NOT NULL,
    tier_1_max_amount numeric DEFAULT 2000 NOT NULL,
    tier_1_interest_rate numeric DEFAULT 40 NOT NULL,
    tier_2_interest_rate numeric DEFAULT 30 NOT NULL,
    maximum_loan_term_months integer DEFAULT 6 NOT NULL,
    interest_cycle_days integer DEFAULT 8 NOT NULL,
    currency text DEFAULT 'ZAR'::text NOT NULL,
    timezone text DEFAULT 'Africa/Johannesburg'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    financial_year_end integer,
    company_logo_url text,
    company_address text,
    term_1_max_amount numeric(12,2),
    term_1_months integer,
    term_2_max_amount numeric(12,2),
    term_2_months integer,
    term_3_months integer,
    interest_cycle_enabled boolean,
    interest_cycle_time time without time zone,
    short_name text,
    company_phone text,
    company_whatsapp text,
    company_email text,
    CONSTRAINT system_settings_financial_year_end_month_check CHECK (((financial_year_end >= 1) AND (financial_year_end <= 12))),
    CONSTRAINT system_settings_term_rules_valid CHECK (((term_1_max_amount > (0)::numeric) AND (term_2_max_amount > term_1_max_amount) AND (term_1_months > 0) AND (term_2_months > term_1_months) AND (term_3_months >= term_2_months)))
);


--
-- Name: user_push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_push_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    platform text DEFAULT 'android'::text NOT NULL,
    app_id text DEFAULT 'za.co.umhlomunye.finance'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    username text,
    full_name text,
    email text,
    cellphone text,
    role text DEFAULT 'user'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: bank_accounts bank_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_accounts
    ADD CONSTRAINT bank_accounts_pkey PRIMARY KEY (id);


--
-- Name: bank_transactions bank_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_transactions
    ADD CONSTRAINT bank_transactions_pkey PRIMARY KEY (id);


--
-- Name: company_borrowings company_borrowings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_borrowings
    ADD CONSTRAINT company_borrowings_pkey PRIMARY KEY (id);


--
-- Name: company_debt_repayments company_debt_repayments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_debt_repayments
    ADD CONSTRAINT company_debt_repayments_pkey PRIMARY KEY (id);


--
-- Name: customer_expenses customer_expenses_one_per_customer; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_expenses
    ADD CONSTRAINT customer_expenses_one_per_customer UNIQUE (customer_id);


--
-- Name: customer_expenses customer_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_expenses
    ADD CONSTRAINT customer_expenses_pkey PRIMARY KEY (id);


--
-- Name: customers customers_customer_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_customer_number_key UNIQUE (customer_number);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: document_backup_exports document_backup_exports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_backup_exports
    ADD CONSTRAINT document_backup_exports_pkey PRIMARY KEY (id);


--
-- Name: document_backup_google_drive document_backup_google_drive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_backup_google_drive
    ADD CONSTRAINT document_backup_google_drive_pkey PRIMARY KEY (id);


--
-- Name: document_cross_references document_cross_references_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_cross_references
    ADD CONSTRAINT document_cross_references_pkey PRIMARY KEY (id);


--
-- Name: document_history document_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_history
    ADD CONSTRAINT document_history_pkey PRIMARY KEY (id);


--
-- Name: document_storage_alerts document_storage_alerts_alert_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_storage_alerts
    ADD CONSTRAINT document_storage_alerts_alert_key_key UNIQUE (alert_key);


--
-- Name: document_storage_alerts document_storage_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_storage_alerts
    ADD CONSTRAINT document_storage_alerts_pkey PRIMARY KEY (id);


--
-- Name: document_storage_notifications document_storage_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_storage_notifications
    ADD CONSTRAINT document_storage_notifications_pkey PRIMARY KEY (id);


--
-- Name: document_storage_settings document_storage_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_storage_settings
    ADD CONSTRAINT document_storage_settings_pkey PRIMARY KEY (id);


--
-- Name: document_verification_flags document_verification_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_verification_flags
    ADD CONSTRAINT document_verification_flags_pkey PRIMARY KEY (id);


--
-- Name: document_verifications document_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_verifications
    ADD CONSTRAINT document_verifications_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: email_notifications email_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_notifications
    ADD CONSTRAINT email_notifications_pkey PRIMARY KEY (id);


--
-- Name: loan_agreement_tokens loan_agreement_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_agreement_tokens
    ADD CONSTRAINT loan_agreement_tokens_pkey PRIMARY KEY (id);


--
-- Name: loan_agreement_tokens loan_agreement_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_agreement_tokens
    ADD CONSTRAINT loan_agreement_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: loan_agreements loan_agreements_agreement_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_agreements
    ADD CONSTRAINT loan_agreements_agreement_number_key UNIQUE (agreement_number);


--
-- Name: loan_agreements loan_agreements_digital_signature_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_agreements
    ADD CONSTRAINT loan_agreements_digital_signature_reference_key UNIQUE (digital_signature_reference);


--
-- Name: loan_agreements loan_agreements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_agreements
    ADD CONSTRAINT loan_agreements_pkey PRIMARY KEY (id);


--
-- Name: loan_application_upload_tokens loan_application_upload_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_application_upload_tokens
    ADD CONSTRAINT loan_application_upload_tokens_pkey PRIMARY KEY (id);


--
-- Name: loan_application_upload_tokens loan_application_upload_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_application_upload_tokens
    ADD CONSTRAINT loan_application_upload_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: loan_applications loan_applications_application_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_applications
    ADD CONSTRAINT loan_applications_application_number_key UNIQUE (application_number);


--
-- Name: loan_applications loan_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_applications
    ADD CONSTRAINT loan_applications_pkey PRIMARY KEY (id);


--
-- Name: loan_notes loan_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_notes
    ADD CONSTRAINT loan_notes_pkey PRIMARY KEY (id);


--
-- Name: loan_overdues loan_overdues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_overdues
    ADD CONSTRAINT loan_overdues_pkey PRIMARY KEY (id);


--
-- Name: loan_statement_generation_queue loan_statement_generation_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_statement_generation_queue
    ADD CONSTRAINT loan_statement_generation_queue_pkey PRIMARY KEY (id);


--
-- Name: loan_transactions loan_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_transactions
    ADD CONSTRAINT loan_transactions_pkey PRIMARY KEY (id);


--
-- Name: loans loans_loan_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_loan_number_key UNIQUE (loan_number);


--
-- Name: loans loans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_pkey PRIMARY KEY (id);


--
-- Name: mobile_devices mobile_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_devices
    ADD CONSTRAINT mobile_devices_pkey PRIMARY KEY (id);


--
-- Name: mobile_devices mobile_devices_unique_installation_device; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_devices
    ADD CONSTRAINT mobile_devices_unique_installation_device UNIQUE (system_settings_id, device_id);


--
-- Name: mobile_pairing_codes mobile_pairing_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_pairing_codes
    ADD CONSTRAINT mobile_pairing_codes_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--
-- Name: user_push_tokens user_push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_push_tokens
    ADD CONSTRAINT user_push_tokens_pkey PRIMARY KEY (id);


--
-- Name: user_push_tokens user_push_tokens_unique_token; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_push_tokens
    ADD CONSTRAINT user_push_tokens_unique_token UNIQUE (token);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: company_debt_repayments_borrowing_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX company_debt_repayments_borrowing_id_idx ON public.company_debt_repayments USING btree (borrowing_id);


--
-- Name: company_debt_repayments_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX company_debt_repayments_date_idx ON public.company_debt_repayments USING btree (repayment_date);


--
-- Name: document_backup_exports_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_backup_exports_created_at_idx ON public.document_backup_exports USING btree (created_at DESC);


--
-- Name: document_backup_exports_destination_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_backup_exports_destination_idx ON public.document_backup_exports USING btree (destination_type);


--
-- Name: document_backup_exports_exported_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_backup_exports_exported_by_idx ON public.document_backup_exports USING btree (exported_by);


--
-- Name: document_backup_google_drive_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_backup_google_drive_active_idx ON public.document_backup_google_drive USING btree (is_active);


--
-- Name: document_storage_alerts_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_storage_alerts_created_at_idx ON public.document_storage_alerts USING btree (created_at DESC);


--
-- Name: document_storage_alerts_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_storage_alerts_status_idx ON public.document_storage_alerts USING btree (status);


--
-- Name: document_storage_settings_singleton_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_storage_settings_singleton_idx ON public.document_storage_settings USING btree ((true));


--
-- Name: documents_one_statement_per_loan; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX documents_one_statement_per_loan ON public.documents USING btree (loan_id) WHERE (document_type = 'Loan Statement'::text);


--
-- Name: idx_applications_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_applications_status ON public.loan_applications USING btree (status);


--
-- Name: idx_audit_logs_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_channel ON public.audit_logs USING btree (channel);


--
-- Name: idx_audit_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs USING btree (created_at DESC);


--
-- Name: idx_audit_logs_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_entity ON public.audit_logs USING btree (entity_type, entity_id);


--
-- Name: idx_audit_logs_installation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_installation ON public.audit_logs USING btree (installation_id);


--
-- Name: idx_audit_logs_module; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_module ON public.audit_logs USING btree (module);


--
-- Name: idx_audit_logs_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_record ON public.audit_logs USING btree (table_name, record_id);


--
-- Name: idx_audit_logs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_user_id ON public.audit_logs USING btree (user_id);


--
-- Name: idx_bank_transactions_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_transactions_account ON public.bank_transactions USING btree (bank_account_id);


--
-- Name: idx_bank_transactions_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_transactions_date ON public.bank_transactions USING btree (transaction_date);


--
-- Name: idx_bank_transactions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_transactions_type ON public.bank_transactions USING btree (transaction_type);


--
-- Name: idx_company_borrowings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_borrowings_status ON public.company_borrowings USING btree (status);


--
-- Name: idx_company_debt_repayments_borrowing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_debt_repayments_borrowing ON public.company_debt_repayments USING btree (borrowing_id);


--
-- Name: idx_company_debt_repayments_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_debt_repayments_date ON public.company_debt_repayments USING btree (repayment_date DESC);


--
-- Name: idx_customer_expenses_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_expenses_customer_id ON public.customer_expenses USING btree (customer_id);


--
-- Name: idx_customers_customer_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_customer_number ON public.customers USING btree (customer_number);


--
-- Name: idx_document_cross_references_compared; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_cross_references_compared ON public.document_cross_references USING btree (compared_document_id);


--
-- Name: idx_document_cross_references_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_cross_references_document ON public.document_cross_references USING btree (document_id);


--
-- Name: idx_document_history_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_history_action ON public.document_history USING btree (action);


--
-- Name: idx_document_history_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_history_document_id ON public.document_history USING btree (document_id);


--
-- Name: idx_document_history_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_history_group_id ON public.document_history USING btree (document_group_id);


--
-- Name: idx_document_history_new_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_history_new_document ON public.document_history USING btree (new_document_id);


--
-- Name: idx_document_history_performed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_history_performed_at ON public.document_history USING btree (performed_at DESC);


--
-- Name: idx_document_history_performed_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_history_performed_by ON public.document_history USING btree (performed_by);


--
-- Name: idx_document_history_previous_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_history_previous_document ON public.document_history USING btree (previous_document_id);


--
-- Name: idx_document_storage_notifications_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_storage_notifications_created_at ON public.document_storage_notifications USING btree (created_at DESC);


--
-- Name: idx_document_storage_notifications_read_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_storage_notifications_read_at ON public.document_storage_notifications USING btree (read_at);


--
-- Name: idx_document_storage_notifications_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_storage_notifications_severity ON public.document_storage_notifications USING btree (severity);


--
-- Name: idx_document_storage_notifications_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_storage_notifications_type ON public.document_storage_notifications USING btree (notification_type);


--
-- Name: idx_document_storage_notifications_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_storage_notifications_unread ON public.document_storage_notifications USING btree (notification_type, read_at) WHERE (read_at IS NULL);


--
-- Name: idx_document_verification_flags_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_verification_flags_document ON public.document_verification_flags USING btree (document_id);


--
-- Name: idx_document_verification_flags_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_verification_flags_status ON public.document_verification_flags USING btree (flag_status);


--
-- Name: idx_document_verification_flags_verification; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_verification_flags_verification ON public.document_verification_flags USING btree (verification_id);


--
-- Name: idx_document_verifications_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_verifications_document ON public.document_verifications USING btree (document_id);


--
-- Name: idx_document_verifications_reviewed_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_verifications_reviewed_by ON public.document_verifications USING btree (reviewed_by);


--
-- Name: idx_document_verifications_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_verifications_status ON public.document_verifications USING btree (verification_status);


--
-- Name: idx_documents_active_lifecycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_active_lifecycle ON public.documents USING btree (document_type, customer_id, loan_id, agreement_id, application_id, borrowing_id, debt_repayment_id) WHERE ((COALESCE(is_archived, false) = false) AND (deleted_at IS NULL));


--
-- Name: idx_documents_agreement_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_agreement_id ON public.documents USING btree (agreement_id);


--
-- Name: idx_documents_application_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_application_id ON public.documents USING btree (application_id);


--
-- Name: idx_documents_borrowing_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_borrowing_id ON public.documents USING btree (borrowing_id);


--
-- Name: idx_documents_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_category ON public.documents USING btree (document_category);


--
-- Name: idx_documents_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_customer_id ON public.documents USING btree (customer_id);


--
-- Name: idx_documents_customer_id_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_customer_id_number ON public.documents USING btree (customer_id_number_snapshot);


--
-- Name: idx_documents_debt_repayment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_debt_repayment_id ON public.documents USING btree (debt_repayment_id);


--
-- Name: idx_documents_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_deleted_at ON public.documents USING btree (deleted_at);


--
-- Name: idx_documents_deleted_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_deleted_by ON public.documents USING btree (deleted_by);


--
-- Name: idx_documents_file_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_file_hash ON public.documents USING btree (file_hash_sha256);


--
-- Name: idx_documents_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_group_id ON public.documents USING btree (document_group_id);


--
-- Name: idx_documents_loan_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_loan_id ON public.documents USING btree (loan_id);


--
-- Name: idx_documents_loan_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_loan_number ON public.documents USING btree (loan_number_snapshot);


--
-- Name: idx_documents_replaced_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_replaced_by ON public.documents USING btree (replaced_by_document_id);


--
-- Name: idx_documents_replacement_of; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_replacement_of ON public.documents USING btree (replacement_of_document_id);


--
-- Name: idx_documents_retention_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_retention_status ON public.documents USING btree (retention_status);


--
-- Name: idx_documents_retention_until; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_retention_until ON public.documents USING btree (retention_until);


--
-- Name: idx_documents_verification_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_verification_status ON public.documents USING btree (verification_status);


--
-- Name: idx_documents_version_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_version_number ON public.documents USING btree (version_number);


--
-- Name: idx_email_notifications_application; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_notifications_application ON public.email_notifications USING btree (application_id);


--
-- Name: idx_email_notifications_loan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_notifications_loan ON public.email_notifications USING btree (loan_id);


--
-- Name: idx_email_notifications_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_notifications_status ON public.email_notifications USING btree (status);


--
-- Name: idx_loan_agreement_tokens_application; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loan_agreement_tokens_application ON public.loan_agreement_tokens USING btree (application_id);


--
-- Name: idx_loan_agreement_tokens_loan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loan_agreement_tokens_loan ON public.loan_agreement_tokens USING btree (loan_id);


--
-- Name: idx_loan_agreements_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loan_agreements_customer_id ON public.loan_agreements USING btree (customer_id);


--
-- Name: idx_loan_agreements_loan_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loan_agreements_loan_id ON public.loan_agreements USING btree (loan_id);


--
-- Name: idx_loan_agreements_signing_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_loan_agreements_signing_token ON public.loan_agreements USING btree (signing_token);


--
-- Name: idx_loan_agreements_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loan_agreements_status ON public.loan_agreements USING btree (status);


--
-- Name: idx_loan_agreements_verification_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_loan_agreements_verification_token ON public.loan_agreements USING btree (verification_token);


--
-- Name: idx_loan_application_upload_tokens_application; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loan_application_upload_tokens_application ON public.loan_application_upload_tokens USING btree (application_id);


--
-- Name: idx_loan_application_upload_tokens_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loan_application_upload_tokens_expires ON public.loan_application_upload_tokens USING btree (expires_at);


--
-- Name: idx_loan_overdues_loan_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loan_overdues_loan_id ON public.loan_overdues USING btree (loan_id);


--
-- Name: idx_loan_overdues_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loan_overdues_status ON public.loan_overdues USING btree (status);


--
-- Name: idx_loan_transactions_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loan_transactions_order ON public.loan_transactions USING btree (loan_id, transaction_date, created_at, id);


--
-- Name: idx_loans_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loans_customer_id ON public.loans USING btree (customer_id);


--
-- Name: idx_loans_next_interest_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loans_next_interest_date ON public.loans USING btree (next_interest_date);


--
-- Name: idx_loans_next_payment_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loans_next_payment_date ON public.loans USING btree (next_payment_date);


--
-- Name: idx_loans_statement_verification_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_loans_statement_verification_token ON public.loans USING btree (statement_verification_token);


--
-- Name: idx_loans_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loans_status ON public.loans USING btree (loan_status);


--
-- Name: idx_statement_queue_loan_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_statement_queue_loan_id ON public.loan_statement_generation_queue USING btree (loan_id);


--
-- Name: idx_statement_queue_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_statement_queue_request_id ON public.loan_statement_generation_queue USING btree (last_request_id);


--
-- Name: idx_statement_queue_requested_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_statement_queue_requested_at ON public.loan_statement_generation_queue USING btree (requested_at);


--
-- Name: idx_statement_queue_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_statement_queue_status ON public.loan_statement_generation_queue USING btree (status);


--
-- Name: idx_transactions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_created_at ON public.loan_transactions USING btree (created_at);


--
-- Name: idx_transactions_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_date ON public.loan_transactions USING btree (transaction_date);


--
-- Name: idx_transactions_loan_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_loan_id ON public.loan_transactions USING btree (loan_id);


--
-- Name: idx_user_push_tokens_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_push_tokens_active ON public.user_push_tokens USING btree (is_active);


--
-- Name: idx_user_push_tokens_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_push_tokens_user_id ON public.user_push_tokens USING btree (user_id);


--
-- Name: loan_agreements_one_per_loan; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX loan_agreements_one_per_loan ON public.loan_agreements USING btree (loan_id);


--
-- Name: loan_statement_queue_one_active_per_loan; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX loan_statement_queue_one_active_per_loan ON public.loan_statement_generation_queue USING btree (loan_id) WHERE (status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text]));


--
-- Name: mobile_devices_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mobile_devices_active_idx ON public.mobile_devices USING btree (system_settings_id) WHERE (revoked_at IS NULL);


--
-- Name: mobile_devices_system_settings_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mobile_devices_system_settings_idx ON public.mobile_devices USING btree (system_settings_id);


--
-- Name: mobile_pairing_codes_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mobile_pairing_codes_active_idx ON public.mobile_pairing_codes USING btree (system_settings_id, expires_at) WHERE ((used_at IS NULL) AND (revoked_at IS NULL));


--
-- Name: mobile_pairing_codes_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mobile_pairing_codes_expires_at_idx ON public.mobile_pairing_codes USING btree (expires_at);


--
-- Name: mobile_pairing_codes_system_settings_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mobile_pairing_codes_system_settings_idx ON public.mobile_pairing_codes USING btree (system_settings_id);


--
-- Name: loan_applications applications_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER applications_updated_at BEFORE UPDATE ON public.loan_applications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: company_debt_repayments company_debt_repayments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER company_debt_repayments_updated_at BEFORE UPDATE ON public.company_debt_repayments FOR EACH ROW EXECUTE FUNCTION public.set_company_debt_repayment_updated_at();


--
-- Name: customers customers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: document_backup_google_drive document_backup_google_drive_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER document_backup_google_drive_updated_at BEFORE UPDATE ON public.document_backup_google_drive FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: document_storage_settings document_storage_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER document_storage_settings_updated_at BEFORE UPDATE ON public.document_storage_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: loans loans_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER loans_updated_at BEFORE UPDATE ON public.loans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: mobile_devices mobile_devices_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mobile_devices_updated_at BEFORE UPDATE ON public.mobile_devices FOR EACH ROW EXECUTE FUNCTION public.update_mobile_device_updated_at();


--
-- Name: bank_accounts trg_audit_bank_account_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_bank_account_changes AFTER INSERT OR DELETE OR UPDATE ON public.bank_accounts FOR EACH ROW EXECUTE FUNCTION public.audit_bank_account_changes();


--
-- Name: bank_transactions trg_audit_bank_transaction_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_bank_transaction_changes AFTER INSERT OR DELETE OR UPDATE ON public.bank_transactions FOR EACH ROW EXECUTE FUNCTION public.audit_bank_transaction_changes();


--
-- Name: company_borrowings trg_audit_company_borrowing_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_company_borrowing_changes AFTER INSERT OR DELETE OR UPDATE ON public.company_borrowings FOR EACH ROW EXECUTE FUNCTION public.audit_company_borrowing_changes();


--
-- Name: company_debt_repayments trg_audit_company_debt_repayment_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_company_debt_repayment_changes AFTER INSERT OR DELETE OR UPDATE ON public.company_debt_repayments FOR EACH ROW EXECUTE FUNCTION public.audit_company_debt_repayment_changes();


--
-- Name: customers trg_audit_customer_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_customer_changes AFTER INSERT OR DELETE OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.audit_customer_changes();


--
-- Name: documents trg_audit_document_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_document_changes AFTER INSERT OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.audit_document_changes();


--
-- Name: documents trg_audit_document_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_document_delete BEFORE DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.audit_document_changes();


--
-- Name: loan_agreements trg_audit_loan_agreement_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_loan_agreement_changes AFTER INSERT OR DELETE OR UPDATE ON public.loan_agreements FOR EACH ROW EXECUTE FUNCTION public.audit_loan_agreement_changes();


--
-- Name: loan_applications trg_audit_loan_application_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_loan_application_changes AFTER INSERT OR DELETE OR UPDATE ON public.loan_applications FOR EACH ROW EXECUTE FUNCTION public.audit_loan_application_changes();


--
-- Name: loans trg_audit_loan_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_loan_changes AFTER INSERT OR DELETE OR UPDATE ON public.loans FOR EACH ROW EXECUTE FUNCTION public.audit_loan_changes();


--
-- Name: loan_transactions trg_audit_loan_transaction_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_loan_transaction_changes AFTER INSERT OR DELETE OR UPDATE ON public.loan_transactions FOR EACH ROW EXECUTE FUNCTION public.audit_loan_transaction_changes();


--
-- Name: mobile_devices trg_audit_mobile_device_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_mobile_device_changes AFTER INSERT OR DELETE OR UPDATE ON public.mobile_devices FOR EACH ROW EXECUTE FUNCTION public.audit_mobile_device_changes();


--
-- Name: system_settings trg_audit_system_settings_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_system_settings_changes AFTER INSERT OR DELETE OR UPDATE ON public.system_settings FOR EACH ROW EXECUTE FUNCTION public.audit_system_settings_changes();


--
-- Name: users trg_audit_user_changes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_user_changes AFTER INSERT OR DELETE OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.audit_user_changes();


--
-- Name: customer_expenses trg_customer_expenses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customer_expenses_updated_at BEFORE UPDATE ON public.customer_expenses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: document_verifications trg_document_verifications_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_document_verifications_updated_at BEFORE UPDATE ON public.document_verifications FOR EACH ROW EXECUTE FUNCTION public.update_document_verification_updated_at();


--
-- Name: documents trg_documents_retention_defaults; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_documents_retention_defaults BEFORE INSERT ON public.documents FOR EACH ROW EXECUTE FUNCTION public.set_document_retention_defaults();


--
-- Name: loans trg_loan_document_retention_on_completion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_loan_document_retention_on_completion AFTER UPDATE OF loan_status, last_payment_date ON public.loans FOR EACH ROW EXECUTE FUNCTION public.set_loan_document_retention_on_completion();


--
-- Name: loan_statement_generation_queue trg_loan_statement_queue_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_loan_statement_queue_updated_at BEFORE UPDATE ON public.loan_statement_generation_queue FOR EACH ROW EXECUTE FUNCTION public.update_loan_statement_queue_updated_at();


--
-- Name: loan_transactions trg_queue_statement_after_interest_transaction; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_queue_statement_after_interest_transaction AFTER INSERT ON public.loan_transactions FOR EACH ROW EXECUTE FUNCTION public.queue_statement_after_interest_transaction();


--
-- Name: loan_agreements trg_set_agreement_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_agreement_number BEFORE INSERT ON public.loan_agreements FOR EACH ROW EXECUTE FUNCTION public.set_agreement_number();


--
-- Name: users users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: bank_accounts bank_accounts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_accounts
    ADD CONSTRAINT bank_accounts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: bank_transactions bank_transactions_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_transactions
    ADD CONSTRAINT bank_transactions_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.bank_accounts(id) ON DELETE RESTRICT;


--
-- Name: bank_transactions bank_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_transactions
    ADD CONSTRAINT bank_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: bank_transactions bank_transactions_voided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_transactions
    ADD CONSTRAINT bank_transactions_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES public.users(id);


--
-- Name: company_borrowings company_borrowings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_borrowings
    ADD CONSTRAINT company_borrowings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: company_debt_repayments company_debt_repayments_borrowing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_debt_repayments
    ADD CONSTRAINT company_debt_repayments_borrowing_id_fkey FOREIGN KEY (borrowing_id) REFERENCES public.company_borrowings(id) ON DELETE RESTRICT;


--
-- Name: company_debt_repayments company_debt_repayments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_debt_repayments
    ADD CONSTRAINT company_debt_repayments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: customer_expenses customer_expenses_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_expenses
    ADD CONSTRAINT customer_expenses_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: customers customers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: customers customers_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id);


--
-- Name: document_backup_exports document_backup_exports_exported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_backup_exports
    ADD CONSTRAINT document_backup_exports_exported_by_fkey FOREIGN KEY (exported_by) REFERENCES public.users(id);


--
-- Name: document_backup_google_drive document_backup_google_drive_connected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_backup_google_drive
    ADD CONSTRAINT document_backup_google_drive_connected_by_fkey FOREIGN KEY (connected_by) REFERENCES public.users(id);


--
-- Name: document_cross_references document_cross_references_compared_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_cross_references
    ADD CONSTRAINT document_cross_references_compared_document_id_fkey FOREIGN KEY (compared_document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


--
-- Name: document_cross_references document_cross_references_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_cross_references
    ADD CONSTRAINT document_cross_references_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: document_history document_history_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_history
    ADD CONSTRAINT document_history_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


--
-- Name: document_history document_history_new_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_history
    ADD CONSTRAINT document_history_new_document_id_fkey FOREIGN KEY (new_document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


--
-- Name: document_history document_history_performed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_history
    ADD CONSTRAINT document_history_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: document_history document_history_previous_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_history
    ADD CONSTRAINT document_history_previous_document_id_fkey FOREIGN KEY (previous_document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


--
-- Name: document_storage_alerts document_storage_alerts_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_storage_alerts
    ADD CONSTRAINT document_storage_alerts_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.users(id);


--
-- Name: document_storage_notifications document_storage_notifications_read_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_storage_notifications
    ADD CONSTRAINT document_storage_notifications_read_by_fkey FOREIGN KEY (read_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: document_storage_settings document_storage_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_storage_settings
    ADD CONSTRAINT document_storage_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: document_verification_flags document_verification_flags_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_verification_flags
    ADD CONSTRAINT document_verification_flags_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: document_verification_flags document_verification_flags_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_verification_flags
    ADD CONSTRAINT document_verification_flags_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: document_verification_flags document_verification_flags_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_verification_flags
    ADD CONSTRAINT document_verification_flags_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


--
-- Name: document_verification_flags document_verification_flags_verification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_verification_flags
    ADD CONSTRAINT document_verification_flags_verification_id_fkey FOREIGN KEY (verification_id) REFERENCES public.document_verifications(id) ON DELETE CASCADE;


--
-- Name: document_verifications document_verifications_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_verifications
    ADD CONSTRAINT document_verifications_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: document_verifications document_verifications_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_verifications
    ADD CONSTRAINT document_verifications_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: documents documents_agreement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_agreement_id_fkey FOREIGN KEY (agreement_id) REFERENCES public.loan_agreements(id) ON DELETE SET NULL;


--
-- Name: documents documents_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.loan_applications(id) ON DELETE SET NULL;


--
-- Name: documents documents_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: documents documents_borrowing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_borrowing_id_fkey FOREIGN KEY (borrowing_id) REFERENCES public.company_borrowings(id) ON DELETE SET NULL;


--
-- Name: documents documents_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: documents documents_debt_repayment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_debt_repayment_id_fkey FOREIGN KEY (debt_repayment_id) REFERENCES public.company_debt_repayments(id) ON DELETE SET NULL;


--
-- Name: documents documents_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id) ON DELETE CASCADE;


--
-- Name: documents documents_replaced_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_replaced_by_fk FOREIGN KEY (replaced_by_document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


--
-- Name: documents documents_replacement_of_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_replacement_of_fk FOREIGN KEY (replacement_of_document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


--
-- Name: email_notifications email_notifications_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_notifications
    ADD CONSTRAINT email_notifications_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.loan_applications(id) ON DELETE SET NULL;


--
-- Name: email_notifications email_notifications_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_notifications
    ADD CONSTRAINT email_notifications_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id) ON DELETE SET NULL;


--
-- Name: loan_agreement_tokens loan_agreement_tokens_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_agreement_tokens
    ADD CONSTRAINT loan_agreement_tokens_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.loan_applications(id) ON DELETE SET NULL;


--
-- Name: loan_agreement_tokens loan_agreement_tokens_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_agreement_tokens
    ADD CONSTRAINT loan_agreement_tokens_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id) ON DELETE CASCADE;


--
-- Name: loan_agreements loan_agreements_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_agreements
    ADD CONSTRAINT loan_agreements_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: loan_agreements loan_agreements_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_agreements
    ADD CONSTRAINT loan_agreements_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id) ON DELETE CASCADE;


--
-- Name: loan_application_upload_tokens loan_application_upload_tokens_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_application_upload_tokens
    ADD CONSTRAINT loan_application_upload_tokens_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.loan_applications(id) ON DELETE CASCADE;


--
-- Name: loan_applications loan_applications_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_applications
    ADD CONSTRAINT loan_applications_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: loan_applications loan_applications_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_applications
    ADD CONSTRAINT loan_applications_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: loan_notes loan_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_notes
    ADD CONSTRAINT loan_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: loan_notes loan_notes_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_notes
    ADD CONSTRAINT loan_notes_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id) ON DELETE CASCADE;


--
-- Name: loan_overdues loan_overdues_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_overdues
    ADD CONSTRAINT loan_overdues_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id) ON DELETE CASCADE;


--
-- Name: loan_statement_generation_queue loan_statement_generation_queue_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_statement_generation_queue
    ADD CONSTRAINT loan_statement_generation_queue_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id) ON DELETE CASCADE;


--
-- Name: loan_transactions loan_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_transactions
    ADD CONSTRAINT loan_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: loan_transactions loan_transactions_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_transactions
    ADD CONSTRAINT loan_transactions_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id) ON DELETE RESTRICT;


--
-- Name: loans loans_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.loan_applications(id);


--
-- Name: loans loans_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: loans loans_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: loans loans_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id);


--
-- Name: mobile_devices mobile_devices_system_settings_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_devices
    ADD CONSTRAINT mobile_devices_system_settings_id_fkey FOREIGN KEY (system_settings_id) REFERENCES public.system_settings(id) ON DELETE CASCADE;


--
-- Name: mobile_pairing_codes mobile_pairing_codes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_pairing_codes
    ADD CONSTRAINT mobile_pairing_codes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mobile_pairing_codes mobile_pairing_codes_system_settings_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_pairing_codes
    ADD CONSTRAINT mobile_pairing_codes_system_settings_id_fkey FOREIGN KEY (system_settings_id) REFERENCES public.system_settings(id) ON DELETE CASCADE;


--
-- Name: user_push_tokens user_push_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_push_tokens
    ADD CONSTRAINT user_push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: users users_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id);


--
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: company_debt_repayments Administrators can create company debt repayments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Administrators can create company debt repayments" ON public.company_debt_repayments FOR INSERT TO authenticated WITH CHECK ((public.current_user_is_active_admin() AND (created_by = auth.uid())));


--
-- Name: company_debt_repayments Administrators can delete company debt repayments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Administrators can delete company debt repayments" ON public.company_debt_repayments FOR DELETE TO authenticated USING (public.current_user_is_active_admin());


--
-- Name: bank_accounts Administrators can manage bank accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Administrators can manage bank accounts" ON public.bank_accounts TO authenticated USING (public.is_current_user_admin()) WITH CHECK (public.is_current_user_admin());


--
-- Name: bank_transactions Administrators can manage bank transactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Administrators can manage bank transactions" ON public.bank_transactions TO authenticated USING (public.is_current_user_admin()) WITH CHECK (public.is_current_user_admin());


--
-- Name: company_borrowings Administrators can manage company borrowings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Administrators can manage company borrowings" ON public.company_borrowings TO authenticated USING (public.is_current_user_admin()) WITH CHECK (public.is_current_user_admin());


--
-- Name: company_debt_repayments Administrators can update company debt repayments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Administrators can update company debt repayments" ON public.company_debt_repayments FOR UPDATE TO authenticated USING (public.current_user_is_active_admin()) WITH CHECK (public.current_user_is_active_admin());


--
-- Name: system_settings Administrators can update system settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Administrators can update system settings" ON public.system_settings FOR UPDATE TO authenticated USING (public.is_current_user_admin()) WITH CHECK (public.is_current_user_admin());


--
-- Name: users Administrators can view all users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Administrators can view all users" ON public.users FOR SELECT TO authenticated USING (public.is_current_user_admin());


--
-- Name: document_backup_google_drive Admins can create Google Drive backup settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can create Google Drive backup settings" ON public.document_backup_google_drive FOR INSERT TO authenticated WITH CHECK ((public.current_user_is_active_admin() AND (connected_by = auth.uid())));


--
-- Name: document_backup_exports Admins can create document backup exports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can create document backup exports" ON public.document_backup_exports FOR INSERT TO authenticated WITH CHECK ((public.current_user_is_active_admin() AND (exported_by = auth.uid())));


--
-- Name: documents Admins can create documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can create documents" ON public.documents FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text) AND (u.is_active = true) AND (u.is_deleted = false)))));


--
-- Name: documents Admins can delete documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete documents" ON public.documents FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text) AND (u.is_active = true) AND (u.is_deleted = false)))));


--
-- Name: document_storage_alerts Admins can insert document storage alerts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert document storage alerts" ON public.document_storage_alerts FOR INSERT TO authenticated WITH CHECK (public.current_user_is_active_admin());


--
-- Name: document_backup_google_drive Admins can update Google Drive backup settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update Google Drive backup settings" ON public.document_backup_google_drive FOR UPDATE TO authenticated USING (public.current_user_is_active_admin()) WITH CHECK (public.current_user_is_active_admin());


--
-- Name: document_backup_exports Admins can update document backup exports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update document backup exports" ON public.document_backup_exports FOR UPDATE TO authenticated USING (public.current_user_is_active_admin()) WITH CHECK (public.current_user_is_active_admin());


--
-- Name: document_storage_alerts Admins can update document storage alerts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update document storage alerts" ON public.document_storage_alerts FOR UPDATE TO authenticated USING (public.current_user_is_active_admin()) WITH CHECK (public.current_user_is_active_admin());


--
-- Name: document_storage_settings Admins can update document storage settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update document storage settings" ON public.document_storage_settings FOR UPDATE TO authenticated USING (public.current_user_is_active_admin()) WITH CHECK (public.current_user_is_active_admin());


--
-- Name: documents Admins can update documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update documents" ON public.documents FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text) AND (u.is_active = true) AND (u.is_deleted = false))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'admin'::text) AND (u.is_active = true) AND (u.is_deleted = false)))));


--
-- Name: mobile_devices Admins can update mobile devices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update mobile devices" ON public.mobile_devices FOR UPDATE TO authenticated USING (public.current_user_is_admin()) WITH CHECK (public.current_user_is_admin());


--
-- Name: document_backup_google_drive Admins can view Google Drive backup settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view Google Drive backup settings" ON public.document_backup_google_drive FOR SELECT TO authenticated USING (public.current_user_is_active_admin());


--
-- Name: document_backup_exports Admins can view document backup exports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view document backup exports" ON public.document_backup_exports FOR SELECT TO authenticated USING (public.current_user_is_active_admin());


--
-- Name: document_storage_alerts Admins can view document storage alerts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view document storage alerts" ON public.document_storage_alerts FOR SELECT TO authenticated USING (public.current_user_is_active_admin());


--
-- Name: document_storage_settings Admins can view document storage settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view document storage settings" ON public.document_storage_settings FOR SELECT TO authenticated USING (public.current_user_is_active_admin());


--
-- Name: mobile_devices Admins can view mobile devices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view mobile devices" ON public.mobile_devices FOR SELECT TO authenticated USING (public.current_user_is_admin());


--
-- Name: mobile_pairing_codes Admins can view mobile pairing codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view mobile pairing codes" ON public.mobile_pairing_codes FOR SELECT TO authenticated USING (public.current_user_is_admin());


--
-- Name: bank_accounts Authenticated users can view bank accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view bank accounts" ON public.bank_accounts FOR SELECT TO authenticated USING (true);


--
-- Name: bank_transactions Authenticated users can view bank transactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view bank transactions" ON public.bank_transactions FOR SELECT TO authenticated USING (true);


--
-- Name: company_borrowings Authenticated users can view company borrowings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view company borrowings" ON public.company_borrowings FOR SELECT TO authenticated USING (true);


--
-- Name: customer_expenses Authenticated users can view customer expenses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view customer expenses" ON public.customer_expenses FOR SELECT TO authenticated USING (true);


--
-- Name: document_history Authenticated users can view document history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view document history" ON public.document_history FOR SELECT TO authenticated USING (true);


--
-- Name: loan_agreements Authenticated users can view loan agreements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view loan agreements" ON public.loan_agreements FOR SELECT TO authenticated USING (true);


--
-- Name: loan_overdues Authenticated users can view loan overdues; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view loan overdues" ON public.loan_overdues FOR SELECT TO authenticated USING (true);


--
-- Name: documents Authenticated users can view permitted documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view permitted documents" ON public.documents FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.is_active = true) AND (u.is_deleted = false)))));


--
-- Name: loan_statement_generation_queue Authenticated users can view statement queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view statement queue" ON public.loan_statement_generation_queue FOR SELECT TO authenticated USING (true);


--
-- Name: system_settings Authenticated users can view system settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view system settings" ON public.system_settings FOR SELECT TO authenticated USING (true);


--
-- Name: user_push_tokens Users can delete own push tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own push tokens" ON public.user_push_tokens FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: user_push_tokens Users can insert own push tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own push tokens" ON public.user_push_tokens FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: user_push_tokens Users can update own push tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own push tokens" ON public.user_push_tokens FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: user_push_tokens Users can view own push tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own push tokens" ON public.user_push_tokens FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: users Users can view their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own profile" ON public.users FOR SELECT TO authenticated USING ((id = auth.uid()));


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: loan_notes authenticated users can create loan notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated users can create loan notes" ON public.loan_notes FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid()));


--
-- Name: customers authenticated users can read customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated users can read customers" ON public.customers FOR SELECT TO authenticated USING (true);


--
-- Name: loan_applications authenticated users can view applications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated users can view applications" ON public.loan_applications FOR SELECT TO authenticated USING (true);


--
-- Name: audit_logs authenticated users can view audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated users can view audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (true);


--
-- Name: loan_notes authenticated users can view loan notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated users can view loan notes" ON public.loan_notes FOR SELECT TO authenticated USING (true);


--
-- Name: loans authenticated users can view loans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated users can view loans" ON public.loans FOR SELECT TO authenticated USING (true);


--
-- Name: loan_transactions authenticated users can view transactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated users can view transactions" ON public.loan_transactions FOR SELECT TO authenticated USING (true);


--
-- Name: bank_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: company_borrowings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.company_borrowings ENABLE ROW LEVEL SECURITY;

--
-- Name: company_debt_repayments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.company_debt_repayments ENABLE ROW LEVEL SECURITY;

--
-- Name: company_debt_repayments company_debt_repayments_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY company_debt_repayments_admin_select ON public.company_debt_repayments FOR SELECT TO authenticated USING (public.current_user_is_active_admin());


--
-- Name: customer_expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: document_backup_exports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_backup_exports ENABLE ROW LEVEL SECURITY;

--
-- Name: document_backup_google_drive; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_backup_google_drive ENABLE ROW LEVEL SECURITY;

--
-- Name: document_cross_references; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_cross_references ENABLE ROW LEVEL SECURITY;

--
-- Name: document_cross_references document_cross_references_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_cross_references_admin_insert ON public.document_cross_references FOR INSERT TO authenticated WITH CHECK (public.current_user_is_active_admin());


--
-- Name: document_cross_references document_cross_references_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_cross_references_select_authenticated ON public.document_cross_references FOR SELECT TO authenticated USING (true);


--
-- Name: document_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_history ENABLE ROW LEVEL SECURITY;

--
-- Name: document_storage_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_storage_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: document_storage_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_storage_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: document_storage_notifications document_storage_notifications_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_storage_notifications_admin_select ON public.document_storage_notifications FOR SELECT TO authenticated USING (public.current_user_is_admin());


--
-- Name: document_storage_notifications document_storage_notifications_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_storage_notifications_admin_update ON public.document_storage_notifications FOR UPDATE TO authenticated USING (public.current_user_is_admin()) WITH CHECK (public.current_user_is_admin());


--
-- Name: document_storage_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_storage_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: document_verification_flags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_verification_flags ENABLE ROW LEVEL SECURITY;

--
-- Name: document_verification_flags document_verification_flags_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_verification_flags_admin_insert ON public.document_verification_flags FOR INSERT TO authenticated WITH CHECK (public.current_user_is_active_admin());


--
-- Name: document_verification_flags document_verification_flags_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_verification_flags_admin_update ON public.document_verification_flags FOR UPDATE TO authenticated USING (public.current_user_is_active_admin()) WITH CHECK (public.current_user_is_active_admin());


--
-- Name: document_verification_flags document_verification_flags_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_verification_flags_select_authenticated ON public.document_verification_flags FOR SELECT TO authenticated USING (true);


--
-- Name: document_verifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_verifications ENABLE ROW LEVEL SECURITY;

--
-- Name: document_verifications document_verifications_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_verifications_admin_insert ON public.document_verifications FOR INSERT TO authenticated WITH CHECK (public.current_user_is_active_admin());


--
-- Name: document_verifications document_verifications_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_verifications_admin_update ON public.document_verifications FOR UPDATE TO authenticated USING (public.current_user_is_active_admin()) WITH CHECK (public.current_user_is_active_admin());


--
-- Name: document_verifications document_verifications_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_verifications_select_authenticated ON public.document_verifications FOR SELECT TO authenticated USING (true);


--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: email_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: loan_agreement_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loan_agreement_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: loan_agreements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loan_agreements ENABLE ROW LEVEL SECURITY;

--
-- Name: loan_application_upload_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loan_application_upload_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: loan_applications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loan_applications ENABLE ROW LEVEL SECURITY;

--
-- Name: loan_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loan_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: loan_overdues; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loan_overdues ENABLE ROW LEVEL SECURITY;

--
-- Name: loan_statement_generation_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loan_statement_generation_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: loan_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loan_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: loans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;

--
-- Name: mobile_devices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mobile_devices ENABLE ROW LEVEL SECURITY;

--
-- Name: mobile_pairing_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mobile_pairing_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: loan_applications public can submit applications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public can submit applications" ON public.loan_applications FOR INSERT TO anon WITH CHECK (true);


--
-- Name: system_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: user_push_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: loan_notes users can delete their own loan notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can delete their own loan notes" ON public.loan_notes FOR DELETE TO authenticated USING ((created_by = auth.uid()));


--
-- Name: loan_notes users can update their own loan notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can update their own loan notes" ON public.loan_notes FOR UPDATE TO authenticated USING ((created_by = auth.uid())) WITH CHECK ((created_by = auth.uid()));


--
-- PostgreSQL database dump complete
--


-- ============================================================
-- Loan money movement -> bank ledger synchronization
-- ============================================================
ALTER TABLE public.bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_transaction_type_check;

ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY[
    'INITIAL_BALANCE','DEPOSIT','BORROWING','DEBT_REPAYMENT',
    'LOAN_DISBURSEMENT','LOAN_REPAYMENT','OTHER_INCOME','OTHER_EXPENSE','VOID'
  ]));

CREATE OR REPLACE FUNCTION public.sync_loan_transaction_to_bank()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bank_account_id uuid;
  v_balance_after numeric(15,2);
  v_direction text;
  v_amount numeric(15,2);
  v_transaction_type text;
  v_reference text;
BEGIN
  IF upper(coalesce(new.transaction_type, '')) = 'LOAN'
     AND coalesce(new.debit, 0) > 0 THEN
    v_direction := 'OUT';
    v_amount := round(new.debit, 2);
    v_transaction_type := 'LOAN_DISBURSEMENT';
    v_reference := 'LOAN-TXN-' || new.id::text;
  ELSIF upper(coalesce(new.transaction_type, '')) = 'PAYMENT'
     AND coalesce(new.credit, 0) > 0 THEN
    v_direction := 'IN';
    v_amount := round(new.credit, 2);
    v_transaction_type := 'LOAN_REPAYMENT';
    v_reference := 'LOAN-TXN-' || new.id::text;
  ELSE
    RETURN new;
  END IF;

  SELECT id
  INTO v_bank_account_id
  FROM public.bank_accounts
  WHERE is_active = true
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'No active company bank account exists. Loan money movement cannot be posted to the bank ledger.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bank_transactions
    WHERE reference = v_reference
      AND is_void = false
  ) THEN
    RETURN new;
  END IF;

  SELECT coalesce(sum(
    CASE WHEN direction = 'IN' THEN amount ELSE -amount END
  ), 0)
  INTO v_balance_after
  FROM public.bank_transactions
  WHERE bank_account_id = v_bank_account_id
    AND is_void = false;

  IF v_direction = 'OUT' THEN
    v_balance_after := round(v_balance_after - v_amount, 2);
  ELSE
    v_balance_after := round(v_balance_after + v_amount, 2);
  END IF;

  INSERT INTO public.bank_transactions (
    bank_account_id,
    transaction_date,
    transaction_type,
    description,
    amount,
    direction,
    balance_after,
    reference,
    created_by
  )
  VALUES (
    v_bank_account_id,
    coalesce(new.transaction_date::date, current_date),
    v_transaction_type,
    coalesce(
      nullif(trim(new.description), ''),
      CASE
        WHEN v_direction = 'OUT' THEN 'Loan disbursement'
        ELSE 'Loan repayment'
      END
    ),
    v_amount,
    v_direction,
    v_balance_after,
    v_reference,
    new.created_by
  );

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_loan_transaction_to_bank ON public.loan_transactions;

CREATE TRIGGER trg_sync_loan_transaction_to_bank
AFTER INSERT ON public.loan_transactions
FOR EACH ROW
EXECUTE FUNCTION public.sync_loan_transaction_to_bank();

\unrestrict BjX34gydFcftzGonVECoIrVc7c32MahbSRQSaTiAIpj7OUAL2nlvZjGzw0ILelN

