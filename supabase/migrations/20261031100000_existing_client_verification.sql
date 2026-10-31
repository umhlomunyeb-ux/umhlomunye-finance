-- Verified existing-client classification for Umhlomunye Finance.
-- A verified existing client is exempt from the R1,500 first-time borrower cap
-- and receives the existing-client loan eligibility limit of R6,000.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS first_time_borrower_rule_applicable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS existing_client_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS existing_client_verified_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS existing_client_verification_note text;

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

  UPDATE public.customers
  SET
    first_time_borrower_rule_applicable = false,
    existing_client_verified_at = coalesce(existing_client_verified_at, now()),
    existing_client_verified_by = coalesce(existing_client_verified_by, v_admin_id),
    existing_client_verification_note = nullif(trim(p_verification_note), '')
  WHERE id = p_customer_id
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
      AND coalesce(c.is_active, true) = true;
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
