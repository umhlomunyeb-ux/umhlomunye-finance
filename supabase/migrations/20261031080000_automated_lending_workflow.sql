-- Automated lending workflow: affordability inputs, customer offers and queue processing.
-- Funding remains blocked unless a verified company bank account and live reservation exist.

ALTER TABLE public.loan_applications
  ADD COLUMN IF NOT EXISTS monthly_expenses_total numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disposable_income numeric(14,2),
  ADD COLUMN IF NOT EXISTS affordability_status text NOT NULL DEFAULT 'NOT_ASSESSED',
  ADD COLUMN IF NOT EXISTS affordability_reason text,
  ADD COLUMN IF NOT EXISTS assessed_at timestamptz,
  ADD COLUMN IF NOT EXISTS offer_status text NOT NULL DEFAULT 'NOT_ISSUED',
  ADD COLUMN IF NOT EXISTS offer_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS offer_term_months integer,
  ADD COLUMN IF NOT EXISTS offer_monthly_repayment numeric(14,2),
  ADD COLUMN IF NOT EXISTS offer_interest_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS offer_total_repayment numeric(14,2),
  ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS offer_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS offer_acceptance_ip text,
  ADD COLUMN IF NOT EXISTS funding_decision text,
  ADD COLUMN IF NOT EXISTS funding_available_at timestamptz;

ALTER TABLE public.loan_funding_bookings
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS notification_fingerprint text,
  ADD COLUMN IF NOT EXISTS queue_position integer;

CREATE INDEX IF NOT EXISTS loan_funding_bookings_queue_idx
  ON public.loan_funding_bookings(queue_status, preferred_funding_date, booked_at);

CREATE INDEX IF NOT EXISTS loan_applications_affordability_idx
  ON public.loan_applications(affordability_status, offer_status, created_at);

CREATE OR REPLACE FUNCTION public.calculate_application_affordability(
  p_application_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.loan_applications%ROWTYPE;
  v_expenses numeric(14,2);
  v_disposable numeric(14,2);
  v_rate numeric(8,4);
  v_term integer;
  v_repayment numeric(14,2);
  v_total numeric(14,2);
  v_interest numeric(14,2);
  v_first_time boolean;
BEGIN
  SELECT * INTO v_app FROM public.loan_applications
  WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found.'; END IF;

  SELECT COALESCE(SUM(monthly_amount),0) INTO v_expenses
  FROM public.loan_application_expenses WHERE application_id = p_application_id;

  v_disposable := COALESCE(v_app.monthly_income,0) + COALESCE(v_app.other_income,0) - v_expenses;
  SELECT COALESCE(tier_1_interest_rate,40) INTO v_rate FROM public.system_settings LIMIT 1;
  v_rate := COALESCE(v_rate,40);

  v_first_time := public.is_first_time_borrower(NULL, v_app.id_number);
  IF v_first_time THEN
    v_term := 1;
  ELSIF v_app.amount_requested < 5000 THEN
    v_term := 1;
  ELSE
    v_term := 2;
  END IF;

  -- Flat monthly interest; total is distributed evenly over the agreed term.
  v_interest := ROUND(COALESCE(v_app.amount_requested,0) * (v_rate/100) * v_term,2);
  v_total := ROUND(COALESCE(v_app.amount_requested,0) + v_interest,2);
  v_repayment := ROUND(v_total / NULLIF(v_term,0),2);

  UPDATE public.loan_applications SET
    monthly_expenses_total = v_expenses,
    disposable_income = v_disposable,
    affordability_status = CASE
      WHEN v_disposable <= 0 THEN 'DECLINED'
      WHEN v_repayment > v_disposable THEN 'DECLINED'
      ELSE 'AFFORDABLE' END,
    affordability_reason = CASE
      WHEN v_disposable <= 0 THEN 'Disposable income is zero or negative.'
      WHEN v_repayment > v_disposable THEN 'Required monthly repayment exceeds disposable income.'
      ELSE NULL END,
    assessed_at = now(),
    offer_amount = CASE WHEN v_disposable > 0 AND v_repayment <= v_disposable THEN v_app.amount_requested ELSE NULL END,
    offer_term_months = CASE WHEN v_disposable > 0 AND v_repayment <= v_disposable THEN v_term ELSE NULL END,
    offer_monthly_repayment = CASE WHEN v_disposable > 0 AND v_repayment <= v_disposable THEN v_repayment ELSE NULL END,
    offer_interest_amount = CASE WHEN v_disposable > 0 AND v_repayment <= v_disposable THEN v_interest ELSE NULL END,
    offer_total_repayment = CASE WHEN v_disposable > 0 AND v_repayment <= v_disposable THEN v_total ELSE NULL END
  WHERE id = p_application_id;

  RETURN jsonb_build_object(
    'application_id',p_application_id,'monthly_expenses',v_expenses,
    'disposable_income',v_disposable,'monthly_repayment',v_repayment,
    'term_months',v_term,'total_repayment',v_total,
    'status',CASE WHEN v_disposable > 0 AND v_repayment <= v_disposable THEN 'AFFORDABLE' ELSE 'DECLINED' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_application_affordability(uuid) FROM PUBLIC, anon, authenticated;
