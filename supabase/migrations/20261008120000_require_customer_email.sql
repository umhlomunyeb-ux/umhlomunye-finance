create or replace function public.require_customer_email()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.email is null or btrim(new.email) = '' then
    raise exception 'Customer email is required.';
  end if;

  return new;
end;
$$;

drop trigger if exists customers_require_email on public.customers;

create trigger customers_require_email
before insert or update of email
on public.customers
for each row
execute function public.require_customer_email();
