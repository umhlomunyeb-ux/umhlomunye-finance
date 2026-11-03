create table if not exists public.loan_top_up_requests (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id),
  customer_id uuid not null references public.customers(id),
  requested_amount numeric(14,2) not null check (requested_amount > 0),
  status text not null default 'PENDING_APPROVAL'
    check (status in ('PENDING_APPROVAL','WAITING_FOR_FUNDS','READY_FOR_DISBURSEMENT','FUNDED','REJECTED','BLOCKED')),
  requested_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  rejected_by uuid references auth.users(id),
  rejected_at timestamptz,
  rejection_reason text,
  bank_account_id uuid references public.bank_accounts(id),
  bank_transaction_id uuid references public.bank_transactions(id),
  ledger_transaction_id uuid references public.loan_transactions(id),
  funded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_loan_top_up_requests_status_created
  on public.loan_top_up_requests(status, created_at);

alter table public.loan_top_up_requests enable row level security;
grant select on public.loan_top_up_requests to authenticated;

drop policy if exists "Admins can view loan top up requests" on public.loan_top_up_requests;
create policy "Admins can view loan top up requests"
  on public.loan_top_up_requests for select to authenticated
  using (public.current_user_is_active_admin());

create or replace function public.request_loan_top_up(p_loan_id uuid, p_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan public.loans%rowtype;
  v_request_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  if p_loan_id is null or p_amount is null or p_amount <= 0 then
    raise exception 'A valid loan and top-up amount are required.';
  end if;
  select * into v_loan from public.loans where id=p_loan_id and is_deleted=false for update;
  if not found then raise exception 'Loan not found.'; end if;
  if lower(coalesce(v_loan.loan_status,'')) <> 'active' then
    raise exception 'Only active loans can be topped up.';
  end if;
  if exists (
    select 1 from public.loan_top_up_requests
    where loan_id=p_loan_id and status in ('PENDING_APPROVAL','WAITING_FOR_FUNDS','READY_FOR_DISBURSEMENT')
  ) then raise exception 'This loan already has a top-up awaiting completion.'; end if;

  insert into public.loan_top_up_requests(loan_id,customer_id,requested_amount,requested_by)
  values (p_loan_id,v_loan.customer_id,round(p_amount,2),auth.uid())
  returning id into v_request_id;
  return v_request_id;
end;
$$;

create or replace function public.approve_loan_top_up(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.loan_top_up_requests%rowtype;
  v_loan public.loans%rowtype;
  v_customer public.customers%rowtype;
  v_limit numeric(14,2);
  v_outstanding numeric(14,2);
  v_available numeric(14,2);
  v_remaining_months integer;
  v_new_principal numeric(14,2);
  v_new_balance numeric(14,2);
  v_monthly numeric(14,2);
  v_total numeric(14,2);
  v_funds jsonb;
  v_tx uuid;
begin
  if not public.current_user_is_active_admin() then raise exception 'Only an active Administrator can approve a top-up.'; end if;
  select * into v_request from public.loan_top_up_requests where id=p_request_id for update;
  if not found then raise exception 'Top-up request not found.'; end if;
  if v_request.status <> 'PENDING_APPROVAL' then raise exception 'This top-up request is no longer awaiting approval.'; end if;

  select * into v_loan from public.loans where id=v_request.loan_id and is_deleted=false for update;
  if not found or lower(coalesce(v_loan.loan_status,'')) <> 'active' then
    raise exception 'The linked loan is no longer active.';
  end if;
  select * into v_customer from public.customers where id=v_loan.customer_id for update;
  if not found or coalesce(v_customer.is_blacklisted,false) or coalesce(v_customer.is_deleted,false) then
    raise exception 'This customer cannot receive a top-up.';
  end if;

  select coalesce(v_customer.credit_limit, ss.maximum_loan_amount)
    into v_limit
  from public.system_settings ss
  order by ss.updated_at desc limit 1;
  if v_limit is null then raise exception 'The customer credit limit is not configured.'; end if;

  select coalesce(sum(greatest(l.principal_amount -
      coalesce((select sum(t.principal_paid) from public.loan_transactions t
        where t.loan_id=l.id and upper(coalesce(t.transaction_type,'')) in ('PAYMENT','REPAYMENT')),0),0)),0)
    into v_outstanding
  from public.loans l
  where l.customer_id=v_loan.customer_id and l.is_deleted=false
    and lower(coalesce(l.loan_status,'')) in ('active','pending');

  if round(v_outstanding + v_request.requested_amount,2) > v_limit then
    raise exception 'Top-up exceeds the customer credit limit. Outstanding principal: R%, limit: R%.',
      round(v_outstanding,2), round(v_limit,2);
  end if;

  v_new_principal := round(v_loan.principal_amount + v_request.requested_amount,2);
  v_new_balance := round(v_loan.current_balance + v_request.requested_amount,2);
  v_remaining_months := greatest(1, coalesce(v_loan.term_months,1) -
    greatest(0, (extract(year from age(current_date, coalesce(v_loan.first_payment_date,current_date)))::int * 12)
      + extract(month from age(current_date, coalesce(v_loan.first_payment_date,current_date)))::int));
  if v_remaining_months > 2 then v_remaining_months := 2; end if;

  -- Keep the existing ledger balance and payment history intact. The new
  -- principal is posted once; the revised instalment estimate uses the
  -- 40% monthly rate and remaining term.
  if v_remaining_months = 2 then
    v_monthly := round((v_new_balance * 1.40) / 2.40,2);
  else
    v_monthly := round(v_new_balance * 1.40,2);
  end if;
  v_total := round(v_monthly * v_remaining_months,2);

  insert into public.loan_transactions(
    loan_id,transaction_date,transaction_type,description,debit,credit,balance,created_by
  ) values (
    v_loan.id,now(),'TOP_UP','Administrator-approved loan top-up',v_request.requested_amount,0,
    v_new_balance,auth.uid()
  ) returning id into v_tx;

  update public.loans set
    principal_amount=v_new_principal,
    current_balance=v_new_balance,
    interest_rate=40,
    term_months=v_remaining_months,
    monthly_repayment=v_monthly,
    total_repayment=v_total,
    updated_at=now()
  where id=v_loan.id;

  v_funds := public.get_company_funding_position();
  v_available := coalesce((v_funds->>'available_funds')::numeric,0);

  update public.loan_top_up_requests set
    status=case when v_available >= v_request.requested_amount then 'READY_FOR_DISBURSEMENT' else 'WAITING_FOR_FUNDS' end,
    approved_by=auth.uid(), approved_at=now(), ledger_transaction_id=v_tx, updated_at=now()
  where id=p_request_id;

  return jsonb_build_object(
    'success',true,'request_id',p_request_id,'loan_id',v_loan.id,
    'ledger_balance',v_new_balance,'principal_amount',v_new_principal,
    'remaining_term_months',v_remaining_months,'monthly_repayment',v_monthly,
    'funding_status',case when v_available >= v_request.requested_amount then 'READY_FOR_DISBURSEMENT' else 'WAITING_FOR_FUNDS' end
  );
end;
$$;

create or replace function public.reject_loan_top_up(p_request_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_active_admin() then raise exception 'Only an active Administrator can reject a top-up.'; end if;
  update public.loan_top_up_requests set status='REJECTED',rejected_by=auth.uid(),
    rejected_at=now(),rejection_reason=nullif(trim(coalesce(p_reason,'')),''),updated_at=now()
  where id=p_request_id and status='PENDING_APPROVAL';
  if not found then raise exception 'Top-up request not found or no longer awaiting approval.'; end if;
end;
$$;

create or replace function public.process_loan_top_up_funding_queue()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_account record;
  v_balance numeric(15,2);
  v_limit numeric(14,2);
  v_exposure numeric(14,2);
  v_processed integer := 0;
begin
  if auth.uid() is not null and not public.current_user_is_active_admin() then
    raise exception 'Only an active Administrator can process the top-up funding queue.';
  end if;
  perform pg_advisory_xact_lock(hashtext('loan-top-up-funding-queue'));
  for v_item in
    select * from public.loan_top_up_requests
    where status in ('WAITING_FOR_FUNDS','READY_FOR_DISBURSEMENT')
    order by approved_at,created_at
    for update skip locked
  loop
    select coalesce(c.credit_limit, ss.maximum_loan_amount)
      into v_limit
    from public.customers c
    cross join lateral (select maximum_loan_amount from public.system_settings order by updated_at desc limit 1) ss
    where c.id=v_item.customer_id;
    select coalesce(sum(greatest(l.principal_amount - coalesce((
      select sum(t.principal_paid) from public.loan_transactions t
      where t.loan_id=l.id and upper(coalesce(t.transaction_type,'')) in ('PAYMENT','REPAYMENT')
    ),0),0)),0)
      into v_exposure
    from public.loans l
    where l.customer_id=v_item.customer_id and l.is_deleted=false
      and lower(coalesce(l.loan_status,'')) in ('active','pending');
    if v_limit is null or round(v_exposure,2) > round(v_limit,2) then
      update public.loan_top_up_requests set status='BLOCKED',updated_at=now() where id=v_item.id;
      continue;
    end if;

    select ba.id,
      coalesce((select bt.balance_after from public.bank_transactions bt
        where bt.bank_account_id=ba.id and coalesce(bt.is_void,false)=false
        order by bt.transaction_date desc,bt.created_at desc limit 1),ba.opening_balance) as ledger_balance
    into v_account
    from public.bank_accounts ba
    where ba.is_active=true and ba.is_verified=true
      and coalesce((select bt.balance_after from public.bank_transactions bt
        where bt.bank_account_id=ba.id and coalesce(bt.is_void,false)=false
        order by bt.transaction_date desc,bt.created_at desc limit 1),ba.opening_balance) >= v_item.requested_amount
    order by ba.created_at asc limit 1
    for update;
    if not found then
      update public.loan_top_up_requests set status='WAITING_FOR_FUNDS',updated_at=now() where id=v_item.id;
      continue;
    end if;

    v_balance := round(v_account.ledger_balance-v_item.requested_amount,2);

    insert into public.bank_transactions(
      bank_account_id,transaction_date,transaction_type,description,amount,direction,
      balance_after,reference,created_by
    ) values (
      v_account.id,current_date,'LOAN_TOP_UP_DISBURSEMENT',
      'Approved top-up disbursement for loan '||v_item.loan_id::text,
      v_item.requested_amount,'OUT',v_balance,
      'TOPUP-'||v_item.id::text,coalesce(v_item.approved_by,auth.uid())
    ) returning id into v_item.bank_transaction_id;

    update public.loan_top_up_requests set
      status='FUNDED',bank_account_id=v_account.id,bank_transaction_id=v_item.bank_transaction_id,
      funded_at=now(),updated_at=now()
    where id=v_item.id;
    v_processed := v_processed+1;
  end loop;
  return jsonb_build_object('processed',v_processed);
end;
$;

create or replace function public.run_automated_funding_cycle()
returns jsonb
language plpgsql
security definer
set search_path = public
as $
declare
  v_expired integer;
  v_result jsonb;
  v_topups jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('umhlomunye-funding-cycle'));
  v_expired := public.expire_public_loan_offers();
  v_result := public.process_funding_queue();
  v_topups := public.process_loan_top_up_funding_queue();
  return jsonb_build_object('expired_offers_requeued',v_expired,'funding_result',v_result,'top_up_result',v_topups);
end;
$;

revoke all on function public.request_loan_top_up(uuid,numeric) from public;
revoke all on function public.approve_loan_top_up(uuid) from public;
revoke all on function public.reject_loan_top_up(uuid,text) from public;
revoke all on function public.process_loan_top_up_funding_queue() from public;
grant execute on function public.request_loan_top_up(uuid,numeric) to authenticated;
grant execute on function public.approve_loan_top_up(uuid) to authenticated;
grant execute on function public.reject_loan_top_up(uuid,text) to authenticated;
grant execute on function public.process_loan_top_up_funding_queue() to authenticated, service_role;
