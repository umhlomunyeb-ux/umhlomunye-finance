revoke all on function public.submit_loan_application(text,text,text,text,text,text,text,numeric,numeric,text,text,numeric,text,date,text,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.submit_loan_application(text,text,text,text,text,text,text,numeric,numeric,text,text,numeric,text,date,text,text,text,integer,text) to service_role;
revoke all on function public.get_public_borrower_loan_policy(text) from public, anon, authenticated;
grant execute on function public.get_public_borrower_loan_policy(text) to service_role;
revoke all on function public.lookup_public_customer_blacklist_by_id_number(text) from public, anon, authenticated;
grant execute on function public.lookup_public_customer_blacklist_by_id_number(text) to authenticated, service_role;