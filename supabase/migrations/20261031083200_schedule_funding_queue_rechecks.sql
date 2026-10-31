-- Recheck waiting loan applications once per minute as verified bank funds are recorded.
DO $$
DECLARE v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname='umhlomunye-funding-queue-every-minute' LIMIT 1;
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
  PERFORM cron.schedule(
    'umhlomunye-funding-queue-every-minute',
    '* * * * *',
    'select public.process_funding_queue();'
  );
END;
$$;
