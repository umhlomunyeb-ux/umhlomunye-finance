-- Notify active administrators when a new public loan application is created for review.
-- Reuses the configured Web Push dispatcher and existing mobile notification inbox.

CREATE OR REPLACE FUNCTION public.notify_admin_new_loan_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
  v_applicant text;
  v_amount text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'PENDING' THEN
    RETURN NEW;
  END IF;

  v_applicant := trim(coalesce(NEW.first_name,'') || ' ' || coalesce(NEW.last_name,''));
  v_amount := 'R' || to_char(coalesce(NEW.amount_requested,0),'FM999999990.00');

  INSERT INTO public.mobile_admin_notifications(
    user_id, notification_type, event_key, title, message, data
  )
  SELECT
    u.id,
    'NEW_LOAN_APPLICATION',
    'NEW-LOAN-APPLICATION:' || NEW.id::text,
    'New loan application for review',
    coalesce(nullif(v_applicant,''),'A customer') || ' submitted a loan application for ' || v_amount || '.',
    jsonb_build_object(
      'application_id', NEW.id,
      'application_number', NEW.application_number,
      'applicant_name', v_applicant,
      'amount_requested', NEW.amount_requested,
      'status', NEW.status
    )
  FROM public.users u
  WHERE lower(coalesce(u.role,'')) = 'admin'
    AND coalesce(u.is_active,true) = true
    AND coalesce(u.is_deleted,false) = false
  ON CONFLICT (user_id,event_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted > 0 THEN
    PERFORM public.dispatch_admin_web_push(jsonb_build_object(
      'event_key', 'NEW-LOAN-APPLICATION:' || NEW.id::text,
      'title', 'New loan application for review',
      'body', coalesce(nullif(v_applicant,''),'A customer') || ' submitted a loan application for ' || v_amount || '.',
      'url', '/mobile/application-review/' || NEW.id::text,
      'data', jsonb_build_object(
        'application_id', NEW.id,
        'application_number', NEW.application_number,
        'applicant_name', v_applicant,
        'amount_requested', NEW.amount_requested,
        'status', NEW.status
      )
    ));
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_admin_new_loan_application() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_admin_new_loan_application ON public.loan_applications;
CREATE TRIGGER trg_notify_admin_new_loan_application
AFTER INSERT ON public.loan_applications
FOR EACH ROW
WHEN (NEW.status = 'PENDING')
EXECUTE FUNCTION public.notify_admin_new_loan_application();
