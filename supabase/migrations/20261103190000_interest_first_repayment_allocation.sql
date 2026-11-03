-- Allocate every borrower repayment to accrued interest before principal.
-- Scope: Umhlomunye Finance only.

ALTER TABLE public.loan_transactions
  ADD COLUMN IF NOT EXISTS interest_paid numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS principal_paid numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.loan_transactions
  DROP CONSTRAINT IF EXISTS loan_transactions_payment_allocation_nonnegative;

ALTER TABLE public.loan_transactions
  ADD CONSTRAINT loan_transactions_payment_allocation_nonnegative
  CHECK (interest_paid >= 0 AND principal_paid >= 0);

CREATE OR REPLACE FUNCTION public.record_loan_payment(
  p_loan_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_notes text DEFAULT ''
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_loan public.loans%ROWTYPE;
  v_new_balance numeric(14,2);
  v_new_total_paid numeric(14,2);
  v_new_status text;
  v_next_interest_date timestamp without time zone;
  v_next_payment_date date;
  v_due_payment_date date;
  v_transaction_id uuid;
  v_cycle_days integer;
  v_interest_cycle_enabled boolean;
  v_company_timezone text;
  v_interest_time time;
  v_interest_due numeric(14,2);
  v_interest_paid numeric(14,2);
  v_principal_paid numeric(14,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to record a loan payment.';
  END IF;
  IF p_loan_id IS NULL THEN
    RAISE EXCEPTION 'Loan ID is required.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero.';
  END IF;
  IF p_payment_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required.';
  END IF;

  SELECT * INTO v_loan
  FROM public.loans
  WHERE id = p_loan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Loan not found.';
  END IF;
  IF lower(coalesce(v_loan.loan_status, '')) IN ('completed', 'void', 'cancelled') THEN
    RAISE EXCEPTION
      'This loan is not available for repayment. Current status: %',
      v_loan.loan_status;
  END IF;
  IF p_amount > coalesce(v_loan.current_balance, 0) + 0.01 THEN
    RAISE EXCEPTION
      'Payment amount (%) cannot be greater than the current balance (%).',
      p_amount, coalesce(v_loan.current_balance, 0);
  END IF;

  SELECT
    coalesce(interest_cycle_days, 8),
    coalesce(interest_cycle_enabled, true),
    coalesce(nullif(timezone, ''), 'Africa/Johannesburg'),
    coalesce(interest_cycle_time, time '00:01:00')
  INTO
    v_cycle_days,
    v_interest_cycle_enabled,
    v_company_timezone,
    v_interest_time
  FROM public.system_settings
  ORDER BY updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Loan Settings have not been configured.';
  END IF;
  v_cycle_days := greatest(1, coalesce(v_cycle_days, 8));

  /*
   * The original contracted interest is stored in loans.interest_amount.
   * Additional accrued interest is recorded as INTEREST debits.
   * Apply all previously recorded interest allocations before allocating
   * this payment. Any remaining payment reduces principal.
   */
  SELECT greatest(
    coalesce(v_loan.interest_amount, 0)
      + coalesce((
          SELECT sum(t.debit)
          FROM public.loan_transactions t
          WHERE t.loan_id = p_loan_id
            AND upper(coalesce(t.transaction_type, '')) = 'INTEREST'
        ), 0)
      - coalesce((
          SELECT sum(t.interest_paid)
          FROM public.loan_transactions t
          WHERE t.loan_id = p_loan_id
            AND upper(coalesce(t.transaction_type, '')) = 'PAYMENT'
        ), 0),
    0
  )
  INTO v_interest_due;

  v_interest_due := least(
    round(coalesce(v_interest_due, 0), 2),
    round(greatest(coalesce(v_loan.current_balance, 0), 0), 2)
  );

  v_interest_paid := round(least(p_amount, v_interest_due), 2);
  v_principal_paid := round(greatest(p_amount - v_interest_paid, 0), 2);

  v_new_balance := round(
    greatest(coalesce(v_loan.current_balance, 0) - p_amount, 0),
    2
  );
  v_new_total_paid := round(coalesce(v_loan.total_paid, 0) + p_amount, 2);

  IF v_new_balance <= 0 THEN
    v_new_status := 'Completed';
  ELSE
    v_new_status := 'Active';
  END IF;

  v_due_payment_date := coalesce(v_loan.next_payment_date, p_payment_date);

  IF coalesce(v_loan.term_months, 0) = 2
     AND p_payment_date >= v_due_payment_date
     AND v_new_balance <= 0.01 THEN
    v_new_balance := 0;
  END IF;

  IF v_new_balance <= 0 THEN
    v_next_payment_date := NULL;
    v_next_interest_date := NULL;
  ELSIF p_payment_date >= v_due_payment_date THEN
    v_next_payment_date := (v_due_payment_date + interval '1 month')::date;
    v_next_interest_date := v_loan.next_interest_date;
  ELSE
    v_next_payment_date := v_loan.next_payment_date;
    v_next_interest_date := v_loan.next_interest_date;
  END IF;

  UPDATE public.loans
  SET
    current_balance = v_new_balance,
    total_paid = v_new_total_paid,
    loan_status = v_new_status,
    first_payment_date = coalesce(first_payment_date, p_payment_date),
    last_payment_date = p_payment_date,
    next_interest_date = v_next_interest_date,
    next_payment_date = v_next_payment_date,
    updated_at = current_timestamp
  WHERE id = p_loan_id;

  INSERT INTO public.loan_transactions (
    loan_id,
    transaction_date,
    transaction_type,
    description,
    debit,
    credit,
    balance,
    created_by,
    interest_paid,
    principal_paid
  )
  VALUES (
    p_loan_id,
    p_payment_date::timestamp,
    'Payment',
    CASE
      WHEN trim(coalesce(p_notes, '')) = '' THEN 'Loan repayment'
      ELSE p_notes
    END,
    0,
    p_amount,
    v_new_balance,
    auth.uid(),
    v_interest_paid,
    v_principal_paid
  )
  RETURNING id INTO v_transaction_id;

  RETURN json_build_object(
    'success', true,
    'loan_id', p_loan_id,
    'transaction_id', v_transaction_id,
    'payment_amount', p_amount,
    'interest_paid', v_interest_paid,
    'principal_paid', v_principal_paid,
    'outstanding_interest', round(greatest(v_interest_due - v_interest_paid, 0), 2),
    'payment_date', p_payment_date,
    'new_balance', v_new_balance,
    'total_paid', v_new_total_paid,
    'loan_status', v_new_status,
    'first_payment_date', coalesce(v_loan.first_payment_date, p_payment_date),
    'next_interest_date', v_next_interest_date,
    'next_payment_date', v_next_payment_date
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_loan_payment(uuid, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_loan_payment(uuid, numeric, date, text) TO authenticated;
