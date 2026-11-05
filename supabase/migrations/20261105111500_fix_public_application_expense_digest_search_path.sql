-- pgcrypto is installed in the extensions schema. Include it in the
-- SECURITY DEFINER function's controlled search_path so digest(text, text)
-- resolves when saving public application expenses.
ALTER FUNCTION public.save_public_application_expenses(uuid, text, jsonb)
  SET search_path TO public, extensions;
