-- A borrower graduates from the first-time cap only after an actual fully repaid loan.
CREATE OR REPLACE FUNCTION public.is_first_time_borrower(
  p_customer_id uuid,
  p_id_number text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_customer_id uuid:=p_customer_id;
  v_rule_applicable boolean;
  v_normalized_id text;
BEGIN
  IF v_customer_id IS NULL AND nullif(p_id_number,'') IS NOT NULL THEN
    v_normalized_id:=regexp_replace(p_id_number,'[^0-9]','','g');
    SELECT c.id,c.first_time_borrower_rule_applicable
    INTO v_customer_id,v_rule_applicable
    FROM public.customers c
    WHERE regexp_replace(coalesce(c.id_number,''),'[^0-9]','','g')=v_normalized_id
      AND coalesce(c.is_deleted,false)=false AND coalesce(c.is_active,true)=true
    ORDER BY c.created_at DESC NULLS LAST LIMIT 1;
  ELSIF v_customer_id IS NOT NULL THEN
    SELECT c.first_time_borrower_rule_applicable INTO v_rule_applicable
    FROM public.customers c WHERE c.id=v_customer_id
      AND coalesce(c.is_deleted,false)=false AND coalesce(c.is_active,true)=true;
  END IF;
  IF v_customer_id IS NULL THEN RETURN true; END IF;
  IF coalesce(v_rule_applicable,false)=false THEN RETURN false; END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM public.loans l
    WHERE l.customer_id=v_customer_id
      AND coalesce(l.is_deleted,false)=false
      AND coalesce(l.total_paid,0)>=coalesce(l.total_repayment,0)
      AND coalesce(l.current_balance,0)<=0
  );
END;
$$;
