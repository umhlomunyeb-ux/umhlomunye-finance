-- Allow administrators to generate customer information update links
-- even when legacy customer records have no cellphone or email on file.
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
  SELECT * INTO v_customer FROM public.customers
  WHERE id = p_customer_id AND is_deleted = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found.'; END IF;
  -- No registered cellphone or email is required; the administrator shares the one-time link.
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.customer_information_update_links
    (customer_id, token_hash, expires_at, created_by)
  VALUES
    (v_customer.id, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '7 days', auth.uid());
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.create_customer_information_update_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_customer_information_update_link(uuid) TO authenticated;
