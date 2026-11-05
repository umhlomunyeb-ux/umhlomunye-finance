create schema if not exists private;

create table if not exists private.public_customer_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  id_fingerprint text not null,
  otp_hash text not null,
  verification_token_hash text,
  expires_at timestamptz not null,
  verified_at timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 5),
  send_count integer not null default 1,
  last_sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists public_customer_otp_challenges_lookup_idx
  on private.public_customer_otp_challenges (id_fingerprint, created_at desc);
alter table private.public_customer_otp_challenges enable row level security;
revoke all on table private.public_customer_otp_challenges from public, anon, authenticated;

create table if not exists public.credit_limit_increase_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  current_credit_limit numeric(12,2) not null default 0,
  requested_credit_limit numeric(12,2) not null check (requested_credit_limit > 0),
  reason text not null check (length(trim(reason)) >= 10),
  payslip_storage_path text not null,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  admin_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists credit_limit_increase_requests_customer_created_idx
  on public.credit_limit_increase_requests (customer_id, created_at desc);
alter table public.credit_limit_increase_requests enable row level security;
revoke all on table public.credit_limit_increase_requests from public, anon, authenticated;