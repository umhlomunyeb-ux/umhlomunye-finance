-- Secure one-time customer information update links.
-- The public token is high entropy and only its SHA-256 digest is stored.
-- Customer update operations are isolated from loan application submission.

CREATE TABLE IF NOT EXISTS public.customer_information_update_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_information_update_links_customer
  ON public.customer_information_update_links(customer_id, created_at DESC);
ALTER TABLE public.customer_information_update_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_information_update_links FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_customer_information_update_link(p_customer_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_token text;
BEGIN
  IF NOT public.current_user_is_active_admin() THEN
    RAISE EXCEPTION 'Only an active administrator can create a customer information update link.';
  END IF;
  SELECT * INTO v_customer
  FROM public.customers
  WHERE id = p_customer_id AND is_deleted = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found.'; END IF;
  IF nullif(trim(coalesce(v_customer.cellphone,'')), '') IS NULL THEN
    RAISE EXCEPTION 'This customer has no registered cellphone number. Update the cellphone number first.';
  END IF;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.customer_information_update_links
    (customer_id, token_hash, expires_at, created_by)
  VALUES
    (v_customer.id, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '7 days', auth.uid());
  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_information_update(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_link public.customer_information_update_links%ROWTYPE;
  v_customer public.customers%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(p_token) <> 64 OR p_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'This information update link is invalid or has expired.';
  END IF;
  SELECT * INTO v_link
  FROM public.customer_information_update_links
  WHERE token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    AND used_at IS NULL AND expires_at > now()
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This information update link is invalid, expired or already used. Please contact Umhlomunye Finance for a new link.';
  END IF;
  SELECT * INTO v_customer
  FROM public.customers
  WHERE id = v_link.customer_id AND is_deleted = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer record not found. Please contact Umhlomunye Finance.'; END IF;
  RETURN jsonb_build_object(
    'customer_number', v_customer.customer_number,
    'first_name', v_customer.first_name,
    'last_name', v_customer.last_name,
    'cellphone', v_customer.cellphone,
    'alternative_phone', v_customer.alternative_phone,
    'email', v_customer.email,
    'physical_address', v_customer.physical_address,
    'postal_address', v_customer.postal_address,
    'occupation', v_customer.occupation,
    'employer', v_customer.employer,
    'monthly_income', v_customer.monthly_income
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_customer_information_update(
  p_token text,
  p_cellphone text,
  p_alternative_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_physical_address text DEFAULT NULL,
  p_postal_address text DEFAULT NULL,
  p_occupation text DEFAULT NULL,
  p_employer text DEFAULT NULL,
  p_monthly_income numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_link public.customer_information_update_links%ROWTYPE;
  v_customer public.customers%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(p_token) <> 64 OR p_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'This information update link is invalid or has expired.';
  END IF;
  IF nullif(trim(coalesce(p_cellphone,'')), '') IS NULL THEN
    RAISE EXCEPTION 'A cellphone number is required.';
  END IF;
  IF length(regexp_replace(p_cellphone, '[^0-9]', '', 'g')) < 10 THEN
    RAISE EXCEPTION 'Please enter a valid cellphone number.';
  END IF;
  IF p_monthly_income IS NOT NULL AND p_monthly_income < 0 THEN
    RAISE EXCEPTION 'Monthly income cannot be negative.';
  END IF;
  SELECT * INTO v_link
  FROM public.customer_information_update_links
  WHERE token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    AND used_at IS NULL AND expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This information update link is invalid, expired or already used. Please contact Umhlomunye Finance for a new link.';
  END IF;
  UPDATE public.customers
  SET cellphone = trim(p_cellphone),
      alternative_phone = nullif(trim(coalesce(p_alternative_phone,'')), ''),
      email = nullif(trim(coalesce(p_email,'')), ''),
      physical_address = nullif(trim(coalesce(p_physical_address,'')), ''),
      postal_address = nullif(trim(coalesce(p_postal_address,'')), ''),
      occupation = nullif(trim(coalesce(p_occupation,'')), ''),
      employer = nullif(trim(coalesce(p_employer,'')), ''),
      monthly_income = p_monthly_income,
      updated_at = now()
  WHERE id = v_link.customer_id AND is_deleted = false
  RETURNING * INTO v_customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer record not found.'; END IF;
  UPDATE public.customer_information_update_links SET used_at = now() WHERE id = v_link.id;
  INSERT INTO public.audit_logs (
    user_id, entity_type, entity_id, action, description, module,
    table_name, record_id, new_data
  )
  VALUES (
    NULL, 'customer', v_customer.id, 'Customer Information Updated',
    'Customer submitted an update through the secure customer information update link.',
    'Customers', 'customers', v_customer.id,
    jsonb_build_object(
      'customer_number', v_customer.customer_number,
      'updated_via', 'customer_information_update_link',
      'updated_at', now()
    )
  );
  RETURN jsonb_build_object(
    'success', true,
    'customer_number', v_customer.customer_number,
    'message', 'Your information has been updated successfully.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_customer_information_update_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_customer_information_update_link(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_customer_information_update(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_information_update(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_customer_information_update(text,text,text,text,text,text,text,text,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_customer_information_update(text,text,text,text,text,text,text,text,numeric) TO anon, authenticated;
