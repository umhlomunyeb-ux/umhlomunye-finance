-- Administrator-controlled bank account verification and statement reconciliation.
-- Existing accounts remain unverified until an administrator checks the actual statement.

ALTER TABLE public.bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_transaction_type_check;
ALTER TABLE public.bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_type_check;

ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY[
    'INITIAL_BALANCE','DEPOSIT','BORROWING','DEBT_REPAYMENT',
    'LOAN_DISBURSEMENT','LOAN_REPAYMENT','OTHER_INCOME','OTHER_EXPENSE',
    'VOID','BANK_RECONCILIATION'
  ]));
ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_type_check
  CHECK (transaction_type = ANY (ARRAY[
    'INITIAL_BALANCE','DEPOSIT','BORROWING','DEBT_REPAYMENT',
    'LOAN_DISBURSEMENT','LOAN_REPAYMENT','OTHER_INCOME','OTHER_EXPENSE',
    'VOID','BANK_RECONCILIATION'
  ]));

CREATE OR REPLACE FUNCTION public.verify_company_bank_account(
  p_account_id uuid,
  p_account_name text,
  p_bank_name text,
  p_account_number_last4 text,
  p_statement_balance numeric,
  p_confirmed boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_account public.bank_accounts%ROWTYPE;
  v_previous_balance numeric(14,2);
  v_adjustment numeric(14,2);
  v_transaction_date date;
  v_transaction_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_user_is_active_admin() THEN
    RAISE EXCEPTION 'Only an active Administrator can verify the company bank account.';
  END IF;
  IF p_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Confirm that the bank details and balance were checked against the actual bank statement.';
  END IF;
  IF p_account_id IS NULL OR nullif(trim(coalesce(p_account_name,'')),'') IS NULL
     OR nullif(trim(coalesce(p_bank_name,'')),'') IS NULL
     OR p_statement_balance IS NULL OR p_statement_balance < 0 THEN
    RAISE EXCEPTION 'Enter the real account name, bank name and a valid non-negative statement balance.';
  END IF;
  IF upper(trim(p_bank_name)) LIKE 'PLACEHOLDER%'
     OR upper(trim(p_account_name)) LIKE 'TEMPORARY HISTORICAL%'
     OR upper(trim(p_account_name)) LIKE 'PLACEHOLDER%' THEN
    RAISE EXCEPTION 'Replace the temporary placeholder details with the actual company bank account details before verification.';
  END IF;
  IF p_account_number_last4 IS NOT NULL AND trim(p_account_number_last4) <> ''
     AND trim(p_account_number_last4) !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'Enter only the last four digits of the bank account number.';
  END IF;

  SELECT * INTO v_account
  FROM public.bank_accounts
  WHERE id = p_account_id AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The active company bank account could not be found.';
  END IF;

  SELECT bt.balance_after, bt.transaction_date
  INTO v_previous_balance, v_transaction_date
  FROM public.bank_transactions bt
  WHERE bt.bank_account_id = p_account_id AND coalesce(bt.is_void,false) = false
  ORDER BY bt.transaction_date DESC, bt.created_at DESC
  LIMIT 1;
  v_previous_balance := coalesce(v_previous_balance, v_account.opening_balance);
  v_adjustment := round(p_statement_balance - v_previous_balance, 2);
  v_transaction_date := greatest(current_date, coalesce(v_transaction_date, current_date));

  UPDATE public.bank_accounts
  SET account_name = trim(p_account_name),
      bank_name = trim(p_bank_name),
      account_number_last4 = nullif(trim(coalesce(p_account_number_last4,'')),''),
      is_verified = true, verified_at = now(), verified_by = auth.uid(), updated_at = now()
  WHERE id = p_account_id;

  IF v_adjustment <> 0 THEN
    INSERT INTO public.bank_transactions (
      bank_account_id, transaction_date, transaction_type, description,
      amount, direction, balance_after, reference, created_by, is_void
    ) VALUES (
      p_account_id, v_transaction_date, 'BANK_RECONCILIATION',
      'Administrator reconciliation to verified bank statement balance',
      abs(v_adjustment), CASE WHEN v_adjustment > 0 THEN 'IN' ELSE 'OUT' END,
      round(p_statement_balance,2),
      'BANK-VERIFY-' || p_account_id::text || '-' || to_char(now(),'YYYYMMDDHH24MISS'),
      auth.uid(), false
    ) RETURNING id INTO v_transaction_id;
  END IF;

  INSERT INTO public.audit_logs (
    user_id, entity_type, entity_id, action, description,
    old_data, new_data, module, table_name, record_id
  ) VALUES (
    auth.uid(), 'bank_account', p_account_id, 'Company Bank Account Verified',
    'Administrator verified the company bank account against a bank statement and reconciled the ledger balance.',
    jsonb_build_object('account_name',v_account.account_name,'bank_name',v_account.bank_name,
      'account_number_last4',v_account.account_number_last4,'is_verified',v_account.is_verified,
      'ledger_balance_before',v_previous_balance),
    jsonb_build_object('account_name',trim(p_account_name),'bank_name',trim(p_bank_name),
      'account_number_last4',nullif(trim(coalesce(p_account_number_last4,'')),''),
      'is_verified',true,'verified_at',now(),'verified_by',auth.uid(),
      'statement_balance',round(p_statement_balance,2),'reconciliation_adjustment',v_adjustment,
      'reconciliation_transaction_id',v_transaction_id),
    'Bank','bank_accounts',p_account_id
  );

  RETURN jsonb_build_object('success',true,'account_id',p_account_id,'verified',true,
    'statement_balance',round(p_statement_balance,2),'reconciliation_adjustment',v_adjustment,
    'reconciliation_transaction_id',v_transaction_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.verify_company_bank_account(uuid,text,text,text,numeric,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_company_bank_account(uuid,text,text,text,numeric,boolean) TO authenticated, service_role;
