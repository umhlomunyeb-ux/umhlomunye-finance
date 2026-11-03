-- Administrator loan editor with an auditable principal adjustment.
-- This never rewrites payment rows or historical bank transactions.

CREATE OR REPLACE FUNCTION public.admin_update_loan(
  p_loan_id uuid,
  p_principal_amount numeric,
  p_term_months integer,
  p_first_payment_date date,
  p_next_payment_date date,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loan public.loans%ROWTYPE;
  v_new_principal numeric(14,2);
  v_delta numeric(14,2);
  v_new_balance numeric(14,2);
  v_paid_principal numeric(14,2);
  v_customer_limit numeric(14,2);
  v_other_exposure numeric(14,2);
  v_monthly numeric(14,2);
  v_total numeric(14,2);
  v_tx uuid;
BEGIN
  IF NOT public.current_user_is_active_admin() THEN
    RAISE EXCEPTION 'Only an active Administrator can edit a loan.';
  END IF;
  IF p_loan_id IS NULL OR p_principal_amount IS NULL OR p_principal_amount <= 0 THEN
    RAISE EXCEPTION 'A valid loan and principal amount are required.';
  END IF;
  IF p_term_months IS NULL OR p_term_months NOT IN (1,2) THEN
    RAISE EXCEPTION 'Loan term must be 1 or 2 months.';
  END IF;
  IF p_first_payment_date IS NULL OR p_next_payment_date IS NULL THEN
    RAISE EXCEPTION 'First and next payment dates are required.';
  END IF;
  IF p_next_payment_date < p_first_payment_date THEN
    RAISE EXCEPTION 'Next payment date cannot be before the first payment date.';
  END IF;
  IF (p_principal_amount >= 5000 AND p_term_months <> 2)
     OR (p_principal_amount < 5000 AND p_term_months <> 1) THEN
    RAISE EXCEPTION 'The repayment term must follow the current loan rules: below R5,000 is 1 month; R5,000 and above is 2 months.';
  END IF;

  SELECT * INTO v_loan
  FROM public.loans
  WHERE id=p_loan_id AND coalesce(is_deleted,false)=false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loan not found.'; END IF;
  IF lower(coalesce(v_loan.loan_status,'')) NOT IN ('active','pending') THEN
    RAISE EXCEPTION 'Only active or pending loans can be edited.';
  END IF;

  SELECT coalesce(sum(principal_paid),0)
  INTO v_paid_principal
  FROM public.loan_transactions
  WHERE loan_id=p_loan_id
    AND upper(coalesce(transaction_type,'')) IN ('PAYMENT','REPAYMENT');

  v_new_principal := round(p_principal_amount,2);
  SELECT coalesce(c.credit_limit,ss.maximum_loan_amount)
    INTO v_customer_limit
  FROM public.customers c
  CROSS JOIN LATERAL (SELECT maximum_loan_amount FROM public.system_settings ORDER BY updated_at DESC LIMIT 1) ss
  WHERE c.id=v_loan.customer_id;
  IF v_customer_limit IS NULL THEN
    RAISE EXCEPTION 'The customer credit limit is not configured.';
  END IF;
  SELECT coalesce(sum(greatest(l.principal_amount-coalesce((
    SELECT sum(t.principal_paid) FROM public.loan_transactions t
    WHERE t.loan_id=l.id AND upper(coalesce(t.transaction_type,'')) IN ('PAYMENT','REPAYMENT')
  ),0)),0),0)
  INTO v_other_exposure
  FROM public.loans l
  WHERE l.customer_id=v_loan.customer_id AND l.id<>p_loan_id
    AND coalesce(l.is_deleted,false)=false
    AND lower(coalesce(l.loan_status,'')) IN ('active','pending');
  IF round(v_other_exposure + greatest(v_new_principal-v_paid_principal,0),2) > v_customer_limit THEN
    RAISE EXCEPTION 'The edited loan would exceed the customer credit limit of R%.',round(v_customer_limit,2);
  END IF;
  IF v_new_principal < v_paid_principal THEN
    RAISE EXCEPTION 'Principal cannot be lower than principal already repaid (R%).',
      round(v_paid_principal,2);
  END IF;

  v_delta := round(v_new_principal-v_loan.principal_amount,2);
  v_new_balance := round(v_loan.current_balance+v_delta,2);
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'This edit would make the loan balance negative.';
  END IF;

  -- Re-amortise the amount still outstanding after the principal adjustment,
  -- not the original principal (which may already have been partly repaid).
  IF p_term_months=2 THEN
    v_monthly := round((v_new_balance*1.40*1.40)/2.40,2);
  ELSE
    v_monthly := round(v_new_balance*1.40,2);
  END IF;
  v_total := round(coalesce(v_loan.total_paid,0)+(v_monthly*p_term_months),2);

  IF v_delta <> 0 THEN
    INSERT INTO public.loan_transactions(
      loan_id,transaction_date,transaction_type,description,debit,credit,balance,created_by
    ) VALUES (
      p_loan_id,now(),'LOAN_EDIT_ADJUSTMENT',
      'Administrator edited loan principal from R'||to_char(v_loan.principal_amount,'FM999999990.00')
        ||' to R'||to_char(v_new_principal,'FM999999990.00'),
      greatest(v_delta,0),greatest(-v_delta,0),v_new_balance,auth.uid()
    ) RETURNING id INTO v_tx;
  END IF;

  UPDATE public.loans SET
    principal_amount=v_new_principal,
    current_balance=v_new_balance,
    interest_rate=40,
    term_months=p_term_months,
    monthly_repayment=v_monthly,
    total_repayment=v_total,
    first_payment_date=p_first_payment_date,
    next_payment_date=p_next_payment_date,
    notes=nullif(trim(coalesce(p_notes,'')),''),
    updated_at=now()
  WHERE id=p_loan_id;

  INSERT INTO public.audit_logs(
    user_id,entity_type,entity_id,action,description,module,table_name,record_id,
    old_data,new_data
  ) VALUES (
    auth.uid(),'loan',p_loan_id,'Loan Edited',
    'Administrator edited loan details. Principal adjustment: R'||to_char(v_delta,'FM999999990.00'),
    'Loans','loans',p_loan_id,
    jsonb_build_object('principal_amount',v_loan.principal_amount,'term_months',v_loan.term_months,
      'first_payment_date',v_loan.first_payment_date,'next_payment_date',v_loan.next_payment_date,'notes',v_loan.notes),
    jsonb_build_object('principal_amount',v_new_principal,'term_months',p_term_months,
      'first_payment_date',p_first_payment_date,'next_payment_date',p_next_payment_date,'notes',p_notes,
      'adjustment_transaction_id',v_tx)
  );

  RETURN jsonb_build_object(
    'success',true,'loan_id',p_loan_id,'principal_amount',v_new_principal,
    'current_balance',v_new_balance,'monthly_repayment',v_monthly,
    'total_repayment',v_total,'adjustment_transaction_id',v_tx
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_loan(uuid,numeric,integer,date,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_loan(uuid,numeric,integer,date,date,text) TO authenticated;
