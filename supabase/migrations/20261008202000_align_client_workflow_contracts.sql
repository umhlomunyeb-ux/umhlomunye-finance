-- Align document/loan workflow contracts with the existing master-template schema.
-- This migration is intended for client databases; it does not modify the immutable source database.

create or replace function public.create_company_borrowing_with_agreement(
  p_lender_name text,
  p_amount numeric,
  p_borrowing_date date,
  p_description text default null,
  p_reference text default null,
  p_borrowing_agreement_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_borrowing public.company_borrowings%rowtype;
  v_bank_account_id uuid;
  v_balance_after numeric(15,2);
begin
  if not public.current_user_is_active_admin() then
    raise exception 'Only active administrators can record company borrowings.';
  end if;
  if coalesce(trim(p_lender_name), '') = '' then raise exception 'Lender name is required.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Borrowing amount must be greater than zero.'; end if;
  if coalesce(trim(p_reference), '') = '' then raise exception 'Borrowing reference is required.'; end if;
  if coalesce(trim(p_borrowing_agreement_path), '') = '' then raise exception 'Borrowing agreement is required.'; end if;

  select id into v_bank_account_id
  from public.bank_accounts
  where is_active = true
  order by created_at asc
  limit 1;

  if v_bank_account_id is null then raise exception 'No active company bank account was found.'; end if;

  insert into public.company_borrowings (
    lender_name, original_amount, amount_repaid, outstanding_amount,
    status, borrowing_date, description, reference, borrowing_agreement_path
  )
  values (
    trim(p_lender_name), p_amount, 0, p_amount,
    'Outstanding', p_borrowing_date, p_description, trim(p_reference),
    p_borrowing_agreement_path
  )
  returning * into v_borrowing;

  select coalesce(sum(case when direction = 'IN' then amount else -amount end), 0)
  into v_balance_after
  from public.bank_transactions
  where is_void = false;

  v_balance_after := v_balance_after + p_amount;

  insert into public.bank_transactions (
    bank_account_id, transaction_date, transaction_type, direction, amount,
    description, reference, is_void, balance_after
  )
  values (
    v_bank_account_id, p_borrowing_date, 'BORROWING', 'IN', p_amount,
    coalesce(p_description, 'Company borrowing from ' || trim(p_lender_name)),
    trim(p_reference), false, v_balance_after
  );

  return to_jsonb(v_borrowing);
end;
$function$;

create or replace function public.approve_loan_application(p_application_id uuid, p_approved_by uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_application record;
  v_customer record;
  v_settings record;
  v_loan_id uuid;
  v_customer_id uuid;
  v_loan_number text;
  v_customer_number text;
  v_agreement_id uuid;
  v_interest_rate numeric;
  v_interest_amount numeric;
  v_total_repayment numeric;
  v_current_balance numeric;
  v_first_payment_date date;
  v_next_payment_date date;
  v_next_interest_date timestamp without time zone;
  v_term_months integer;
  v_monthly_repayment numeric;
  v_company_timezone text;
  v_interest_time time;
  v_new_customer_number integer;
  v_new_loan_number integer;
  v_application_amount numeric;
  v_cycle_days integer;
begin
  if auth.uid() is null then raise exception 'Authentication is required to approve a loan application.'; end if;
  if p_approved_by is null or p_approved_by <> auth.uid() then raise exception 'The approving user must match the currently logged-in user.'; end if;

  select * into v_application from public.loan_applications where id = p_application_id for update;
  if not found then raise exception 'Loan application not found.'; end if;
  if upper(coalesce(v_application.status, '')) <> 'PENDING' then
    raise exception 'Loan application cannot be approved because its current status is "%".', v_application.status;
  end if;

  select minimum_loan_amount, maximum_loan_amount, tier_1_interest_rate,
         maximum_loan_term_months, interest_cycle_days, timezone,
         interest_cycle_enabled, interest_cycle_time
  into v_settings
  from public.system_settings
  order by updated_at desc
  limit 1;

  if not found then raise exception 'Loan Settings have not been configured.'; end if;
  v_application_amount := v_application.amount_requested;
  if v_application_amount is null then raise exception 'Loan application amount is required.'; end if;
  if v_application_amount < v_settings.minimum_loan_amount then
    raise exception 'Requested amount R% is below the minimum loan amount of R%.', v_application_amount, v_settings.minimum_loan_amount;
  end if;
  if v_application_amount > v_settings.maximum_loan_amount then
    raise exception 'Requested amount R% exceeds the maximum loan amount of R%.', v_application_amount, v_settings.maximum_loan_amount;
  end if;

  v_interest_rate := coalesce(v_settings.tier_1_interest_rate, 0);
  if v_interest_rate < 0 or v_interest_rate > 100 then raise exception 'Configured interest rate must be between 0 and 100 percent.'; end if;
  v_term_months := coalesce(v_settings.maximum_loan_term_months, 0);
  if v_term_months <> 1 then raise exception 'Configured loan term must be exactly 1 month.'; end if;

  v_cycle_days := coalesce(v_settings.interest_cycle_days, 8);
  if coalesce(v_settings.interest_cycle_enabled, true) and v_cycle_days < 1 then
    raise exception 'Configured interest cycle must be at least 1 day.';
  end if;

  v_interest_amount := round(v_application_amount * (v_interest_rate / 100), 2);
  v_total_repayment := round(v_application_amount + v_interest_amount, 2);
  v_current_balance := v_total_repayment;
  v_monthly_repayment := v_total_repayment;

  if v_application.preferred_payment_date is not null then
    v_first_payment_date := v_application.preferred_payment_date;
  else
    v_first_payment_date := (v_application.application_date + interval '1 month')::date;
  end if;
  v_next_payment_date := v_first_payment_date;

  if coalesce(v_settings.interest_cycle_enabled, true) then
    v_company_timezone := coalesce(nullif(v_settings.timezone, ''), 'Africa/Johannesburg');
    v_interest_time := coalesce(v_settings.interest_cycle_time, time '00:01:00');
    v_next_interest_date := (((v_next_payment_date + (v_cycle_days * interval '1 day'))::date + v_interest_time) at time zone v_company_timezone);
  else
    v_next_interest_date := null;
  end if;

  if v_application.customer_id is not null then
    select * into v_customer from public.customers
    where id = v_application.customer_id and coalesce(is_deleted, false) = false for update;
    if not found then raise exception 'The customer linked to this application could not be found or is deleted.'; end if;
    v_customer_id := v_customer.id;
  else
    if nullif(trim(v_application.id_number), '') is not null then
      select * into v_customer from public.customers
      where id_number = trim(v_application.id_number) and coalesce(is_deleted, false) = false
      limit 1 for update;
      if found then v_customer_id := v_customer.id; end if;
    end if;

    if v_customer_id is null then
      select coalesce(max(nullif(regexp_replace(customer_number, '[^0-9]', '', 'g'), '')::integer), 0) + 1
      into v_new_customer_number from public.customers where customer_number ~ '^CUS[0-9]+$';
      v_customer_number := 'CUS' || lpad(v_new_customer_number::text, 6, '0');

      insert into public.customers (
        customer_number, first_name, last_name, id_number, cellphone, employer,
        monthly_income, email, physical_address, is_active, is_deleted,
        created_by, created_at, updated_at
      )
      values (
        v_customer_number, v_application.first_name, v_application.last_name,
        nullif(trim(v_application.id_number), ''), nullif(trim(v_application.cellphone), ''),
        v_application.employer, v_application.monthly_income,
        nullif(trim(v_application.email), ''), v_application.physical_address,
        true, false, p_approved_by, now(), now()
      )
      returning id into v_customer_id;
    end if;
  end if;

  select * into v_customer from public.customers
  where id = v_customer_id and coalesce(is_deleted, false) = false for update;
  if not found then raise exception 'Customer could not be found or is deleted.'; end if;
  if coalesce(v_customer.is_active, true) = false then raise exception 'The customer is inactive and cannot receive a loan.'; end if;

  select coalesce(max(nullif(regexp_replace(loan_number, '[^0-9]', '', 'g'), '')::integer), 0) + 1
  into v_new_loan_number from public.loans where loan_number ~ '^LN[0-9]+$';
  v_loan_number := 'LN' || lpad(v_new_loan_number::text, 6, '0');

  insert into public.loans (
    loan_number, customer_id, application_id, principal_amount, interest_rate,
    interest_amount, total_repayment, current_balance, total_paid, loan_status,
    first_payment_date, next_payment_date, next_interest_date, last_interest_date,
    last_payment_date, is_deleted, created_by, created_at, updated_at,
    term_months, monthly_repayment, statement_verification_token
  )
  values (
    v_loan_number, v_customer_id, v_application.id, v_application_amount, v_interest_rate,
    v_interest_amount, v_total_repayment, v_current_balance, 0, 'Active',
    v_first_payment_date, v_next_payment_date, v_next_interest_date, null, null,
    false, p_approved_by, now(), now(), 1, v_monthly_repayment, gen_random_uuid()::text
  )
  returning id into v_loan_id;

  insert into public.loan_transactions (
    loan_id, transaction_type, description, debit, credit, balance, transaction_date, created_at
  )
  values (
    v_loan_id, 'LOAN', 'Loan approved and disbursed', v_application_amount, 0,
    v_current_balance, now(), now()
  );

  update public.loan_applications
  set status='APPROVED', customer_id=v_customer_id, approved_loan_id=v_loan_id,
      reviewed_by=p_approved_by, reviewed_at=now(), updated_at=now()
  where id=v_application.id;

  perform public.create_loan_agreement(v_loan_id);

  select id into v_agreement_id from public.loan_agreements where loan_id=v_loan_id limit 1;

  return json_build_object(
    'success', true, 'message', 'Loan application approved successfully.',
    'application_id', v_application.id, 'application_number', v_application.application_number,
    'customer_id', v_customer_id, 'loan_id', v_loan_id, 'loan_number', v_loan_number,
    'principal_amount', v_application_amount, 'interest_rate', v_interest_rate,
    'interest_amount', v_interest_amount, 'total_repayment', v_total_repayment,
    'current_balance', v_current_balance, 'term_months', 1,
    'monthly_repayment', v_monthly_repayment, 'first_payment_date', v_first_payment_date,
    'next_payment_date', v_next_payment_date, 'next_interest_date', v_next_interest_date,
    'agreement_id', v_agreement_id
  );
end;
$function$;

update public.loans
set statement_verification_token = gen_random_uuid()::text,
    updated_at = current_timestamp
where statement_verification_token is null;