alter table public.public_customer_otp_challenges alter column customer_id drop not null;
alter table public.public_customer_otp_challenges
  add column if not exists application_id uuid references public.loan_applications(id) on delete cascade;
alter table public.public_customer_otp_challenges
  drop constraint if exists public_customer_otp_challenges_identity_check;
alter table public.public_customer_otp_challenges
  add constraint public_customer_otp_challenges_identity_check
  check (customer_id is not null or application_id is not null);

create or replace function public.lookup_public_resumable_application_email(p_id_number text)
returns table(application_id uuid, email text)
language sql stable security definer
set search_path = public, private, pg_catalog
as $function$
  select a.id, a.email
  from public.loan_applications a
  join private.id_number_fingerprints f
    on f.entity_type='loan_application' and f.entity_id=a.id
   and f.fingerprint=private.id_number_fingerprint(p_id_number)
  where length(regexp_replace(coalesce(p_id_number,''),'[^0-9]','','g'))=13
    and a.status='OFFER_READY'
    and a.offer_status in ('ISSUED','ACCEPTED')
    and a.offer_expires_at>now()
    and a.approved_loan_id is null
  order by a.created_at desc
  limit 1;
$function$;
revoke all on function public.lookup_public_resumable_application_email(text) from public, anon, authenticated;
grant execute on function public.lookup_public_resumable_application_email(text) to service_role;