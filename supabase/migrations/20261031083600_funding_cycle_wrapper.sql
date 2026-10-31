CREATE OR REPLACE FUNCTION public.expire_public_loan_offers()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.loan_applications
    SET offer_status='EXPIRED',status='WAITING_FOR_FUNDS',offer_expires_at=NULL,updated_at=now()
    WHERE offer_status='ISSUED' AND offer_expires_at<=now() AND status='OFFER_READY'
    RETURNING id
  )
  UPDATE public.loan_funding_bookings b
  SET queue_status='WAITING_FOR_FUNDS',last_checked_at=now(),updated_at=now()
  WHERE b.application_id IN (SELECT id FROM expired);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  UPDATE public.loan_funding_reservations
  SET reservation_status='RELEASED',updated_at=now()
  WHERE reservation_status='RESERVED' AND expires_at<=now();
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_automated_funding_cycle()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_expired integer; v_result jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('umhlomunye-funding-cycle'));
  v_expired:=public.expire_public_loan_offers();
  v_result:=public.process_funding_queue();
  RETURN jsonb_build_object('expired_offers_requeued',v_expired,'funding_result',v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.run_automated_funding_cycle() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.run_automated_funding_cycle() TO service_role;

DO $$
DECLARE v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname='umhlomunye-funding-queue-every-minute' LIMIT 1;
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
  PERFORM cron.schedule('umhlomunye-funding-queue-every-minute','* * * * *',
    'select public.run_automated_funding_cycle();');
END;
$$;
