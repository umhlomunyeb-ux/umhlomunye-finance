-- Align the LMS loan engine with the simplified rules:
-- minimum amount, maximum amount, one interest rate, one term (1-2 months),
-- and a configurable recurring interest cycle.
--
-- This migration intentionally reuses the existing system_settings columns.
-- Legacy tier columns remain for schema compatibility but are no longer used
-- by the approval or recurring-interest engines.

create or replace function public.approve_loan_application(
  p_application_id uuid,
  p_approved_by uuid
) returns json
language plpgsql
security definer
set search_path = public
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
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to approve a loan application.';
  end if;

  if p_approved_by is null or p_approved_by <> auth.uid() then
    raise exception 'The approving user must match the currently logged-in user.';
  end if;

  select *
  into v_application
  from public.loan_applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'Loan application not found.';
  end if;

  if upper(coalesce(v_application.status, '')) <> 'PENDING' then
    raise exception 'Loan application cannot be approved because its current status is "%".', v_application.status;
  end if;

  select
    minimum_loan_amount,
    maximum_loan_amount,
    tier_1_interest_rate,
    maximum_loan_term_months,
    interest_cycle_days,
    timezone,
    interest_cycle_enabled,
    interest_cycle_time
  into v_settings
  from public.system_settings
  order by updated_at desc
  limit 1;

  if not found then
    raise exception 'Loan Settings have not been configured.';
  end if;

  v_application_amount := v_application.amount_requested;

  if v_application_amount is null then
    raise exception 'Loan application amount is required.';
  end if;

  if v_application_amount < v_settings.minimum_loan_amount then
    raise exception 'Requested amount R% is below the minimum loan amount of R%.',
      v_application_amount, v_settings.minimum_loan_amount;
  end if;

  if v_application_amount > v_settings.maximum_loan_amount then
    raise exception 'Requested amount R% exceeds the maximum loan amount of R%.',
      v_application_amount, v_settings.maximum_loan_amount;
  end if;

  v_interest_rate := coalesce(v_settings.tier_1_interest_rate, 0);

  if v_interest_rate < 0 or v_interest_rate > 100 then
    raise exception 'Configured interest rate must be between 0 and 100 percent.';
  end if;

  v_term_months := coalesce(v_settings.maximum_loan_term_months, 0);

  if v_term_months < 1 or v_term_months > 2 then
    raise exception 'Configured loan term must be between 1 and 2 months.';
  end if;

  v_interest_amount := round(
    v_application_amount * (v_interest_rate / 100),
    2
  );

  v_total_repayment := round(
    v_application_amount + v_interest_amount,
    2
  );

  v_current_balance := v_total_repayment;

  v_monthly_repayment := round(
    v_total_repayment / v_term_months,
    2
  );

  if v_application.preferred_payment_date is not null then
    v_first_payment_date := v_application.preferred_payment_date;
  else
    v_first_payment_date := (
      v_application.application_date + interval '1 month'
    )::date;
  end if;

  v_next_payment_date := v_first_payment_date;

  if coalesce(v_settings.interest_cycle_enabled, true) then
    v_company_timezone := coalesce(
      nullif(v_settings.timezone, ''),
      'Africa/Johannesburg'
    );

    v_interest_time := coalesce(
      v_settings.interest_cycle_time,
      time '00:01:00'
    );

    v_next_interest_date := (
      (
        v_first_payment_date
        + (
          coalesce(v_settings.interest_cycle_days, 8)
          * interval '1 day'
        )
      )::date
      + v_interest_time
    ) at time zone v_company_timezone;
  else
    v_next_interest_date := null;
  end if;

  if v_application.customer_id is not null then
    select *
    into v_customer
    from public.customers
    where id = v_application.customer_id
      and coalesce(is_deleted, false) = false
    for update;

    if not found then
      raise exception 'The customer linked to this application could not be found or is deleted.';
    end if;

    v_customer_id := v_customer.id;
  else
    if nullif(trim(v_application.id_number), '') is not null then
      select *
      into v_customer
      from public.customers
      where id_number = trim(v_application.id_number)
        and coalesce(is_deleted, false) = false
      limit 1
      for update;

      if found then
        v_customer_id := v_customer.id;
      end if;
    end if;

    if v_customer_id is null then
      select coalesce(
        max(
          nullif(
            regexp_replace(customer_number, '[^0-9]', '', 'g'),
            ''
          )::integer
        ),
        0
      ) + 1
      into v_new_customer_number
      from public.customers
      where customer_number ~ '^CUS[0-9]+$';

      v_customer_number :=
        'CUS' || lpad(v_new_customer_number::text, 6, '0');

      insert into public.customers (
        customer_number,
        first_name,
        last_name,
        id_number,
        cellphone,
        employer,
        monthly_income,
        email,
        physical_address,
        is_active,
        is_deleted,
        created_by,
        created_at,
        updated_at
      )
      values (
        v_customer_number,
        v_application.first_name,
        v_application.last_name,
        nullif(trim(v_application.id_number), ''),
        nullif(trim(v_application.cellphone), ''),
        v_application.employer,
        v_application.monthly_income,
        nullif(trim(v_application.email), ''),
        v_application.physical_address,
        true,
        false,
        p_approved_by,
        now(),
        now()
      )
      returning id into v_customer_id;
    end if;
  end if;

  select *
  into v_customer
  from public.customers
  where id = v_customer_id
    and coalesce(is_deleted, false) = false
  for update;

  if not found then
    raise exception 'Customer could not be found or is deleted.';
  end if;

  if coalesce(v_customer.is_active, true) = false then
    raise exception 'The customer is inactive and cannot receive a loan.';
  end if;

  select coalesce(
    max(
      nullif(
        regexp_replace(loan_number, '[^0-9]', '', 'g'),
        ''
      )::integer
    ),
    0
  ) + 1
  into v_new_loan_number
  from public.loans
  where loan_number ~ '^LN[0-9]+$';

  v_loan_number :=
    'LN' || lpad(v_new_loan_number::text, 6, '0');

  insert into public.loans (
    loan_number,
    customer_id,
    application_id,
    principal_amount,
    interest_rate,
    interest_amount,
    total_repayment,
    current_balance,
    total_paid,
    loan_status,
    first_payment_date,
    next_payment_date,
    next_interest_date,
    last_interest_date,
    last_payment_date,
    is_deleted,
    created_by,
    created_at,
    updated_at,
    term_months,
    monthly_repayment
  )
  values (
    v_loan_number,
    v_customer_id,
    v_application.id,
    v_application_amount,
    v_interest_rate,
    v_interest_amount,
    v_total_repayment,
    v_current_balance,
    0,
    'Active',
    v_first_payment_date,
    v_next_payment_date,
    v_next_interest_date,
    null,
    null,
    false,
    p_approved_by,
    now(),
    now(),
    v_term_months,
    v_monthly_repayment
  )
  returning id into v_loan_id;

  insert into public.loan_transactions (
    loan_id,
    transaction_type,
    description,
    debit,
    credit,
    balance,
    transaction_date,
    created_at
  )
  values (
    v_loan_id,
    'LOAN',
    'Loan approved and disbursed',
    v_application_amount,
    0,
    v_current_balance,
    now(),
    now()
  );

  update public.loan_applications
  set
    status = 'APPROVED',
    customer_id = v_customer_id,
    approved_loan_id = v_loan_id,
    reviewed_by = p_approved_by,
    reviewed_at = now(),
    updated_at = now()
  where id = v_application.id;

  perform public.create_loan_agreement(v_loan_id);

  select id
  into v_agreement_id
  from public.loan_agreements
  where loan_id = v_loan_id
  limit 1;

  return json_build_object(
    'success', true,
    'message', 'Loan application approved successfully.',
    'application_id', v_application.id,
    'application_number', v_application.application_number,
    'customer_id', v_customer_id,
    'loan_id', v_loan_id,
    'loan_number', v_loan_number,
    'principal_amount', v_application_amount,
    'interest_rate', v_interest_rate,
    'interest_amount', v_interest_amount,
    'total_repayment', v_total_repayment,
    'current_balance', v_current_balance,
    'term_months', v_term_months,
    'monthly_repayment', v_monthly_repayment,
    'first_payment_date', v_first_payment_date,
    'next_payment_date', v_next_payment_date,
    'next_interest_date', v_next_interest_date,
    'agreement_id', v_agreement_id
  );
end;
$function$;

create or replace function public.apply_due_loan_interest(
  p_as_of timestamp without time zone default (
    current_timestamp at time zone 'UTC'
  )
) returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  loan_record record;
  interest_date timestamp without time zone;
  working_balance numeric;
  interest_amount numeric;
  new_balance numeric;
  interest_cycle_days integer;
  configured_interest_rate numeric;
begin
  select
    coalesce(s.interest_cycle_days, 8),
    coalesce(s.tier_1_interest_rate, 40)
  into
    interest_cycle_days,
    configured_interest_rate
  from public.system_settings s
  order by s.updated_at desc
  limit 1;

  interest_cycle_days :=
    greatest(1, coalesce(interest_cycle_days, 8));

  configured_interest_rate :=
    coalesce(configured_interest_rate, 40);

  for loan_record in
    select l.*
    from public.loans l
    where l.loan_status = 'Active'
      and l.is_deleted = false
      and l.current_balance > 0
      and l.next_interest_date is not null
      and l.next_interest_date <= p_as_of
    for update of l
  loop
    if coalesce(loan_record.interest_rate, 0) <= 0 then
      loan_record.interest_rate :=
        configured_interest_rate;
    end if;

    working_balance :=
      round(coalesce(loan_record.current_balance, 0), 2);

    interest_date :=
      loan_record.next_interest_date;

    while interest_date <= p_as_of
      and working_balance > 0
    loop
      interest_amount :=
        round(
          working_balance
          * (
            coalesce(
              loan_record.interest_rate,
              configured_interest_rate
            ) / 100
          ),
          2
        );

      new_balance :=
        round(
          working_balance + interest_amount,
          2
        );

      if interest_amount > 0 then
        insert into public.loan_transactions (
          loan_id,
          transaction_date,
          transaction_type,
          description,
          debit,
          credit,
          balance,
          created_by
        )
        values (
          loan_record.id,
          interest_date,
          'INTEREST',
          'Interest charged',
          interest_amount,
          0,
          new_balance,
          null
        );
      end if;

      working_balance :=
        new_balance;

      -- The interest cycle is genuinely every N days.
      -- It is independent of the monthly repayment date.
      interest_date :=
        interest_date
        + (
          interest_cycle_days
          * interval '1 day'
        );
    end loop;

    update public.loans l
    set
      current_balance =
        working_balance,
      next_interest_date =
        case
          when working_balance > 0
            then interest_date
          else null
        end,
      interest_rate =
        loan_record.interest_rate,
      updated_at =
        current_timestamp
    where l.id =
      loan_record.id;
  end loop;
end;
$function$;

update public.system_settings
set
  maximum_loan_term_months = 2,
  updated_at = current_timestamp
where maximum_loan_term_months is null
   or maximum_loan_term_months > 2;

alter table public.system_settings
  drop constraint if exists system_settings_maximum_loan_term_months_check;

alter table public.system_settings
  add constraint system_settings_maximum_loan_term_months_check
  check (maximum_loan_term_months between 1 and 2);
