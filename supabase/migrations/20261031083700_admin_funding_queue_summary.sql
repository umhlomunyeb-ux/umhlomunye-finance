CREATE OR REPLACE FUNCTION public.get_admin_funding_queue_summary()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_position jsonb; v_items jsonb; v_total numeric(14,2);
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id=auth.uid()
      AND lower(u.role)='admin' AND u.is_active=true AND coalesce(u.is_deleted,false)=false
  ) THEN RAISE EXCEPTION 'Only an active Administrator can view the funding queue.'; END IF;
  v_position:=public.get_company_funding_position();
  SELECT COALESCE(SUM(a.offer_amount),0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'application_id',a.id,'application_number',a.application_number,
      'customer_name',trim(a.first_name||' '||a.last_name),
      'requested_amount',a.offer_amount,'term_months',a.offer_term_months,
      'monthly_repayment',a.offer_monthly_repayment,
      'total_repayment',a.offer_total_repayment,'offer_expires_at',a.offer_expires_at
    ) ORDER BY a.funding_available_at,a.application_date), '[]'::jsonb)
  INTO v_total,v_items
  FROM public.loan_applications a
  WHERE a.status='OFFER_READY' AND a.offer_status='ISSUED';
  RETURN jsonb_build_object(
    'available_funds_after_reservations',COALESCE((v_position->>'available_funds')::numeric,0),
    'verified_account_count',COALESCE((v_position->>'verified_account_count')::integer,0),
    'combined_funding_total',v_total,
    'available_before_reservations',COALESCE((v_position->>'available_funds')::numeric,0)+COALESCE((v_position->>'active_reservations')::numeric,0),
    'remaining_after_reservations',COALESCE((v_position->>'available_funds')::numeric,0),
    'fundable_applications',v_items
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_funding_queue_summary() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_admin_funding_queue_summary() TO authenticated;
