-- Post loan disbursements to the same verified bank account that backed the funding reservation.
CREATE OR REPLACE FUNCTION public.sync_loan_transaction_to_bank()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_bank_account_id uuid;
  v_balance_after numeric(15,2);
  v_direction text;
  v_amount numeric(15,2);
  v_transaction_type text;
  v_reference text;
  v_loan_number text;
BEGIN
  SELECT loan_number INTO v_loan_number FROM public.loans WHERE id=new.loan_id;

  IF upper(coalesce(new.transaction_type,''))='LOAN' AND coalesce(new.debit,0)>0 THEN
    v_direction:='OUT';
    v_amount:=round(new.debit,2);
    v_transaction_type:='LOAN_DISBURSEMENT';

    SELECT r.bank_account_id INTO v_bank_account_id
    FROM public.loans l
    JOIN public.loan_funding_reservations r ON r.application_id=l.application_id
    WHERE l.id=new.loan_id AND r.reservation_status='CONSUMED'
    ORDER BY r.updated_at DESC LIMIT 1;

    IF v_bank_account_id IS NULL THEN
      RAISE EXCEPTION 'Loan disbursement cannot be posted because its verified funding reservation was not consumed.';
    END IF;
  ELSIF upper(coalesce(new.transaction_type,''))='PAYMENT' AND coalesce(new.credit,0)>0 THEN
    v_direction:='IN';
    v_amount:=round(new.credit,2);
    v_transaction_type:='LOAN_REPAYMENT';
    SELECT id INTO v_bank_account_id
    FROM public.bank_accounts
    WHERE is_active=true
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE;
    IF v_bank_account_id IS NULL THEN
      RAISE EXCEPTION 'No active company bank account exists. Loan money movement cannot be posted to the bank ledger.';
    END IF;
  ELSE
    RETURN new;
  END IF;

  v_reference:=coalesce(nullif(trim(v_loan_number),''),'LOAN-'||new.loan_id::text);
  PERFORM 1 FROM public.bank_accounts WHERE id=v_bank_account_id FOR UPDATE;
  SELECT coalesce(sum(CASE WHEN direction='IN' THEN amount ELSE -amount END),0)
  INTO v_balance_after
  FROM public.bank_transactions
  WHERE bank_account_id=v_bank_account_id AND is_void=false;
  IF v_direction='OUT' THEN
    v_balance_after:=round(v_balance_after-v_amount,2);
  ELSE
    v_balance_after:=round(v_balance_after+v_amount,2);
  END IF;

  INSERT INTO public.bank_transactions(
    bank_account_id,transaction_date,transaction_type,description,amount,direction,
    balance_after,reference,created_by
  ) VALUES (
    v_bank_account_id,coalesce(new.transaction_date::date,current_date),v_transaction_type,
    coalesce(nullif(trim(new.description),''),CASE WHEN v_direction='OUT' THEN 'Loan disbursement' ELSE 'Loan repayment' END),
    v_amount,v_direction,v_balance_after,v_reference,new.created_by
  );
  RETURN new;
END;
$function$;
