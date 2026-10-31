-- First-time borrowers are limited to R1,500 and one month until their first loan is fully repaid.
-- Existing customer rows are grandfathered; all customer records created after this migration are subject to the rule.

alter table public.customers
  add column if not exists first_time_borrower_rule_applicable boolean not null default false;

alter table public.customers
  alter column first_time_borrower_rule_applicable set default true;

create or replace function public.protect_first_time_borrower_marker()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.first_time_borrower_rule_applicable := true;
  else
    new.first_time_borrower_rule_applicable := old.first_time_borrower_rule_applicable;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_first_time_borrower_marker on public.customers;
create trigger trg_protect_first_time_borrower_marker
before insert or update of first_time_borrower_rule_applicable
on public.customers
for each row
execute function public.protect_first_time_borrower_marker();

create or replace function public.is_first_time_borrower(
  p_customer_id uuid,
  p_id_number text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_customer_id uuid := p_customer_id;
  v_rule_applicable boolean;
  v_normalized_id text;
begin
  if v_customer_id is null and nullif(p_id_number, '') is not null then
    v_normalized_id := regexp_replace(p_id_number, '[^0-9]', '', 'g');
    select c.id, c.first_time_borrower_rule_applicable
      into v_customer_id, v_rule_applicable
    from public.customers c
    where regexp_replace(coalesce(c.id_number, ''), '[^0-9]', '', 'g') = v_normalized_id
      and coalesce(c.is_deleted, false) = false
      and coalesce(c.is_active, true) = true
    order by c.created_at desc nulls last
    limit 1;
  elsif v_customer_id is not null then
    select c.first_time_borrower_rule_applicable
      into v_rule_applicable
    from public.customers c
    where c.id = v_customer_id
      and coalesce(c.is_deleted, false) = false
      and coalesce(c.is_active, true) = true;
  end if;

  if v_customer_id is null then
    return true;
  end if;

  if coalesce(v_rule_applicable, false) = false then
    return false;
  end if;

  return not exists (
    select 1
    from public.loans l
    where l.customer_id = v_customer_id
      and coalesce(l.is_deleted, false) = false
      and lower(coalesce(l.loan_status, '')) = 'completed'
  );
end;
$$;

create or replace function public.get_public_borrower_loan_policy(p_id_number text)
returns table(is_first_time_borrower boolean, maximum_loan_amount numeric, maximum_term_months integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id_number text;
  v_first_time boolean;
begin
  v_id_number := regexp_replace(coalesce(p_id_number, ''), '[^0-9]', '', 'g');
  if length(v_id_number) <> 13 then
    raise exception 'A valid 13-digit South African ID number is required.';
  end if;

  v_first_time := public.is_first_time_borrower(null, v_id_number);
  return query select v_first_time,
    case when v_first_time then 1500::numeric else null::numeric end,
    case when v_first_time then 1 else null::integer end;
end;
$$;

create or replace function public.enforce_first_time_borrower_loan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_first_time_borrower(new.customer_id, null) then
    if coalesce(new.principal_amount, 0) > 1500 then
      raise exception 'FIRST_TIME_BORROWER_LIMIT: A first-time borrower may not receive more than R1,500.';
    end if;

    if coalesce(new.term_months, 0) <> 1 then
      raise exception 'FIRST_TIME_BORROWER_TERM: A first-time borrower must have a one-month loan term.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_first_time_borrower_loan_limit on public.loans;
create trigger trg_enforce_first_time_borrower_loan_limit
before insert or update of customer_id, principal_amount, term_months
on public.loans
for each row
execute function public.enforce_first_time_borrower_loan_limit();

revoke all on function public.protect_first_time_borrower_marker() from public, anon, authenticated;
revoke all on function public.enforce_first_time_borrower_loan_limit() from public, anon, authenticated;
revoke all on function public.is_first_time_borrower(uuid, text) from public, anon, authenticated;
grant execute on function public.is_first_time_borrower(uuid, text) to service_role;

revoke all on function public.get_public_borrower_loan_policy(text) from public;
grant execute on function public.get_public_borrower_loan_policy(text) to anon, authenticated;

do $$
declare
  v_definition text;
  v_old text := '    IF v_customer_id IS NOT NULL THEN';
  v_new text := E'    IF public.is_first_time_borrower(v_customer_id, v_id_number)\n       AND p_amount_requested > 1500 THEN\n        RAISE EXCEPTION ''FIRST_TIME_BORROWER_LIMIT: Your first loan is limited to R1,500. Please change the requested amount to R1,500 to continue.'';\n    END IF;\n\n' || v_old;
begin
  v_definition := pg_get_functiondef(
    'public.submit_loan_application(text,text,text,text,text,text,text,numeric,numeric,text,text,numeric,text,date,text,text,text)'::regprocedure
  );
  if position('FIRST_TIME_BORROWER_LIMIT:' in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then
      raise exception 'Could not locate the existing customer branch in submit_loan_application.';
    end if;
    v_definition := replace(v_definition, v_old, v_new);
    execute v_definition;
  end if;
end;
$$;
