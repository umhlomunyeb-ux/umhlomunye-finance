ALTER TABLE public.loan_applications
  ADD COLUMN IF NOT EXISTS work_telephone text;

CREATE OR REPLACE FUNCTION public.save_public_application_work_telephone(
  p_application_id uuid,
  p_upload_token text,
  p_work_telephone text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_valid boolean;
  v_number text := regexp_replace(trim(COALESCE(p_work_telephone, '')), '[^0-9]', '', 'g');
BEGIN
  IF v_number !~ '^0[0-9]{9}$' THEN
    RAISE EXCEPTION 'A valid 10-digit work telephone number starting with 0 is required.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.loan_application_upload_tokens t
    JOIN public.loan_applications a ON a.id = t.application_id
    WHERE t.application_id = p_application_id
      AND t.token_hash = encode(digest(trim(p_upload_token), 'sha256'), 'hex')
      AND t.expires_at > now()
      AND t.used_at IS NULL
      AND a.status = 'PENDING'
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'The application security token is invalid or expired.';
  END IF;

  UPDATE public.loan_applications
  SET work_telephone = v_number,
      updated_at = now()
  WHERE id = p_application_id
    AND status = 'PENDING';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The pending application could not be updated.';
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.save_public_application_work_telephone(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_public_application_work_telephone(uuid, text, text) TO anon, authenticated;
