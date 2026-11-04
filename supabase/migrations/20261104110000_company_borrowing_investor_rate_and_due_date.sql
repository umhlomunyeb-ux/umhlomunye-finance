-- Keep every company borrowing separate. Capture the lender, agreed rate and due date per record.
-- Scope: Umhlomunye Finance only.

ALTER TABLE public.company_borrowings
  ADD COLUMN IF NOT EXISTS repayment_due_date date;

DROP FUNCTION IF EXISTS public.create_company_borrowing_with_agreement(text,numeric,date,text,text,text);

CREATE OR REPLACE FUNCTION public.create_company_borrowing_with_agreement(
  p_lender_name text,
  p_amount numeric,
  p_borrowing_date date,
  p_description text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_borrowing_agreement_path text DEFAULT NULL,
  p_investor_id uuid DEFAULT NULL,
  p_interest_rate numeric DEFAULT NULL,
  p_repayment_due_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_borrowing public.company_borrowings%ROWTYPE;
  v_investor public.investors%ROWTYPE;
  v_bank_account_id uuid;
  v_balance_after numeric(15,2);
  v_first_interest_date date;
BEGIN
  IF NOT public.current_user_is_active_admin() THEN
    RAISE EXCEPTION 'Only active administrators can record company borrowings.';
  END IF;

  IF p_investor_id IS NULL THEN
    RAISE EXCEPTION 'An investor or director must be selected.';
  END IF;
  SELECT * INTO v_investor
  FROM public.investors
  WHERE id = p_investor_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select an active investor or director.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Borrowing amount must be greater than zero.';
  END IF;
  IF p_interest_rate IS NULL OR p_interest_rate < 0 THEN
    RAISE EXCEPTION 'Monthly interest rate must be zero or greater.';
  END IF;
  IF p_repayment_due_date IS NULL THEN
    RAISE EXCEPTION 'Repayment due date is required.';
  END IF;
  IF p_borrowing_date IS NOT NULL AND p_repayment_due_date < p_borrowing_date THEN
    RAISE EXCEPTION 'Repayment due date cannot be before the borrowing date.';
  END IF;
  IF coalesce(trim(p_reference), '') = '' THEN
    RAISE EXCEPTION 'Borrowing reference is required.';
  END IF;
  IF coalesce(trim(p_borrowing_agreement_path), '') = '' THEN
    RAISE EXCEPTION 'Borrowing agreement is required.';
  END IF;

  SELECT id INTO v_bank_account_id
  FROM public.bank_accounts
  WHERE is_active = true
  ORDER BY created_at ASC
  LIMIT 1;
  IF v_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'No active company bank account was found.';
  END IF;

  -- Positive-rate borrowings start their monthly interest cycle four days
  -- after the entered repayment due date. A 0% borrowing never accrues interest.
  v_first_interest_date := CASE
    WHEN p_interest_rate > 0 THEN p_repayment_due_date + 4
    ELSE NULL
  END;

  INSERT INTO public.company_borrowings (
    lender_name, original_amount, amount_repaid, outstanding_amount,
    status, borrowing_date, description, reference, borrowing_agreement_path,
    investor_id, investor_monthly_interest_rate, repayment_due_date,
    first_interest_charge_date, next_interest_charge_date,
    interest_charge_count, interest_charged_total, created_by
  )
  VALUES (
    v_investor.investor_name, p_amount, 0, p_amount,
    'Outstanding', coalesce(p_borrowing_date, current_date), p_description,
    trim(p_reference), p_borrowing_agreement_path,
    v_investor.id, p_interest_rate, p_repayment_due_date,
    v_first_interest_date, v_first_interest_date,
    0, 0, auth.uid()
  )
  RETURNING * INTO v_borrowing;

  SELECT coalesce(sum(
    CASE WHEN direction = 'IN' THEN amount ELSE -amount END
  ), 0)
  INTO v_balance_after
  FROM public.bank_transactions
  WHERE is_void = false;
  v_balance_after := v_balance_after + p_amount;

  INSERT INTO public.bank_transactions (
    bank_account_id, transaction_date, transaction_type, direction,
    amount, description, reference, is_void, balance_after, borrowing_id,
    created_by
  )
  VALUES (
    v_bank_account_id, coalesce(p_borrowing_date, current_date), 'BORROWING',
    'IN', p_amount,
    coalesce(p_description, 'Company borrowing from ' || v_investor.investor_name),
    trim(p_reference), false, v_balance_after, v_borrowing.id, auth.uid()
  );

  INSERT INTO public.audit_logs (
    user_id, entity_type, entity_id, action, description, module,
    table_name, record_id, new_data
  )
  VALUES (
    auth.uid(), 'company_borrowing', v_borrowing.id, 'Company Borrowing Recorded',
    'Company borrowing recorded from ' || v_investor.investor_name,
    'Bank', 'company_borrowings', v_borrowing.id,
    jsonb_build_object(
      'investor_id', v_investor.id,
      'amount', p_amount,
      'monthly_interest_rate', p_interest_rate,
      'repayment_due_date', p_repayment_due_date,
      'first_interest_charge_date', v_first_interest_date
    )
  );

  RETURN to_jsonb(v_borrowing);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_company_borrowing_with_agreement(
  text,numeric,date,text,text,text,uuid,numeric,date
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_company_borrowing_with_agreement(
  text,numeric,date,text,text,text,uuid,numeric,date
) TO authenticated;
