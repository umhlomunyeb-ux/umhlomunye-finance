-- Verified existing-client classification for Umhlomunye Finance.
-- A verified existing client is exempt from the R1,500 first-time borrower cap
-- and receives the existing-client loan eligibility limit of R6,000.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS first_time_borrower_rule_applicable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS existing_client_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS existing_client_verified_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS existing_client_verification_note text;

UPDATE public.customers
SET first_time_borrower_rule_applicable = true
WHERE first_time_borrower_rule_applicable IS NULL;

ALTER TABLE public.customers
  ALTER COLUMN first_time_borrower_rule_applicable SET DEFAULT true,
  ALTER COLUMN first_time_borrower_rule_applicable SET NOT NULL;

CREATE OR REPLACE FUNCTION public.verify_existing_customer(
  p_customer_id uuid,
  p_verification_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_admin_id uuid := auth.uid();
BEGIN
  IF NOT public.current_user_is_active_admin() THEN
    RAISE EXCEPTION 'Only an active Administrator can verify an existing client.';
  END IF;

  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer is required.';
  END IF;

  IF length(coalesce(p_verification_note, '')) > 500 THEN
    RAISE EXCEPTION 'Verification note cannot exceed 500 characters.';
  END IF;

  PERFORM set_config('app.verify_existing_customer', 'true', true);

  UPDATE public.customers
  SET
    first_time_borrower_rule_applicable = false,
    existing_client_verified_at = coalesce(existing_client_verified_at, now()),
    existing_client_verified_by = coalesce(existing_client_verified_by, v_admin_id),
    existing_client_verification_note = nullif(trim(p_verification_note), '')
  WHERE id = p_customer_id
    AND coalesce(is_active, true) = true
    AND coalesce(is_deleted, false) = false
  RETURNING * INTO v_customer;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active customer was not found.';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', v_customer.id,
    'customer_number', v_customer.customer_number,
    'existing_client_verified_at', v_customer.existing_client_verified_at,
    'loan_limit', 6000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_existing_customer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_existing_customer(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_first_time_borrower(
  p_customer_id uuid,
  p_id_number text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid := p_customer_id;
  v_rule_applicable boolean;
  v_existing_verified boolean := false;
  v_normalized_id text;
BEGIN
  IF v_customer_id IS NULL AND nullif(p_id_number, '') IS NOT NULL THEN
    v_normalized_id := regexp_replace(p_id_number, '[^0-9]', '', 'g');

    SELECT c.id, c.first_time_borrower_rule_applicable,
           (c.existing_client_verified_at IS NOT NULL)
    INTO v_customer_id, v_rule_applicable, v_existing_verified
    FROM public.customers c
    WHERE regexp_replace(coalesce(c.id_number, ''), '[^0-9]', '', 'g') = v_normalized_id
      AND coalesce(c.is_deleted, false) = false
      AND coalesce(c.is_active, true) = true
    ORDER BY c.created_at DESC NULLS LAST
    LIMIT 1;
  ELSIF v_customer_id IS NOT NULL THEN
    SELECT c.first_time_borrower_rule_applicable,
           (c.existing_client_verified_at IS NOT NULL)
    INTO v_rule_applicable, v_existing_verified
    FROM public.customers c
    WHERE c.id = v_customer_id
      AND coalesce(c.is_deleted, false) = false
      AND coalesce(c.is_active, true) = true
      AND (
        nullif(p_id_number, '') IS NULL
        OR regexp_replace(coalesce(c.id_number, ''), '[^0-9]', '', 'g') =
           regexp_replace(p_id_number, '[^0-9]', '', 'g')
      );

    IF NOT FOUND THEN
      v_customer_id := NULL;
    END IF;
  END IF;

  IF v_customer_id IS NULL THEN
    RETURN true;
  END IF;

  IF coalesce(v_existing_verified, false) OR coalesce(v_rule_applicable, false) = false THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1
    FROM public.loans l
    WHERE l.customer_id = v_customer_id
      AND coalesce(l.is_deleted, false) = false
      AND coalesce(l.total_paid, 0) >= coalesce(l.total_repayment, 0)
      AND coalesce(l.current_balance, 0) <= 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_first_time_borrower(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_first_time_borrower(uuid, text) TO authenticated;


-- Verification metadata can only be changed through the administrator RPC.
CREATE OR REPLACE FUNCTION public.guard_existing_client_verification_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.first_time_borrower_rule_applicable IS DISTINCT FROM true
       OR NEW.existing_client_verified_at IS NOT NULL
       OR NEW.existing_client_verified_by IS NOT NULL
       OR NEW.existing_client_verification_note IS NOT NULL
    THEN
      IF current_setting('app.verify_existing_customer', true) IS DISTINCT FROM 'true'
         OR NOT public.current_user_is_active_admin()
      THEN
        RAISE EXCEPTION 'New customers must start as unverified. Only an active Administrator can verify an existing client.';
      END IF;
    END IF;
  ELSIF
    NEW.first_time_borrower_rule_applicable IS DISTINCT FROM OLD.first_time_borrower_rule_applicable
    OR NEW.existing_client_verified_at IS DISTINCT FROM OLD.existing_client_verified_at
    OR NEW.existing_client_verified_by IS DISTINCT FROM OLD.existing_client_verified_by
    OR NEW.existing_client_verification_note IS DISTINCT FROM OLD.existing_client_verification_note
  THEN
    IF current_setting('app.verify_existing_customer', true) IS DISTINCT FROM 'true'
       OR NOT public.current_user_is_active_admin()
    THEN
      RAISE EXCEPTION 'Existing-client verification can only be changed by an active Administrator using the verification process.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_existing_client_verification_fields ON public.customers;
CREATE TRIGGER trg_guard_existing_client_verification_fields
BEFORE INSERT OR UPDATE ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.guard_existing_client_verification_fields();

REVOKE ALL ON FUNCTION public.guard_existing_client_verification_fields() FROM PUBLIC, anon, authenticated;

-- Enforce borrower-specific limits at the database boundary for every new or
-- amended application, regardless of which screen or API submits it.
CREATE OR REPLACE FUNCTION public.enforce_borrower_loan_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_time boolean;
BEGIN
  IF NEW.amount_requested IS NULL OR NEW.amount_requested <= 0 THEN
    RETURN NEW;
  END IF;

  v_first_time := public.is_first_time_borrower(NEW.customer_id, NEW.id_number);

  IF v_first_time AND NEW.amount_requested > 1500 THEN
    RAISE EXCEPTION 'FIRST_TIME_BORROWER_LIMIT: First-time applicants may request no more than R1,500.';
  END IF;

  IF NOT v_first_time AND NEW.amount_requested > 6000 THEN
    RAISE EXCEPTION 'EXISTING_CLIENT_LIMIT: Verified or returning clients may request no more than R6,000.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_borrower_loan_limits ON public.loan_applications;
CREATE TRIGGER trg_enforce_borrower_loan_limits
BEFORE INSERT OR UPDATE OF amount_requested, customer_id, id_number
ON public.loan_applications
FOR EACH ROW
EXECUTE FUNCTION public.enforce_borrower_loan_limits();

REVOKE ALL ON FUNCTION public.enforce_borrower_loan_limits() FROM PUBLIC, anon, authenticated;
