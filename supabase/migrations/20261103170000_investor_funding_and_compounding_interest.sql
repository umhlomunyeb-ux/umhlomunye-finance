-- Investor funding workflow and monthly compounding liability ledger.
-- Scope: Umhlomunye Finance only.

CREATE TABLE IF NOT EXISTS public.investors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_name text NOT NULL CHECK (length(trim(investor_name)) > 0),
  email text,
  cellphone text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_borrowings
  ADD COLUMN IF NOT EXISTS investor_id uuid REFERENCES public.investors(id),
  ADD COLUMN IF NOT EXISTS loan_application_id uuid REFERENCES public.loan_applications(id),
  ADD COLUMN IF NOT EXISTS investor_monthly_interest_rate numeric(8,4),
  ADD COLUMN IF NOT EXISTS first_interest_charge_date date,
  ADD COLUMN IF NOT EXISTS next_interest_charge_date date,
  ADD COLUMN IF NOT EXISTS interest_charge_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS interest_charged_total numeric(14,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS company_borrowings_investor_idx
  ON public.company_borrowings(investor_id, status)
  WHERE investor_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.investor_funding_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES public.loan_applications(id) ON DELETE CASCADE,
  application_number text NOT NULL,
  customer_name text NOT NULL,
  loan_amount numeric(14,2) NOT NULL CHECK (loan_amount > 0),
  term_months integer NOT NULL CHECK (term_months IN (1,2)),
  available_bank_balance numeric(14,2) NOT NULL DEFAULT 0,
  funding_shortfall numeric(14,2) NOT NULL CHECK (funding_shortfall > 0),
  interest_rate_monthly numeric(8,4) NOT NULL DEFAULT 25 CHECK (interest_rate_monthly > 0),
  estimated_interest numeric(14,2) NOT NULL DEFAULT 0,
  estimated_total_liability numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED','FUNDED','CANCELLED')),
  investor_id uuid REFERENCES public.investors(id),
  borrowing_id uuid REFERENCES public.company_borrowings(id),
  received_amount numeric(14,2),
  received_at timestamptz,
  bank_reference text,
  alert_status text NOT NULL DEFAULT 'PENDING'
    CHECK (alert_status IN ('PENDING','SENDING','SENT','FAILED')),
  alert_last_attempt_at timestamptz,
  alert_sent_at timestamptz,
  alert_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS investor_funding_requests_status_idx
  ON public.investor_funding_requests(status, created_at);

CREATE TABLE IF NOT EXISTS public.investor_interest_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrowing_id uuid NOT NULL REFERENCES public.company_borrowings(id) ON DELETE RESTRICT,
  charge_number integer NOT NULL CHECK (charge_number > 0),
  charge_date date NOT NULL,
  interest_rate numeric(8,4) NOT NULL,
  balance_before numeric(14,2) NOT NULL,
  interest_amount numeric(14,2) NOT NULL CHECK (interest_amount > 0),
  balance_after numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (borrowing_id, charge_number)
);

CREATE TABLE IF NOT EXISTS public.investor_repayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrowing_id uuid NOT NULL REFERENCES public.company_borrowings(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  repayment_date date NOT NULL,
  reference text NOT NULL,
  description text,
  bank_transaction_id uuid REFERENCES public.bank_transactions(id),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.investors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_funding_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_interest_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_repayments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Administrators can manage investors" ON public.investors;
CREATE POLICY "Administrators can manage investors"
  ON public.investors FOR ALL TO authenticated
  USING (public.current_user_is_active_admin())
  WITH CHECK (public.current_user_is_active_admin());

DROP POLICY IF EXISTS "Administrators can view investor funding requests" ON public.investor_funding_requests;
CREATE POLICY "Administrators can view investor funding requests"
  ON public.investor_funding_requests FOR SELECT TO authenticated
  USING (public.current_user_is_active_admin());

DROP POLICY IF EXISTS "Administrators can view investor interest charges" ON public.investor_interest_charges;
CREATE POLICY "Administrators can view investor interest charges"
  ON public.investor_interest_charges FOR SELECT TO authenticated
  USING (public.current_user_is_active_admin());

DROP POLICY IF EXISTS "Administrators can view investor repayments" ON public.investor_repayments;
CREATE POLICY "Administrators can view investor repayments"
  ON public.investor_repayments FOR SELECT TO authenticated
  USING (public.current_user_is_active_admin());

REVOKE ALL ON public.investors, public.investor_funding_requests,
  public.investor_interest_charges, public.investor_repayments
  FROM anon, authenticated;
GRANT SELECT ON public.investors, public.investor_funding_requests,
  public.investor_interest_charges, public.investor_repayments
  TO authenticated;

CREATE OR REPLACE FUNCTION public.create_investor(
  p_investor_name text,
  p_email text DEFAULT NULL,
  p_cellphone text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.current_user_is_active_admin() THEN
    RAISE EXCEPTION 'Only active administrators can create investor records.';
  END IF;
  IF coalesce(trim(p_investor_name), '') = '' THEN
    RAISE EXCEPTION 'Investor name is required.';
  END IF;

  INSERT INTO public.investors(investor_name,email,cellphone,notes,created_by)
  VALUES (trim(p_investor_name),nullif(trim(p_email),''),nullif(trim(p_cellphone),''),nullif(trim(p_notes),''),auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs(user_id,entity_type,entity_id,action,description,module,table_name,record_id,new_data)
  VALUES (auth.uid(),'investor',v_id,'Investor Created','Investor ' || trim(p_investor_name) || ' was created.','Investors','investors',v_id,
    jsonb_build_object('investor_name',trim(p_investor_name),'email',p_email,'cellphone',p_cellphone));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_investor_funding_shortfall()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_position jsonb;
  v_available numeric(14,2);
  v_shortfall numeric(14,2);
  v_app public.loan_applications%ROWTYPE;
  v_term integer;
  v_rate numeric(8,4) := 25;
  v_estimated_total numeric(14,2);
BEGIN
  IF NEW.queue_status = 'WAITING_FOR_FUNDS' THEN
    SELECT * INTO v_app FROM public.loan_applications WHERE id = NEW.application_id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    v_position := public.get_company_funding_position();
    v_available := greatest(coalesce((v_position->>'available_funds')::numeric,0),0);
    v_shortfall := round(greatest(NEW.requested_amount - v_available,0),2);

    IF v_shortfall > 0 THEN
      v_term := coalesce(v_app.offer_term_months,v_app.selected_term_months,1);
      v_estimated_total := round(v_shortfall * power(1 + v_rate / 100, v_term),2);

      INSERT INTO public.investor_funding_requests(
        application_id,application_number,customer_name,loan_amount,term_months,
        available_bank_balance,funding_shortfall,interest_rate_monthly,
        estimated_interest,estimated_total_liability,status
      )
      VALUES (
        v_app.id,v_app.application_number,trim(v_app.first_name || ' ' || v_app.last_name),
        NEW.requested_amount,v_term,v_available,v_shortfall,v_rate,
        round(v_estimated_total-v_shortfall,2),v_estimated_total,'REQUESTED'
      )
      ON CONFLICT (application_id) DO UPDATE SET
        application_number=EXCLUDED.application_number,
        customer_name=EXCLUDED.customer_name,
        loan_amount=EXCLUDED.loan_amount,
        term_months=EXCLUDED.term_months,
        available_bank_balance=EXCLUDED.available_bank_balance,
        funding_shortfall=EXCLUDED.funding_shortfall,
        estimated_interest=EXCLUDED.estimated_interest,
        estimated_total_liability=EXCLUDED.estimated_total_liability,
        status=CASE WHEN public.investor_funding_requests.status='FUNDED'
          THEN 'FUNDED' ELSE 'REQUESTED' END,
        alert_status=CASE WHEN public.investor_funding_requests.status='FUNDED'
          THEN public.investor_funding_requests.alert_status ELSE 'PENDING' END,
        alert_error=NULL,
        updated_at=now()
      WHERE public.investor_funding_requests.status <> 'FUNDED';
    END IF;
  ELSIF NEW.queue_status IN ('READY_FOR_OFFER','FUNDED','CANCELLED') THEN
    UPDATE public.investor_funding_requests
    SET status='CANCELLED',updated_at=now()
    WHERE application_id=NEW.application_id AND status='REQUESTED';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS loan_funding_booking_investor_shortfall ON public.loan_funding_bookings;
CREATE TRIGGER loan_funding_booking_investor_shortfall
AFTER INSERT OR UPDATE OF queue_status,requested_amount
ON public.loan_funding_bookings
FOR EACH ROW EXECUTE FUNCTION public.capture_investor_funding_shortfall();

CREATE OR REPLACE FUNCTION public.claim_investor_funding_alert(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.investor_funding_requests%ROWTYPE;
  v_app public.loan_applications%ROWTYPE;
BEGIN
  IF NOT public.current_user_is_active_admin() THEN
    RAISE EXCEPTION 'Only active administrators can send investor funding alerts.';
  END IF;

  SELECT * INTO v_request
  FROM public.investor_funding_requests
  WHERE id=p_request_id AND status='REQUESTED'
  FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('claimed',false); END IF;
  IF v_request.alert_status='SENDING'
     AND v_request.alert_last_attempt_at > now()-interval '10 minutes' THEN
    RETURN jsonb_build_object('claimed',false);
  END IF;
  IF v_request.alert_status='SENT' THEN
    RETURN jsonb_build_object('claimed',false);
  END IF;

  UPDATE public.investor_funding_requests
  SET alert_status='SENDING',alert_last_attempt_at=now(),alert_error=NULL,updated_at=now()
  WHERE id=p_request_id;

  SELECT * INTO v_app FROM public.loan_applications WHERE id=v_request.application_id;
  RETURN jsonb_build_object(
    'claimed',true,
    'request_id',v_request.id,
    'application_id',v_request.application_id,
    'application_number',v_request.application_number,
    'customer_name',v_request.customer_name,
    'loan_amount',v_request.loan_amount,
    'term_months',v_request.term_months,
    'available_bank_balance',v_request.available_bank_balance,
    'funding_shortfall',v_request.funding_shortfall,
    'interest_rate_monthly',v_request.interest_rate_monthly,
    'estimated_interest',v_request.estimated_interest,
    'estimated_total_liability',v_request.estimated_total_liability
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_investor_funding_alert(
  p_request_id uuid,
  p_success boolean,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.current_user_is_active_admin() THEN
    RAISE EXCEPTION 'Only active administrators can update investor funding alert status.';
  END IF;
  UPDATE public.investor_funding_requests
  SET alert_status=CASE WHEN p_success THEN 'SENT' ELSE 'FAILED' END,
      alert_sent_at=CASE WHEN p_success THEN now() ELSE alert_sent_at END,
      alert_error=CASE WHEN p_success THEN NULL ELSE left(coalesce(p_error,'Email failed'),1000) END,
      updated_at=now()
  WHERE id=p_request_id AND status='REQUESTED';
END;
$$;

CREATE OR REPLACE FUNCTION public.record_investor_funding_received(
  p_request_id uuid,
  p_investor_id uuid,
  p_amount numeric,
  p_received_date date,
  p_bank_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.investor_funding_requests%ROWTYPE;
  v_investor public.investors%ROWTYPE;
  v_app public.loan_applications%ROWTYPE;
  v_account public.bank_accounts%ROWTYPE;
  v_balance numeric(14,2);
  v_borrowing_id uuid;
  v_transaction_id uuid;
  v_due_date date;
  v_new_balance numeric(14,2);
BEGIN
  IF NOT public.current_user_is_active_admin() THEN
    RAISE EXCEPTION 'Only active administrators can record investor funding.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Funding amount must be greater than zero.'; END IF;
  IF coalesce(trim(p_bank_reference),'')='' THEN RAISE EXCEPTION 'Bank transfer reference is required.'; END IF;

  SELECT * INTO v_request FROM public.investor_funding_requests
  WHERE id=p_request_id AND status='REQUESTED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This funding request is no longer awaiting investor funds.'; END IF;
  IF round(p_amount,2) <> v_request.funding_shortfall THEN
    RAISE EXCEPTION 'Investor funding must equal the current shortfall of R%.',v_request.funding_shortfall;
  END IF;

  SELECT * INTO v_investor FROM public.investors WHERE id=p_investor_id AND is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active investor.'; END IF;

  SELECT * INTO v_app FROM public.loan_applications WHERE id=v_request.application_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'The linked loan application could not be found.'; END IF;

  SELECT * INTO v_account FROM public.bank_accounts
  WHERE is_active=true AND is_verified=true
  ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No verified active company bank account is available.'; END IF;

  SELECT coalesce((
    SELECT bt.balance_after FROM public.bank_transactions bt
    WHERE bt.bank_account_id=v_account.id AND coalesce(bt.is_void,false)=false
    ORDER BY bt.transaction_date DESC,bt.created_at DESC LIMIT 1
  ),v_account.opening_balance) INTO v_balance;
  v_new_balance := round(v_balance+p_amount,2);

  v_due_date := coalesce(v_app.preferred_payment_date,(v_app.application_date + interval '1 month')::date);

  INSERT INTO public.company_borrowings(
    lender_name,borrowing_date,original_amount,amount_repaid,outstanding_amount,
    description,reference,status,created_by,investor_id,loan_application_id,
    investor_monthly_interest_rate,first_interest_charge_date,next_interest_charge_date,
    interest_charge_count,interest_charged_total
  )
  VALUES(
    v_investor.investor_name,coalesce(p_received_date,current_date),p_amount,0,p_amount,
    'Investor funding for application '||v_request.application_number,
    trim(p_bank_reference),'Outstanding',auth.uid(),v_investor.id,v_request.application_id,
    v_request.interest_rate_monthly,v_due_date+4,v_due_date+4,0,0
  )
  RETURNING id INTO v_borrowing_id;

  INSERT INTO public.bank_transactions(
    bank_account_id,transaction_date,transaction_type,description,amount,direction,
    balance_after,borrowing_id,reference,created_by
  )
  VALUES(
    v_account.id,coalesce(p_received_date,current_date),'BORROWING',
    'Investor funding received from '||v_investor.investor_name||' for '||v_request.application_number,
    p_amount,'IN',v_new_balance,v_borrowing_id,trim(p_bank_reference),auth.uid()
  )
  RETURNING id INTO v_transaction_id;

  UPDATE public.investor_funding_requests
  SET status='FUNDED',investor_id=v_investor.id,borrowing_id=v_borrowing_id,
      received_amount=p_amount,received_at=coalesce(p_received_date,current_date)::timestamptz,
      bank_reference=trim(p_bank_reference),updated_at=now()
  WHERE id=p_request_id;

  INSERT INTO public.audit_logs(user_id,entity_type,entity_id,action,description,module,table_name,record_id,new_data)
  VALUES(auth.uid(),'investor_funding',v_borrowing_id,'Investor Funding Received',
    'Investor funding received for application '||v_request.application_number,
    'Investors','company_borrowings',v_borrowing_id,
    jsonb_build_object('investor_id',v_investor.id,'application_id',v_request.application_id,
      'amount',p_amount,'interest_rate_monthly',v_request.interest_rate_monthly,
      'first_interest_charge_date',v_due_date+4,'bank_reference',trim(p_bank_reference)));

  RETURN jsonb_build_object('success',true,'borrowing_id',v_borrowing_id,
    'bank_transaction_id',v_transaction_id,'bank_balance_after',v_new_balance,
    'first_interest_charge_date',v_due_date+4);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_investor_repayment(
  p_borrowing_id uuid,
  p_amount numeric,
  p_repayment_date date,
  p_reference text,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_borrowing public.company_borrowings%ROWTYPE;
  v_account public.bank_accounts%ROWTYPE;
  v_balance numeric(14,2);
  v_new_balance numeric(14,2);
  v_outstanding numeric(14,2);
  v_status text;
  v_transaction_id uuid;
  v_repayment_id uuid;
BEGIN
  IF NOT public.current_user_is_active_admin() THEN
    RAISE EXCEPTION 'Only active administrators can record investor repayments.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Repayment amount must be greater than zero.'; END IF;
  IF coalesce(trim(p_reference),'')='' THEN RAISE EXCEPTION 'Bank payment reference is required.'; END IF;

  SELECT * INTO v_borrowing FROM public.company_borrowings
  WHERE id=p_borrowing_id AND investor_id IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Investor borrowing not found.'; END IF;
  IF p_amount > v_borrowing.outstanding_amount THEN RAISE EXCEPTION 'Repayment exceeds the investor outstanding liability.'; END IF;

  SELECT * INTO v_account FROM public.bank_accounts
  WHERE is_active=true ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No active company bank account was found.'; END IF;

  SELECT coalesce((
    SELECT bt.balance_after FROM public.bank_transactions bt
    WHERE bt.bank_account_id=v_account.id AND coalesce(bt.is_void,false)=false
    ORDER BY bt.transaction_date DESC,bt.created_at DESC LIMIT 1
  ),v_account.opening_balance) INTO v_balance;
  IF p_amount > v_balance THEN RAISE EXCEPTION 'Insufficient bank balance. Available balance: R%.',v_balance; END IF;

  v_new_balance := round(v_balance-p_amount,2);
  v_outstanding := round(v_borrowing.outstanding_amount-p_amount,2);
  v_status := CASE WHEN v_outstanding=0 THEN 'Paid' ELSE 'Partially Paid' END;

  UPDATE public.company_borrowings
  SET amount_repaid=round(amount_repaid+p_amount,2),outstanding_amount=v_outstanding,
      status=v_status,updated_at=now()
  WHERE id=p_borrowing_id;

  INSERT INTO public.bank_transactions(
    bank_account_id,transaction_date,transaction_type,description,amount,direction,
    balance_after,borrowing_id,reference,created_by
  )
  VALUES(v_account.id,coalesce(p_repayment_date,current_date),'DEBT_REPAYMENT',
    coalesce(nullif(trim(p_description),''),'Investor repayment to '||v_borrowing.lender_name),
    p_amount,'OUT',v_new_balance,p_borrowing_id,trim(p_reference),auth.uid())
  RETURNING id INTO v_transaction_id;

  INSERT INTO public.investor_repayments(
    borrowing_id,amount,repayment_date,reference,description,bank_transaction_id,created_by
  )
  VALUES(p_borrowing_id,p_amount,coalesce(p_repayment_date,current_date),trim(p_reference),
    nullif(trim(p_description),''),v_transaction_id,auth.uid())
  RETURNING id INTO v_repayment_id;

  INSERT INTO public.audit_logs(user_id,entity_type,entity_id,action,description,module,table_name,record_id,new_data)
  VALUES(auth.uid(),'investor_repayment',v_repayment_id,'Investor Repayment Recorded',
    'Investor repayment of R'||p_amount||' recorded for '||v_borrowing.lender_name,
    'Investors','investor_repayments',v_repayment_id,
    jsonb_build_object('borrowing_id',p_borrowing_id,'amount',p_amount,'outstanding_amount',v_outstanding));

  RETURN jsonb_build_object('success',true,'repayment_id',v_repayment_id,
    'bank_transaction_id',v_transaction_id,'outstanding_amount',v_outstanding,
    'bank_balance_after',v_new_balance,'status',v_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_due_investor_interest()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_borrowing record;
  v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  v_charge numeric(14,2);
  v_before numeric(14,2);
  v_after numeric(14,2);
  v_count integer;
  v_total integer := 0;
BEGIN
  FOR v_borrowing IN
    SELECT id,outstanding_amount,investor_monthly_interest_rate,next_interest_charge_date,interest_charge_count
    FROM public.company_borrowings
    WHERE investor_id IS NOT NULL
      AND coalesce(outstanding_amount,0)>0
      AND next_interest_charge_date IS NOT NULL
      AND next_interest_charge_date<=v_today
      AND status NOT IN ('Paid','Voided')
    ORDER BY next_interest_charge_date,id
    FOR UPDATE
  LOOP
    v_before := v_borrowing.outstanding_amount;
    v_count := v_borrowing.interest_charge_count;
    WHILE v_borrowing.next_interest_charge_date<=v_today AND v_before>0 LOOP
      v_charge := round(v_before*v_borrowing.investor_monthly_interest_rate/100,2);
      IF v_charge<=0 THEN EXIT; END IF;
      v_after := round(v_before+v_charge,2);
      v_count := v_count+1;

      INSERT INTO public.investor_interest_charges(
        borrowing_id,charge_number,charge_date,interest_rate,balance_before,interest_amount,balance_after
      )
      VALUES(v_borrowing.id,v_count,v_borrowing.next_interest_charge_date,
        v_borrowing.investor_monthly_interest_rate,v_before,v_charge,v_after)
      ON CONFLICT (borrowing_id,charge_number) DO NOTHING;

      IF FOUND THEN
        v_before := v_after;
        v_total := v_total+1;
      END IF;

      v_borrowing.next_interest_charge_date := (v_borrowing.next_interest_charge_date+interval '1 month')::date;
    END LOOP;

    UPDATE public.company_borrowings
    SET outstanding_amount=v_before,
        interest_charge_count=v_count,
        interest_charged_total=coalesce(interest_charged_total,0)+
          coalesce((SELECT sum(c.interest_amount) FROM public.investor_interest_charges c
            WHERE c.borrowing_id=v_borrowing.id AND c.charge_number>v_borrowing.interest_charge_count),0),
        next_interest_charge_date=v_borrowing.next_interest_charge_date,
        status=CASE WHEN v_before<=0 THEN 'Paid' ELSE 'Outstanding' END,
        updated_at=now()
    WHERE id=v_borrowing.id;
  END LOOP;

  RETURN jsonb_build_object('charges_applied',v_total,'processed_on',v_today);
END;
$$;

REVOKE ALL ON FUNCTION public.create_investor(text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_investor_funding_alert(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_investor_funding_alert(uuid,boolean,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_investor_funding_received(uuid,uuid,numeric,date,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_investor_repayment(uuid,numeric,date,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_due_investor_interest() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_investor(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_investor_funding_alert(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_investor_funding_alert(uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_investor_funding_received(uuid,uuid,numeric,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_investor_repayment(uuid,numeric,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_due_investor_interest() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='umhlomunye-investor-interest-engine') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='umhlomunye-investor-interest-engine';
  END IF;
  PERFORM cron.schedule('umhlomunye-investor-interest-engine','* * * * *',
    'SELECT public.apply_due_investor_interest();');
END;
$$;
