-- Per-customer credit limit overrides for Umhlomunye Finance.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS credit_limit numeric(14,2);

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_credit_limit_positive;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_credit_limit_positive
  CHECK (credit_limit IS NULL OR credit_limit > 0);

CREATE OR REPLACE FUNCTION public.increase_customer_credit_limit(
  p_customer_id uuid,
  p_new_credit_limit numeric
)
RETURNS public.customers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_current_limit numeric(14,2);
  v_default_limit numeric(14,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_user_is_active_admin() THEN
    RAISE EXCEPTION 'Only an active Administrator can increase a customer credit limit.';
  END IF;

  IF p_customer_id IS NULL OR p_new_credit_limit IS NULL OR p_new_credit_limit <= 0 THEN
    RAISE EXCEPTION 'A valid customer and new credit limit are required.';
  END IF;

  SELECT COALESCE(maximum_loan_amount, 6000)
    INTO v_default_limit
  FROM public.system_settings
  ORDER BY updated_at DESC
  LIMIT 1;

  v_default_limit := COALESCE(v_default_limit, 6000);

  SELECT * INTO v_customer
  FROM public.customers
  WHERE id = p_customer_id
    AND COALESCE(is_deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found.';
  END IF;

  v_current_limit := COALESCE(v_customer.credit_limit, v_default_limit);

  IF p_new_credit_limit <= v_current_limit THEN
    RAISE EXCEPTION 'The new credit limit must be greater than the current limit of R %.',
      to_char(v_current_limit, 'FM999999999990.00');
  END IF;

  UPDATE public.customers
  SET credit_limit = round(p_new_credit_limit, 2),
      updated_at = now()
  WHERE id = p_customer_id
  RETURNING * INTO v_customer;

  RETURN v_customer;
END;
$function$;

REVOKE ALL ON FUNCTION public.increase_customer_credit_limit(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increase_customer_credit_limit(uuid, numeric) TO authenticated;
