revoke all on function public.lookup_public_customer_by_id_number(text) from public, anon, authenticated;
revoke all on function public.get_public_top_up_eligibility(text) from public, anon, authenticated;
revoke all on function public.resume_public_loan_application_by_id_number(text) from public, anon, authenticated;
revoke all on function public.submit_public_loan_top_up(text,numeric) from public, anon, authenticated;
grant execute on function public.lookup_public_customer_by_id_number(text) to service_role;
grant execute on function public.get_public_top_up_eligibility(text) to service_role;
grant execute on function public.resume_public_loan_application_by_id_number(text) to service_role;
grant execute on function public.submit_public_loan_top_up(text,numeric) to service_role;