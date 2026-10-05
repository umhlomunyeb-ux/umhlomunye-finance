/*
  MASTER TEMPLATE
  Default administrator provisioning support.

  IMPORTANT:
  - This migration does NOT create an Auth user.
  - It does NOT contain a password.
  - It does NOT contain a company name, email address, UUID, or client identity.
  - The provisioning script creates the Auth user and then creates
    the corresponding public.users profile.
*/

CREATE OR REPLACE FUNCTION public.provision_default_admin_profile(
  p_user_id uuid,
  p_email text,
  p_username text DEFAULT 'admin',
  p_full_name text DEFAULT 'Administrator'
)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.users;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID is required.';
  END IF;

  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RAISE EXCEPTION 'Email is required.';
  END IF;

  IF p_username IS NULL OR btrim(p_username) = '' THEN
    RAISE EXCEPTION 'Username is required.';
  END IF;

  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RAISE EXCEPTION 'Full name is required.';
  END IF;

  /*
    Do not create a second active administrator with the
    same username.
  */
  IF EXISTS (
    SELECT 1
    FROM public.users
    WHERE username = btrim(p_username)
      AND is_deleted = false
  ) THEN
    RAISE EXCEPTION 'Username already exists: %', btrim(p_username);
  END IF;

  /*
    Do not create a second active administrator with the
    same email.
  */
  IF EXISTS (
    SELECT 1
    FROM public.users
    WHERE lower(email) = lower(btrim(p_email))
      AND is_deleted = false
  ) THEN
    RAISE EXCEPTION 'Email address already exists: %', lower(btrim(p_email));
  END IF;

  INSERT INTO public.users (
    id,
    username,
    full_name,
    email,
    cellphone,
    role,
    is_active,
    is_deleted
  )
  VALUES (
    p_user_id,
    btrim(p_username),
    btrim(p_full_name),
    lower(btrim(p_email)),
    NULL,
    'admin',
    true,
    false
  )
  RETURNING * INTO v_user;

  RETURN v_user;
END;
$$;

/*
  This function is intended to be called only by the
  provisioning process using the service role.

  It is NOT exposed to anonymous or normal authenticated users.
*/
REVOKE ALL
ON FUNCTION public.provision_default_admin_profile(
  uuid,
  text,
  text,
  text
)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.provision_default_admin_profile(
  uuid,
  text,
  text,
  text
)
FROM anon;

REVOKE ALL
ON FUNCTION public.provision_default_admin_profile(
  uuid,
  text,
  text,
  text
)
FROM authenticated;

GRANT EXECUTE
ON FUNCTION public.provision_default_admin_profile(
  uuid,
  text,
  text,
  text
)
TO service_role;
