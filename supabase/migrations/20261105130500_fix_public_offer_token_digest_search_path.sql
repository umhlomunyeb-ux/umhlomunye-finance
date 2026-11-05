ALTER FUNCTION public.get_public_application_offer(uuid,text) SET search_path TO public,extensions;
ALTER FUNCTION public.accept_public_loan_offer(uuid,text,boolean,text) SET search_path TO public,extensions;
ALTER FUNCTION public.create_public_funding_booking(uuid,text,text,date) SET search_path TO public,extensions;
ALTER FUNCTION public.cancel_public_funding_booking(uuid,text) SET search_path TO public,extensions;
