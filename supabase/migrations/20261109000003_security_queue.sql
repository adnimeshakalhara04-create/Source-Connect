-- Security helpers, deny-by-default RLS, durable job queue, rate limits, Auth integration, photo bucket.
SET search_path = app, extensions;

-- ===========================================================================
-- Settings that change security behaviour (one row)
-- ===========================================================================
CREATE TABLE security_settings (
  id                int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  require_staff_mfa boolean NOT NULL DEFAULT true,   -- staff must sign in with a second factor (TOTP) to use admin functions
  updated_at        timestamptz NOT NULL DEFAULT now()
);
INSERT INTO security_settings (id) VALUES (1);

-- Operational settings set by the operator during deployment (never by the website).
-- PayHere secrets live in Edge Function secrets; this table only records that they are configured.
CREATE TABLE ops_settings (
  id                     int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  payhere_configured     boolean NOT NULL DEFAULT false,
  payhere_mode           text NOT NULL DEFAULT 'sandbox' CHECK (payhere_mode IN ('sandbox', 'live')),
  payhere_live_approved_by text,                  -- owner's name, recorded when the written approval is given
  payhere_live_approved_at timestamptz,
  reservation_minutes    int NOT NULL DEFAULT 30 CHECK (reservation_minutes BETWEEN 5 AND 240),
  bank_reservation_hours int NOT NULL DEFAULT 48 CHECK (bank_reservation_hours BETWEEN 1 AND 168),
  backup_max_age_hours   numeric NOT NULL DEFAULT 2 CHECK (backup_max_age_hours > 0),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- live payments are impossible unless the owner's approval is recorded
  CHECK (payhere_mode <> 'live' OR (payhere_live_approved_by IS NOT NULL AND payhere_live_approved_at IS NOT NULL))
);
INSERT INTO ops_settings (id) VALUES (1);

-- ===========================================================================
-- Durable job queue (Supabase -> VPS workers -> Supabase)
-- Jobs live in PostgreSQL, so a worker or VPS restart never loses them.
-- ===========================================================================
CREATE TABLE jobs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type          text NOT NULL CHECK (type ~ '^[a-z][a-z0-9_.]{2,60}$'),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key    text UNIQUE,                       -- the same work is never queued twice
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','dead')),
  priority      int NOT NULL DEFAULT 100,
  attempts      int NOT NULL DEFAULT 0,
  max_attempts  int NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 50),
  run_after     timestamptz NOT NULL DEFAULT now(),
  locked_by     text,
  locked_until  timestamptz,                       -- lease: an expired lease means the worker died; the job is retried
  last_error    text,
  result        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX jobs_ready_idx ON jobs (priority, id) WHERE status IN ('queued','running');
CREATE INDEX jobs_type_status_idx ON jobs (type, status);
CREATE TRIGGER jobs_upd BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION enqueue_job(p_type text, p_payload jsonb DEFAULT '{}'::jsonb, p_dedupe_key text DEFAULT NULL, p_run_after timestamptz DEFAULT now(), p_priority int DEFAULT 100)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO app.jobs (type, payload, dedupe_key, run_after, priority)
  VALUES (p_type, coalesce(p_payload, '{}'::jsonb), p_dedupe_key, p_run_after, p_priority)
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN SELECT id INTO v_id FROM app.jobs WHERE dedupe_key = p_dedupe_key; END IF;
  RETURN v_id;
END $$;

-- ===========================================================================
-- Rate limits for Edge Functions (fixed window per key)
-- ===========================================================================
CREATE TABLE rate_limits (
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  hits         int NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
CREATE FUNCTION hit_rate_limit(p_key text, p_max int, p_window_seconds int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_start timestamptz := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds); v_hits int;
BEGIN
  INSERT INTO app.rate_limits AS r (key, window_start, hits) VALUES (left(p_key, 200), v_start, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET hits = r.hits + 1
  RETURNING hits INTO v_hits;
  RETURN v_hits <= p_max;   -- true = allowed
END $$;

-- ===========================================================================
-- Who is calling? (Supabase Auth JWT -> staff permissions)
-- ===========================================================================
-- MFA level of the current session ('aal1' = password only, 'aal2' = password + TOTP)
CREATE FUNCTION current_aal() RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1')
$$;

CREATE FUNCTION current_staff_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.id FROM app.staff_users u WHERE u.id = auth.uid() AND u.status = 'active'
$$;

-- true when the signed-in staff member has the permission (and, if required, signed in with MFA)
CREATE FUNCTION has_perm(p_perm text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.staff_users u
      JOIN app.staff_roles sr ON sr.staff_id = u.id
      JOIN app.role_permissions rp ON rp.role_id = sr.role_id
     WHERE u.id = auth.uid() AND u.status = 'active' AND rp.permission = p_perm)
  AND (app.current_aal() = 'aal2' OR NOT (SELECT require_staff_mfa FROM app.security_settings WHERE id = 1))
$$;

-- department scope: staff whose roles are ALL shop-scoped may only touch their assigned shops
CREATE FUNCTION can_shop(p_shop uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM app.staff_roles sr JOIN app.roles r ON r.id = sr.role_id WHERE sr.staff_id = auth.uid() AND NOT r.shop_scoped)
      OR EXISTS (SELECT 1 FROM app.staff_shop_access a WHERE a.staff_id = auth.uid() AND a.shop_id = p_shop)
$$;

CREATE FUNCTION require_perm(p_perm text) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in.' USING ERRCODE = '28000'; END IF;
  IF app.current_staff_id() IS NULL THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  IF NOT app.has_perm(p_perm) THEN
    IF (SELECT require_staff_mfa FROM app.security_settings WHERE id = 1) AND app.current_aal() <> 'aal2' THEN
      RAISE EXCEPTION 'Sign in with your authenticator app (two-step verification) first.' USING ERRCODE = '42501', HINT = 'mfa_required';
    END IF;
    RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501';
  END IF;
END $$;

-- audit entry for the current caller
CREATE FUNCTION audit(p_action text, p_entity_type text, p_entity_id text, p_before jsonb DEFAULT NULL, p_after jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_label text; v_type text;
BEGIN
  SELECT username INTO v_label FROM app.staff_users WHERE id = auth.uid();
  v_type := CASE WHEN v_label IS NOT NULL THEN 'staff' WHEN auth.uid() IS NOT NULL THEN 'customer' ELSE coalesce(nullif(current_setting('app.actor_type', true), ''), 'system') END;
  INSERT INTO app.audit_logs (actor_type, actor_id, actor_label, action, entity_type, entity_id, before, after, request_id)
  VALUES (v_type, auth.uid()::text, coalesce(v_label, nullif(current_setting('app.actor_label', true), ''), ''), p_action, p_entity_type, p_entity_id,
          app.redact(p_before), app.redact(p_after), nullif(current_setting('app.request_id', true), ''));
END $$;

-- remove secrets from anything written to the audit log
CREATE FUNCTION redact(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p IS NULL THEN NULL
    WHEN jsonb_typeof(p) = 'object' THEN (
      SELECT coalesce(jsonb_object_agg(k, CASE WHEN k ~* 'pass(word)?|secret|token|hash|cookie|authorization|card_no|md5sig' THEN '"[redacted]"'::jsonb ELSE app.redact(v) END), '{}'::jsonb)
        FROM jsonb_each(p) AS e(k, v))
    WHEN jsonb_typeof(p) = 'array' THEN (SELECT coalesce(jsonb_agg(app.redact(x)), '[]'::jsonb) FROM jsonb_array_elements(p) AS a(x))
    WHEN jsonb_typeof(p) = 'string' AND p #>> '{}' LIKE 'data:%' AND length(p #>> '{}') > 200 THEN to_jsonb(left(p #>> '{}', 40) || '…[data-url]')
    ELSE p END
$$;

-- ===========================================================================
-- Supabase Auth integration: every new sign-up becomes a customer,
-- unless the admin-staff Edge Function created it as a staff account.
-- ===========================================================================
CREATE FUNCTION handle_new_auth_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(NEW.raw_app_meta_data ->> 'kind', '') <> 'staff' THEN
    INSERT INTO app.customers (id, email, phone, name)
    VALUES (NEW.id, NEW.email, nullif(NEW.raw_user_meta_data ->> 'phone', ''), left(coalesce(NEW.raw_user_meta_data ->> 'name', ''), 80))
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION app.handle_new_auth_user();

-- ===========================================================================
-- Deny by default: RLS on every table in `app`, no policies for browser roles.
-- (The `app` schema is not exposed by the REST API either; this is the second lock.)
-- ===========================================================================
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'app' LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
-- SECURITY DEFINER functions run as the table owner (postgres), which bypasses RLS only because it owns the tables.
-- FORCE would also apply RLS to the owner, so give the owner an explicit allow-all policy on each table.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'app' LOOP
    EXECUTE format('CREATE POLICY owner_all ON app.%I FOR ALL TO postgres USING (true) WITH CHECK (true)', t.tablename);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- VPS worker database role (least privilege). Its password is set outside migrations:
--   ALTER ROLE sc_worker WITH LOGIN PASSWORD '<from the password manager>';
-- It can only use the worker functions below and write backup status.
-- ===========================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sc_worker') THEN CREATE ROLE sc_worker NOLOGIN NOINHERIT; END IF;
END $$;
GRANT USAGE ON SCHEMA app TO sc_worker;

-- ===========================================================================
-- Product photo bucket: anyone can view, only catalogue/content staff can upload.
-- Size and type limits are enforced by Storage; the VPS worker re-checks the real bytes.
-- ===========================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-images', 'product-images', true, 4194304, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 4194304, allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

CREATE POLICY "staff upload product images" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images' AND (app.has_perm('catalog.write') OR app.has_perm('content.write'))
              AND name ~ '^products/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}\.(jpg|png|webp)$');
CREATE POLICY "staff delete product images" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-images' AND app.has_perm('catalog.write'));
-- the policy functions must be callable by signed-in users (they only answer true/false about the caller)
GRANT USAGE ON SCHEMA app TO authenticated;
GRANT EXECUTE ON FUNCTION app.has_perm(text), app.current_aal() TO authenticated;

-- every uploaded product photo is checked and optimised by a VPS worker
CREATE FUNCTION on_product_image_uploaded() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.bucket_id = 'product-images' THEN
    PERFORM app.enqueue_job('image.process', jsonb_build_object('bucket', NEW.bucket_id, 'name', NEW.name), 'image.process:' || NEW.name);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_image_uploaded AFTER INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION app.on_product_image_uploaded();
