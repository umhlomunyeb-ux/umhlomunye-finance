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
  v_bank_transaction_id uuid;
  v_limit numeric(14,2);
  v_exposure numeric(14,2);
  v_processed integer := 0;
begin
  if auth.uid() is not null and not public.current_user_is_active_admin() then
    raise exception 'Only an active Administrator can process the top-up funding queue.';
  end if;

  -- Share the same lock as the public-application funding queue so both
  -- queues cannot allocate the same unreserved company funds concurrently.
  perform pg_advisory_xact_lock(hashtext('umhlomunye-funding-queue'));

  for v_item in
    select *
    from public.loan_top_up_requests
    where status in ('WAITING_FOR_FUNDS','READY_FOR_DISBURSEMENT')
    order by approved_at,created_at
    for update skip locked
  loop
    -- A linked bank transaction means this request has already been paid.
    -- Never create a second disbursement for the same top-up.
    if v_item.bank_transaction_id is not null then
      update public.loan_top_up_requests
      set status='FUNDED',
          funded_at=coalesce(funded_at,now()),
          updated_at=now()
      where id=v_item.id;
      continue;
    end if;

    select coalesce(c.credit_limit, ss.maximum_loan_amount)
      into v_limit
    from public.customers c
    cross join lateral (
      select maximum_loan_amount
      from public.system_settings
      order by updated_at desc
      limit 1
    ) ss
    where c.id=v_item.customer_id;

    select coalesce(sum(greatest(
      l.principal_amount - coalesce((
        select sum(t.principal_paid)
        from public.loan_transactions t
        where t.loan_id=l.id
          and upper(coalesce(t.transaction_type,'')) in ('PAYMENT','REPAYMENT')
      ),0)
    ,0)),0)
      into v_exposure
    from public.loans l
    where l.customer_id=v_item.customer_id
      and l.is_deleted=false
      and lower(coalesce(l.loan_status,'')) in ('active','pending');

    if v_limit is null or round(v_exposure,2) > round(v_limit,2) then
      update public.loan_top_up_requests
      set status='BLOCKED',updated_at=now()
      where id=v_item.id;
      continue;
    end if;

    -- Available balance excludes funds already reserved for public loan
    -- applications. The bank-account row is locked while the disbursement
    -- is posted, and this queue shares the public funding queue's lock.
    select
      ba.id,
      coalesce((
        select bt.balance_after
        from public.bank_transactions bt
        where bt.bank_account_id=ba.id
          and coalesce(bt.is_void,false)=false
        order by bt.transaction_date desc,bt.created_at desc
        limit 1
      ),ba.opening_balance) as ledger_balance,
      coalesce((
        select bt.balance_after
        from public.bank_transactions bt
        where bt.bank_account_id=ba.id
          and coalesce(bt.is_void,false)=false
        order by bt.transaction_date desc,bt.created_at desc
        limit 1
      ),ba.opening_balance)
      - coalesce((
        select sum(fr.reserved_amount)
        from public.loan_funding_reservations fr
        where fr.bank_account_id=ba.id
          and fr.reservation_status='RESERVED'
          and (fr.expires_at is null or fr.expires_at>now())
      ),0) as account_available
    into v_account
    from public.bank_accounts ba
    where ba.is_active=true and ba.is_verified=true
    order by account_available desc,ba.created_at asc
    limit 1
    for update of ba;

    if not found or v_account.account_available < v_item.requested_amount then
      update public.loan_top_up_requests
      set status='WAITING_FOR_FUNDS',updated_at=now()
      where id=v_item.id;
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
    ) returning id into v_bank_transaction_id;

    update public.loan_top_up_requests
    set status='FUNDED',
        bank_account_id=v_account.id,
        bank_transaction_id=v_bank_transaction_id,
        funded_at=now(),
        updated_at=now()
    where id=v_item.id;

    v_processed := v_processed+1;
  end loop;

  return jsonb_build_object('processed',v_processed);
end;
$$;

revoke all on function public.process_loan_top_up_funding_queue() from public;
grant execute on function public.process_loan_top_up_funding_queue() to authenticated,service_role;
