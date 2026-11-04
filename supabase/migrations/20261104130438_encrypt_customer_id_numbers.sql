-- Encrypt South African ID numbers at rest and use a private keyed fingerprint for exact matching.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name='UMHLOMUNYE_CUSTOMER_ID_ENCRYPTION_KEY') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'UMHLOMUNYE_CUSTOMER_ID_ENCRYPTION_KEY','AES-256 PGP encryption key for customer identity numbers',NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name='UMHLOMUNYE_CUSTOMER_ID_HMAC_KEY') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'UMHLOMUNYE_CUSTOMER_ID_HMAC_KEY','HMAC-SHA256 key for exact customer identity matching',NULL);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS private.id_number_fingerprints (
  entity_type text NOT NULL CHECK (entity_type IN ('customer','loan_application','document')),
  entity_id uuid NOT NULL,
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type,entity_id)
);
ALTER TABLE private.id_number_fingerprints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.id_number_fingerprints FROM PUBLIC, anon, authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS id_number_fingerprints_customer_unique
  ON private.id_number_fingerprints(fingerprint) WHERE entity_type='customer';
CREATE INDEX IF NOT EXISTS id_number_fingerprints_lookup_idx
  ON private.id_number_fingerprints(entity_type,fingerprint);

CREATE OR REPLACE FUNCTION private.id_number_secret(p_name text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=p_name LIMIT 1
$$;

CREATE OR REPLACE FUNCTION private.id_number_fingerprint(p_id_number text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, private, vault, extensions
AS $$
DECLARE v_normalized text; v_key text;
BEGIN
  v_normalized := regexp_replace(coalesce(p_id_number,''),'[^0-9]','','g');
  IF length(v_normalized)<>13 THEN RETURN NULL; END IF;
  v_key := private.id_number_secret('UMHLOMUNYE_CUSTOMER_ID_HMAC_KEY');
  IF v_key IS NULL THEN RAISE EXCEPTION 'Customer ID matching key is not configured.'; END IF;
  RETURN encode(extensions.hmac(v_normalized,v_key,'sha256'),'hex');
END;
$$;

CREATE OR REPLACE FUNCTION private.id_number_encrypt(p_id_number text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, private, vault, extensions
AS $$
DECLARE v_normalized text; v_key text;
BEGIN
  v_normalized := regexp_replace(coalesce(p_id_number,''),'[^0-9]','','g');
  IF length(v_normalized)<>13 THEN RAISE EXCEPTION 'ID number must contain exactly 13 digits.'; END IF;
  v_key := private.id_number_secret('UMHLOMUNYE_CUSTOMER_ID_ENCRYPTION_KEY');
  IF v_key IS NULL THEN RAISE EXCEPTION 'Customer ID encryption key is not configured.'; END IF;
  RETURN 'ENC:v1:' || encode(extensions.pgp_sym_encrypt(v_normalized,v_key,'cipher-algo=aes256, compress-algo=0'),'base64');
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_id_number_column()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, vault, extensions
AS $$
DECLARE
  v_new jsonb; v_old jsonb; v_raw text; v_old_raw text;
  v_normalized text; v_fingerprint text; v_ciphertext text;
  v_entity_id uuid; v_entity_type text := TG_ARGV[1]; v_column text := TG_ARGV[0];
BEGIN
  v_new := to_jsonb(NEW);
  v_raw := v_new ->> v_column;
  v_entity_id := (v_new ->> 'id')::uuid;
  IF TG_OP='UPDATE' THEN v_old:=to_jsonb(OLD); v_old_raw:=v_old ->> v_column; END IF;

  IF v_raw IS NULL OR btrim(v_raw)='' THEN
    DELETE FROM private.id_number_fingerprints WHERE entity_type=v_entity_type AND entity_id=v_entity_id;
    RETURN NEW;
  END IF;

  IF left(v_raw,7)='ENC:v1:' THEN RETURN NEW; END IF;

  IF TG_OP='UPDATE' AND v_raw ~ '^\*+$' AND left(coalesce(v_old_raw,''),7)='ENC:v1:' THEN
    NEW := jsonb_populate_record(NEW,jsonb_build_object(v_column,v_old_raw));
    RETURN NEW;
  END IF;

  v_normalized := regexp_replace(v_raw,'[^0-9]','','g');
  IF v_normalized='' AND v_raw ~ '^\*+$' THEN
    DELETE FROM private.id_number_fingerprints WHERE entity_type=v_entity_type AND entity_id=v_entity_id;
    RETURN NEW;
  END IF;
  IF length(v_normalized)<>13 THEN RAISE EXCEPTION 'ID number must contain exactly 13 digits.'; END IF;

  v_fingerprint := private.id_number_fingerprint(v_normalized);
  v_ciphertext := private.id_number_encrypt(v_normalized);
  INSERT INTO private.id_number_fingerprints(entity_type,entity_id,fingerprint,updated_at)
  VALUES(v_entity_type,v_entity_id,v_fingerprint,now())
  ON CONFLICT(entity_type,entity_id) DO UPDATE
    SET fingerprint=excluded.fingerprint,updated_at=now();
  NEW := jsonb_populate_record(NEW,jsonb_build_object(v_column,v_ciphertext));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.id_number_secret(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.id_number_fingerprint(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.id_number_encrypt(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.protect_id_number_column() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_customer_id_number ON public.customers;
CREATE TRIGGER protect_customer_id_number BEFORE INSERT OR UPDATE OF id_number ON public.customers
FOR EACH ROW EXECUTE FUNCTION private.protect_id_number_column('id_number','customer');
DROP TRIGGER IF EXISTS protect_loan_application_id_number ON public.loan_applications;
CREATE TRIGGER protect_loan_application_id_number BEFORE INSERT OR UPDATE OF id_number ON public.loan_applications
FOR EACH ROW EXECUTE FUNCTION private.protect_id_number_column('id_number','loan_application');
DROP TRIGGER IF EXISTS protect_document_customer_id_number_snapshot ON public.documents;
CREATE TRIGGER protect_document_customer_id_number_snapshot BEFORE INSERT OR UPDATE OF customer_id_number_snapshot ON public.documents
FOR EACH ROW EXECUTE FUNCTION private.protect_id_number_column('customer_id_number_snapshot','document');

UPDATE public.customers SET id_number=id_number
WHERE id_number IS NOT NULL AND left(id_number,7)<>'ENC:v1:' AND length(regexp_replace(id_number,'[^0-9]','','g'))=13;
UPDATE public.loan_applications SET id_number=id_number
WHERE id_number IS NOT NULL AND left(id_number,7)<>'ENC:v1:' AND length(regexp_replace(id_number,'[^0-9]','','g'))=13;
UPDATE public.documents SET customer_id_number_snapshot=customer_id_number_snapshot
WHERE customer_id_number_snapshot IS NOT NULL AND left(customer_id_number_snapshot,7)<>'ENC:v1:' AND length(regexp_replace(customer_id_number_snapshot,'[^0-9]','','g'))=13;

CREATE OR REPLACE FUNCTION public.lookup_public_customer_by_id_number(p_id_number text)
RETURNS TABLE(customer_id uuid,customer_number text,first_name text,last_name text,id_number text,cellphone text,email text,physical_address text,employer text,employment_status text,monthly_income numeric,other_income numeric,bank_name text,account_number text,loan_purpose text,collection_preference text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_catalog
AS $function$
DECLARE v_fingerprint text;
BEGIN
  v_fingerprint:=private.id_number_fingerprint(p_id_number);
  IF v_fingerprint IS NULL THEN RAISE EXCEPTION 'A valid 13-digit ID number is required.'; END IF;
  RETURN QUERY
  SELECT c.id,c.customer_number,c.first_name,c.last_name,repeat('*',13)::text,c.cellphone,
    COALESCE(c.email,la.email),COALESCE(c.physical_address,c.address,la.physical_address),
    COALESCE(c.employer,la.employer),la.employment_status,COALESCE(c.monthly_income,la.monthly_income),
    la.other_income,la.bank_name,la.account_number,la.loan_purpose,la.collection_preference
  FROM public.customers c
  LEFT JOIN LATERAL (
    SELECT a.email,a.physical_address,a.employer,a.employment_status,a.monthly_income,a.other_income,
      a.bank_name,a.account_number,a.loan_purpose,a.collection_preference
    FROM public.loan_applications a WHERE a.customer_id=c.id ORDER BY a.created_at DESC LIMIT 1
  ) la ON TRUE
  WHERE EXISTS (
    SELECT 1 FROM private.id_number_fingerprints f
    WHERE f.entity_type='customer' AND f.entity_id=c.id AND f.fingerprint=v_fingerprint
  )
  AND COALESCE(c.is_deleted,false)=false AND COALESCE(c.is_active,true)=true
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lookup_public_customer_blacklist_by_id_number(p_id_number text)
RETURNS TABLE(is_blacklisted boolean,blacklist_reason text)
LANGUAGE sql SECURITY DEFINER SET search_path=public,private,pg_catalog
AS $function$
  SELECT COALESCE(c.is_blacklisted,false),c.blacklist_reason
  FROM public.customers c
  WHERE EXISTS (
    SELECT 1 FROM private.id_number_fingerprints f
    WHERE f.entity_type='customer' AND f.entity_id=c.id
      AND f.fingerprint=private.id_number_fingerprint(p_id_number)
  )
  AND length(regexp_replace(COALESCE(p_id_number,''),'[^0-9]','','g'))=13
  AND COALESCE(c.is_deleted,false)=false
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.customer_id_number_exists(p_id_number text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER
SET search_path=public,private,pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM private.id_number_fingerprints f
    JOIN public.customers c ON c.id=f.entity_id
    WHERE f.entity_type='customer' AND f.fingerprint=private.id_number_fingerprint(p_id_number)
  );
$function$;
REVOKE ALL ON FUNCTION public.customer_id_number_exists(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_id_number_exists(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lookup_public_customer_by_id_number(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lookup_public_customer_blacklist_by_id_number(text) TO service_role;

CREATE OR REPLACE FUNCTION public.is_first_time_borrower(p_customer_id uuid,p_id_number text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,private,pg_catalog
AS $function$
DECLARE
  v_customer_id uuid:=p_customer_id;
  v_rule_applicable boolean;
  v_existing_verified boolean:=false;
  v_fingerprint text:=private.id_number_fingerprint(p_id_number);
BEGIN
  IF v_customer_id IS NULL AND v_fingerprint IS NOT NULL THEN
    SELECT c.id,c.first_time_borrower_rule_applicable,(c.existing_client_verified_at IS NOT NULL)
    INTO v_customer_id,v_rule_applicable,v_existing_verified
    FROM public.customers c
    JOIN private.id_number_fingerprints f ON f.entity_type='customer' AND f.entity_id=c.id AND f.fingerprint=v_fingerprint
    WHERE COALESCE(c.is_deleted,false)=false AND COALESCE(c.is_active,true)=true
    ORDER BY c.created_at DESC NULLS LAST LIMIT 1;
  ELSIF v_customer_id IS NOT NULL THEN
    SELECT c.first_time_borrower_rule_applicable,(c.existing_client_verified_at IS NOT NULL)
    INTO v_rule_applicable,v_existing_verified
    FROM public.customers c
    WHERE c.id=v_customer_id AND COALESCE(c.is_deleted,false)=false AND COALESCE(c.is_active,true)=true
      AND (v_fingerprint IS NULL OR EXISTS (
        SELECT 1 FROM private.id_number_fingerprints f
        WHERE f.entity_type='customer' AND f.entity_id=c.id AND f.fingerprint=v_fingerprint
      ));
    IF NOT FOUND THEN v_customer_id:=NULL; END IF;
  END IF;
  IF v_customer_id IS NULL THEN RETURN true; END IF;
  IF COALESCE(v_existing_verified,false) OR COALESCE(v_rule_applicable,false)=false THEN RETURN false; END IF;
  RETURN NOT EXISTS (
    SELECT 1 FROM public.loans l WHERE l.customer_id=v_customer_id
      AND COALESCE(l.is_deleted,false)=false
      AND COALESCE(l.total_paid,0)>=COALESCE(l.total_repayment,0)
      AND COALESCE(l.current_balance,0)<=0
  );
END;
$function$;

DO $$
DECLARE v_def text;
BEGIN
  v_def:=pg_get_functiondef('public.submit_loan_application(text,text,text,text,text,text,text,numeric,numeric,text,text,numeric,text,date,text,text,text)'::regprocedure);
  v_def:=replace(v_def,E'\r\n',E'\n');
  v_def:=replace(v_def,
$old$regexp_replace(
            COALESCE(c.id_number, ''),
            '[^0-9]',
            '',
            'g'
        ) = v_id_number$old$,
$new$EXISTS (
          SELECT 1 FROM private.id_number_fingerprints f
          WHERE f.entity_type='customer' AND f.entity_id=c.id
            AND f.fingerprint=private.id_number_fingerprint(v_id_number)
        )$new$);
  v_def:=replace(v_def,
$old$regexp_replace(
                    COALESCE(la.id_number, ''),
                    '[^0-9]',
                    '',
                    'g'
                ) = v_id_number$old$,
$new$EXISTS (
                  SELECT 1 FROM private.id_number_fingerprints f
                  WHERE f.entity_type='loan_application' AND f.entity_id=la.id
                    AND f.fingerprint=private.id_number_fingerprint(v_id_number)
                )$new$);
  IF position('COALESCE(c.id_number' in v_def)>0 OR position('COALESCE(la.id_number' in v_def)>0 THEN
    RAISE EXCEPTION 'Could not safely update all ID-number comparisons in submit_loan_application.';
  END IF;
  EXECUTE v_def;
END;
$$;
