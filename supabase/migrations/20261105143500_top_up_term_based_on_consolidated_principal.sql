create or replace function public.approve_loan_top_up(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
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
  if not public.current_user_is_active_admin() then
    raise exception 'Only an active Administrator can approve a top-up.';
  end if;

  select * into v_request
  from public.loan_top_up_requests
  where id=p_request_id
  for update;
  if not found then raise exception 'Top-up request not found.'; end if;
  if v_request.status <> 'PENDING_APPROVAL' then
    raise exception 'This top-up request is no longer awaiting approval.';
  end if;

  select * into v_loan
  from public.loans
  where id=v_request.loan_id and is_deleted=false
  for update;
  if not found or lower(coalesce(v_loan.loan_status,'')) <> 'active' then
    raise exception 'The linked loan is no longer active.';
  end if;

  select * into v_customer
  from public.customers
  where id=v_loan.customer_id
  for update;
  if not found or coalesce(v_customer.is_blacklisted,false) or coalesce(v_customer.is_deleted,false) then
    raise exception 'This customer cannot receive a top-up.';
  end if;

  select coalesce(v_customer.credit_limit, ss.maximum_loan_amount)
  into v_limit
  from public.system_settings ss
  order by ss.updated_at desc
  limit 1;
  if v_limit is null then
    raise exception 'The customer credit limit is not configured.';
  end if;

  select coalesce(sum(greatest(
    l.principal_amount - coalesce((
      select sum(t.principal_paid)
      from public.loan_transactions t
      where t.loan_id=l.id
        and upper(coalesce(t.transaction_type,'')) in ('PAYMENT','REPAYMENT')
    ),0),0)),0)
  into v_outstanding
  from public.loans l
  where l.customer_id=v_loan.customer_id
    and l.is_deleted=false
    and lower(coalesce(l.loan_status,'')) in ('active','pending');

  if round(v_outstanding + v_request.requested_amount,2) > v_limit then
    raise exception 'Top-up exceeds the customer credit limit. Outstanding principal: R%, limit: R%.',
      round(v_outstanding,2), round(v_limit,2);
  end if;

  v_new_principal := round(v_loan.principal_amount + v_request.requested_amount,2);
  v_new_balance := round(v_loan.current_balance + v_request.requested_amount,2);

  -- Consolidated principal of R5,000 or more uses the required two-month
  -- repayment term; below R5,000 uses one month. Top-up changes the schedule
  -- but does not erase existing payment history or move the original due date.
  v_remaining_months := case when v_new_principal >= 5000 then 2 else 1 end;

  if v_remaining_months = 2 then
    v_monthly := round((v_new_balance * 1.40 * 1.40) / 2.40,2);
  else
    v_monthly := round(v_new_balance * 1.40,2);
  end if;

  v_total := round(coalesce(v_loan.total_paid,0) + (v_monthly * v_remaining_months),2);

  insert into public.loan_transactions(
    loan_id,transaction_date,transaction_type,description,debit,credit,balance,created_by
  ) values (
    v_loan.id,now(),'TOP_UP','Administrator-approved loan top-up',
    v_request.requested_amount,0,v_new_balance,auth.uid()
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
    status=case when v_available >= v_request.requested_amount
      then 'READY_FOR_DISBURSEMENT' else 'WAITING_FOR_FUNDS' end,
    approved_by=auth.uid(),
    approved_at=now(),
    ledger_transaction_id=v_tx,
    updated_at=now()
  where id=p_request_id;

  return jsonb_build_object(
    'success',true,
    'request_id',p_request_id,
    'loan_id',v_loan.id,
    'ledger_balance',v_new_balance,
    'principal_amount',v_new_principal,
    'remaining_term_months',v_remaining_months,
    'monthly_repayment',v_monthly,
    'funding_status',case when v_available >= v_request.requested_amount
      then 'READY_FOR_DISBURSEMENT' else 'WAITING_FOR_FUNDS' end
  );
end;
$function$;

revoke all on function public.approve_loan_top_up(uuid) from public;
grant execute on function public.approve_loan_top_up(uuid) to authenticated,service_role;
