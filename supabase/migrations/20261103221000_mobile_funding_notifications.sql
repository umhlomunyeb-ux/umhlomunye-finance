-- Mobile in-app notifications for funding shortfalls.
-- OS-level push delivery is handled separately by the configured mobile push provider.

CREATE TABLE IF NOT EXISTS public.mobile_admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  event_key text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,event_key)
);

ALTER TABLE public.mobile_admin_notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.mobile_admin_notifications TO authenticated;

DROP POLICY IF EXISTS "Admins can view their mobile notifications" ON public.mobile_admin_notifications;
CREATE POLICY "Admins can view their mobile notifications"
  ON public.mobile_admin_notifications FOR SELECT TO authenticated
  USING (user_id=auth.uid() AND public.current_user_is_active_admin());

DROP POLICY IF EXISTS "Admins can mark their mobile notifications read" ON public.mobile_admin_notifications;
CREATE POLICY "Admins can mark their mobile notifications read"
  ON public.mobile_admin_notifications FOR UPDATE TO authenticated
  USING (user_id=auth.uid() AND public.current_user_is_active_admin())
  WITH CHECK (user_id=auth.uid() AND public.current_user_is_active_admin());

CREATE OR REPLACE FUNCTION public.enqueue_mobile_funding_notification(
  p_event_key text,
  p_notification_type text,
  p_title text,
  p_message text,
  p_data jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.mobile_admin_notifications(
    user_id,notification_type,event_key,title,message,data
  )
  SELECT u.id,p_notification_type,p_event_key,p_title,p_message,coalesce(p_data,'{}'::jsonb)
  FROM public.users u
  WHERE lower(coalesce(u.role,''))='admin'
    AND coalesce(u.is_active,true)=true
    AND coalesce(u.is_deleted,false)=false
  ON CONFLICT(user_id,event_key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_mobile_on_investor_funding_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status='REQUESTED' AND (
    TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status
    OR OLD.funding_shortfall IS DISTINCT FROM NEW.funding_shortfall
  ) THEN
    PERFORM public.enqueue_mobile_funding_notification(
      'INVESTOR-FUNDING:'||NEW.id::text,
      'INVESTOR_FUNDING_REQUIRED',
      'Investor funding required',
      'Funds are required for application '||NEW.application_number||'. Shortfall: R'||to_char(NEW.funding_shortfall,'FM999999990.00'),
      jsonb_build_object('request_id',NEW.id,'application_id',NEW.application_id,
        'application_number',NEW.application_number,'customer_name',NEW.customer_name,
        'funding_shortfall',NEW.funding_shortfall,'loan_amount',NEW.loan_amount)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS investor_funding_mobile_notification ON public.investor_funding_requests;
CREATE TRIGGER investor_funding_mobile_notification
AFTER INSERT OR UPDATE OF status,funding_shortfall
ON public.investor_funding_requests
FOR EACH ROW EXECUTE FUNCTION public.notify_mobile_on_investor_funding_request();

CREATE OR REPLACE FUNCTION public.notify_mobile_on_top_up_funding_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loan_number text;
  v_customer_name text;
BEGIN
  IF NEW.status='WAITING_FOR_FUNDS' AND (
    TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status
  ) THEN
    SELECT l.loan_number,trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,''))
    INTO v_loan_number,v_customer_name
    FROM public.loans l
    LEFT JOIN public.customers c ON c.id=l.customer_id
    WHERE l.id=NEW.loan_id;

    PERFORM public.enqueue_mobile_funding_notification(
      'TOP-UP-FUNDING:'||NEW.id::text,
      'LOAN_TOP_UP_FUNDS_REQUIRED',
      'Loan top-up needs investor funds',
      'Approved top-up for loan '||coalesce(v_loan_number,NEW.loan_id::text)
        ||' requires R'||to_char(NEW.requested_amount,'FM999999990.00')||' in funding.',
      jsonb_build_object('top_up_request_id',NEW.id,'loan_id',NEW.loan_id,
        'loan_number',v_loan_number,'customer_name',v_customer_name,
        'funding_shortfall',NEW.requested_amount,'status',NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS loan_top_up_mobile_notification ON public.loan_top_up_requests;
CREATE TRIGGER loan_top_up_mobile_notification
AFTER INSERT OR UPDATE OF status
ON public.loan_top_up_requests
FOR EACH ROW EXECUTE FUNCTION public.notify_mobile_on_top_up_funding_request();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname='supabase_realtime' AND schemaname='public'
         AND tablename='mobile_admin_notifications'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mobile_admin_notifications;
  END IF;
END;
$$;
