-- Keep document snapshots linked to the private ID fingerprint and preserve matching at approval.
CREATE OR REPLACE FUNCTION private.protect_id_number_column()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,vault,extensions
AS $$
DECLARE
  v_new jsonb; v_old jsonb; v_raw text; v_old_raw text; v_normalized text;
  v_fingerprint text; v_ciphertext text; v_entity_id uuid;
  v_entity_type text:=TG_ARGV[1]; v_column text:=TG_ARGV[0]; v_customer_id uuid;
BEGIN
  v_new:=to_jsonb(NEW); v_raw:=v_new->>v_column; v_entity_id:=(v_new->>'id')::uuid;
  IF TG_OP='UPDATE' THEN v_old:=to_jsonb(OLD); v_old_raw:=v_old->>v_column; END IF;
  IF v_raw IS NULL OR btrim(v_raw)='' THEN
    DELETE FROM private.id_number_fingerprints WHERE entity_type=v_entity_type AND entity_id=v_entity_id;
    RETURN NEW;
  END IF;
  IF left(v_raw,7)='ENC:v1:' THEN
    IF v_entity_type='document' AND nullif(v_new->>'customer_id','') IS NOT NULL THEN
      v_customer_id:=(v_new->>'customer_id')::uuid;
      INSERT INTO private.id_number_fingerprints(entity_type,entity_id,fingerprint,updated_at)
      SELECT 'document',v_entity_id,fingerprint,now()
      FROM private.id_number_fingerprints WHERE entity_type='customer' AND entity_id=v_customer_id
      ON CONFLICT(entity_type,entity_id) DO UPDATE SET fingerprint=excluded.fingerprint,updated_at=now();
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND v_raw~'^\*+$' AND left(coalesce(v_old_raw,''),7)='ENC:v1:' THEN
    NEW:=jsonb_populate_record(NEW,jsonb_build_object(v_column,v_old_raw));
    RETURN NEW;
  END IF;
  v_normalized:=regexp_replace(v_raw,'[^0-9]','','g');
  IF v_normalized='' AND v_raw~'^\*+$' THEN
    DELETE FROM private.id_number_fingerprints WHERE entity_type=v_entity_type AND entity_id=v_entity_id;
    RETURN NEW;
  END IF;
  IF length(v_normalized)<>13 THEN RAISE EXCEPTION 'ID number must contain exactly 13 digits.'; END IF;
  v_fingerprint:=private.id_number_fingerprint(v_normalized);
  v_ciphertext:=private.id_number_encrypt(v_normalized);
  INSERT INTO private.id_number_fingerprints(entity_type,entity_id,fingerprint,updated_at)
  VALUES(v_entity_type,v_entity_id,v_fingerprint,now())
  ON CONFLICT(entity_type,entity_id) DO UPDATE SET fingerprint=excluded.fingerprint,updated_at=now();
  NEW:=jsonb_populate_record(NEW,jsonb_build_object(v_column,v_ciphertext));
  RETURN NEW;
END;
$$;

DO $$
DECLARE v_def text;
BEGIN
  v_def:=pg_get_functiondef('public.approve_loan_application(uuid,uuid)'::regprocedure);
  v_def:=replace(v_def,E'\r\n',E'\n');
  v_def:=replace(v_def,
$old$from public.customers
      where id_number = trim(v_application.id_number)
        and coalesce(is_deleted, false) = false
      limit 1
      for update;$old$,
$new$from public.customers c
      where exists (
        select 1 from private.id_number_fingerprints application_fp
        join private.id_number_fingerprints customer_fp
          on customer_fp.fingerprint=application_fp.fingerprint
        where application_fp.entity_type='loan_application'
          and application_fp.entity_id=v_application.id
          and customer_fp.entity_type='customer'
          and customer_fp.entity_id=c.id
      )
        and coalesce(c.is_deleted,false)=false
      limit 1
      for update;$new$);
  v_def:=replace(v_def,
$old$returning id into v_customer_id;
    end if;$old$,
$new$returning id into v_customer_id;
      INSERT INTO private.id_number_fingerprints(entity_type,entity_id,fingerprint,updated_at)
      SELECT 'customer',v_customer_id,fingerprint,now()
      FROM private.id_number_fingerprints
      WHERE entity_type='loan_application' AND entity_id=v_application.id
      ON CONFLICT(entity_type,entity_id) DO UPDATE
        SET fingerprint=excluded.fingerprint,updated_at=now();
    end if;$new$);
  IF position('where id_number = trim(v_application.id_number)' in lower(v_def))>0
     OR position('entity_type=''loan_application''' in v_def)=0 THEN
    RAISE EXCEPTION 'Could not safely update the approval customer matching fallback.';
  END IF;
  EXECUTE v_def;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_valid_customer_document(p_customer_id uuid,p_document_type text)
RETURNS TABLE(document_id uuid,document_type text,document_name text,document_path text,created_at timestamptz,retention_until date,retention_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_catalog
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication is required.'; END IF;
  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Customer ID is required.'; END IF;
  IF p_document_type NOT IN ('Bank Statement','Payslip','Proof of Residence') THEN
    RAISE EXCEPTION 'Document type is not eligible for 6-month reuse.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id=p_customer_id AND c.is_active=true AND c.is_deleted=false) THEN
    RAISE EXCEPTION 'Active customer not found.';
  END IF;
  RETURN QUERY
  SELECT d.id,d.document_type,d.document_name,d.document_path,d.created_at,d.retention_until,d.retention_status
  FROM public.documents d
  WHERE d.document_type=p_document_type
    AND (
      d.customer_id=p_customer_id
      OR (
        d.customer_id IS NULL
        AND EXISTS (
          SELECT 1 FROM private.id_number_fingerprints document_fp
          JOIN private.id_number_fingerprints customer_fp
            ON customer_fp.fingerprint=document_fp.fingerprint
          WHERE document_fp.entity_type='document' AND document_fp.entity_id=d.id
            AND customer_fp.entity_type='customer' AND customer_fp.entity_id=p_customer_id
        )
      )
    )
    AND d.retention_until IS NOT NULL AND d.retention_until>=CURRENT_DATE
    AND COALESCE(d.retention_status,'ACTIVE')='ACTIVE'
    AND COALESCE(d.is_archived,false)=false
  ORDER BY d.created_at DESC LIMIT 1;
END;
$function$;
