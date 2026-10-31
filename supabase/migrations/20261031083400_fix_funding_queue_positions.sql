CREATE OR REPLACE FUNCTION public.create_public_funding_booking(
  p_application_id uuid,p_upload_token text,p_choice text,p_preferred_funding_date date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_app public.loan_applications%ROWTYPE; v_booking public.loan_funding_bookings%ROWTYPE; v_position integer;
BEGIN
  IF upper(coalesce(p_choice,'')) NOT IN ('WAIT','BOOK') THEN RAISE EXCEPTION 'Choose to wait for funds or book a funding date.'; END IF;
  IF upper(p_choice)='BOOK' AND p_preferred_funding_date IS NULL THEN RAISE EXCEPTION 'Select a preferred funding date.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.loan_application_upload_tokens t WHERE t.application_id=p_application_id
    AND t.token_hash=encode(digest(trim(coalesce(p_upload_token,'')),'sha256'),'hex') AND t.expires_at>now() AND t.used_at IS NULL)
    THEN RAISE EXCEPTION 'The application security token is invalid or expired.'; END IF;
  SELECT * INTO v_app FROM public.loan_applications WHERE id=p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found.'; END IF;
  IF v_app.affordability_status<>'AFFORDABLE' THEN RAISE EXCEPTION 'Only applications that pass affordability can join the funding queue.'; END IF;
  IF v_app.status IN ('CANCELLED','REJECTED','APPROVED') THEN RAISE EXCEPTION 'This application can no longer be queued.'; END IF;
  INSERT INTO public.loan_funding_bookings(application_id,requested_amount,preferred_funding_date,queue_status)
  VALUES(p_application_id,v_app.amount_requested,CASE WHEN upper(p_choice)='BOOK' THEN p_preferred_funding_date ELSE NULL END,'WAITING_FOR_FUNDS')
  ON CONFLICT(application_id) DO UPDATE SET requested_amount=EXCLUDED.requested_amount,
    preferred_funding_date=EXCLUDED.preferred_funding_date,queue_status='WAITING_FOR_FUNDS',updated_at=now()
  RETURNING * INTO v_booking;
  UPDATE public.loan_applications SET status='WAITING_FOR_FUNDS',funding_decision=upper(p_choice),updated_at=now() WHERE id=p_application_id;
  WITH ranked AS (
    SELECT id,row_number() over(ORDER BY preferred_funding_date NULLS FIRST,booked_at,id)::integer AS position
    FROM public.loan_funding_bookings WHERE queue_status='WAITING_FOR_FUNDS'
  ) UPDATE public.loan_funding_bookings b SET queue_position=ranked.position FROM ranked WHERE ranked.id=b.id;
  SELECT queue_position INTO v_position FROM public.loan_funding_bookings WHERE id=v_booking.id;
  RETURN jsonb_build_object('success',true,'booking_id',v_booking.id,'queue_status','WAITING_FOR_FUNDS',
    'preferred_funding_date',v_booking.preferred_funding_date,'queue_position',v_position);
END;
$$;
REVOKE ALL ON FUNCTION public.create_public_funding_booking(uuid,text,text,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_public_funding_booking(uuid,text,text,date) TO anon,authenticated;
