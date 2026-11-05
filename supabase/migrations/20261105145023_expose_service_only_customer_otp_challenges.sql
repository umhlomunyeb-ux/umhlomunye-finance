create table if not exists public.public_customer_otp_challenges (
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
  on public.public_customer_otp_challenges (id_fingerprint, created_at desc);
alter table public.public_customer_otp_challenges enable row level security;
revoke all on table public.public_customer_otp_challenges from public, anon, authenticated;