-- Automated lending foundation: fail-closed funding controls.
-- No account is considered fundable until an administrator explicitly verifies it.
alter table public.bank_accounts
  add column if not exists is_verified boolean not null default false,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid;

update public.bank_accounts
set is_verified = false, verified_at = null, verified_by = null
where bank_name ilike '%placeholder%'
   or account_name ilike '%temporary%'
   or account_number_last4 = '0000';

create table if not exists public.loan_application_expenses (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.loan_applications(id) on delete cascade,
  expense_category text not null,
  description text,
  monthly_amount numeric(14,2) not null check (monthly_amount >= 0),
  created_at timestamptz not null default now(),
  created_by uuid
);
create index if not exists loan_application_expenses_application_idx
  on public.loan_application_expenses(application_id);

create table if not exists public.loan_funding_bookings (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.loan_applications(id) on delete cascade,
  requested_amount numeric(14,2) not null check (requested_amount > 0),
  preferred_funding_date date,
  queue_status text not null default 'WAITING_FOR_FUNDS'
    check (queue_status in ('WAITING_FOR_FUNDS','READY_FOR_OFFER','CANCELLED','FUNDED')),
  booked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists loan_funding_bookings_queue_idx
  on public.loan_funding_bookings(queue_status, preferred_funding_date, booked_at);

create table if not exists public.loan_funding_reservations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.loan_applications(id) on delete cascade,
  bank_account_id uuid not null references public.bank_accounts(id),
  reserved_amount numeric(14,2) not null check (reserved_amount > 0),
  reservation_status text not null default 'RESERVED'
    check (reservation_status in ('RESERVED','RELEASED','CONSUMED','EXPIRED')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists loan_funding_reservations_active_idx
  on public.loan_funding_reservations(bank_account_id, reservation_status);

alter table public.loan_application_expenses enable row level security;
alter table public.loan_funding_bookings enable row level security;
alter table public.loan_funding_reservations enable row level security;

-- These internal workflow tables are not directly accessible through the client API.
revoke all on public.loan_application_expenses from anon, authenticated;
revoke all on public.loan_funding_bookings from anon, authenticated;
revoke all on public.loan_funding_reservations from anon, authenticated;

create or replace function public.guard_loan_funding_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.loan_funding_reservations%rowtype;
begin
  if new.application_id is null then
    raise exception 'A funding reservation is required before a loan can be created.';
  end if;

  select r.*
    into v_reservation
  from public.loan_funding_reservations r
  join public.bank_accounts b on b.id = r.bank_account_id
  where r.application_id = new.application_id
    and r.reservation_status = 'RESERVED'
    and r.reserved_amount >= new.principal_amount
    and (r.expires_at is null or r.expires_at > now())
    and b.is_active = true
    and b.is_verified = true
  for update of r;

  if not found then
    raise exception 'Funding is locked: a valid reservation backed by a verified active company bank account is required.';
  end if;

  return new;
end;
$$;

drop trigger if exists loans_require_verified_funding_reservation on public.loans;
create trigger loans_require_verified_funding_reservation
before insert on public.loans
for each row execute function public.guard_loan_funding_reservation();

create or replace function public.consume_loan_funding_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.loan_funding_reservations
  set reservation_status = 'CONSUMED', updated_at = now()
  where application_id = new.application_id
    and reservation_status = 'RESERVED';
  return new;
end;
$$;

drop trigger if exists loans_consume_funding_reservation on public.loans;
create trigger loans_consume_funding_reservation
after insert on public.loans
for each row execute function public.consume_loan_funding_reservation();
