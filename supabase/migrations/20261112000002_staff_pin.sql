-- Admin PIN as the second sign-in step (owner's choice), instead of the authenticator app code.
--
--   * security_settings.staff_second_step = 'totp' (authenticator app, the default) or 'pin'.
--   * Each staff member's PIN (4-8 digits) is stored only as a bcrypt hash; the owner sets it.
--   * After the password, the PIN is checked IN THE DATABASE (staff_verify_pin). A correct PIN marks only that
--     Supabase Auth session (the JWT's session_id) as verified for 12 hours; every admin function checks this
--     (has_perm / require_perm), exactly where the authenticator check was. Signing out or a new sign-in needs the PIN again.
--   * 5 wrong PINs lock that staff member's PIN for 15 minutes. Every PIN change, success and failure is in the audit log.
--   * A session that passed the authenticator app (aal2) is still accepted in PIN mode.
SET search_path = app, extensions;

ALTER TABLE app.security_settings ADD COLUMN staff_second_step text NOT NULL DEFAULT 'totp' CHECK (staff_second_step IN ('totp', 'pin'));

CREATE TABLE app.staff_pins (
  staff_id      uuid PRIMARY KEY REFERENCES app.staff_users(id) ON DELETE CASCADE,
  pin_hash      text NOT NULL,
  failed        int  NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  set_by        uuid REFERENCES app.staff_users(id) ON DELETE SET NULL
);
CREATE TABLE app.staff_pin_sessions (
  session_id   uuid PRIMARY KEY,                 -- Supabase Auth session (JWT claim session_id)
  staff_id     uuid NOT NULL REFERENCES app.staff_users(id) ON DELETE CASCADE,
  verified_at  timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff_pins', 'staff_pin_sessions'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY owner_all ON app.%I TO postgres USING (true) WITH CHECK (true)', t);
    EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;

-- the Supabase Auth session of the current request (NULL if missing or malformed)
CREATE FUNCTION app.jwt_session_id() RETURNS uuid LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN s ~ '^[0-9a-fA-F-]{36}$' THEN s::uuid END
    FROM (SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id' AS s) x
$$;

-- true when the current staff session has passed the second sign-in step (or none is required)
CREATE FUNCTION app.second_step_ok() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT NOT s.require_staff_mfa
      OR app.current_aal() = 'aal2'
      OR (s.staff_second_step = 'pin' AND EXISTS (
            SELECT 1 FROM app.staff_pin_sessions p
             WHERE p.session_id = app.jwt_session_id() AND p.staff_id = auth.uid() AND p.expires_at > now()))
    FROM app.security_settings s WHERE s.id = 1
$$;

-- same rules as before; the authenticator-only check is replaced by second_step_ok()
CREATE OR REPLACE FUNCTION app.has_perm(p_perm text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.staff_users u
      JOIN app.staff_roles sr ON sr.staff_id = u.id
      JOIN app.role_permissions rp ON rp.role_id = sr.role_id
     WHERE u.id = auth.uid() AND u.status = 'active' AND rp.permission = p_perm)
  AND app.second_step_ok()
  AND NOT app.must_change_password()
$$;

CREATE OR REPLACE FUNCTION app.require_perm(p_perm text) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in.' USING ERRCODE = '28000'; END IF;
  IF app.current_staff_id() IS NULL THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  IF NOT app.has_perm(p_perm) THEN
    IF app.must_change_password() THEN
      RAISE EXCEPTION 'Please set your own password first.' USING ERRCODE = '42501', HINT = 'password_change_required';
    END IF;
    IF NOT app.second_step_ok() THEN
      IF (SELECT staff_second_step FROM app.security_settings WHERE id = 1) = 'pin' THEN
        RAISE EXCEPTION 'Enter your admin PIN first.' USING ERRCODE = '42501', HINT = 'pin_required';
      END IF;
      RAISE EXCEPTION 'Sign in with your authenticator app (two-step verification) first.' USING ERRCODE = '42501', HINT = 'mfa_required';
    END IF;
    RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501';
  END IF;
END $$;

-- Who am I: also says which second step is in use and whether this session has passed it
CREATE OR REPLACE FUNCTION public.admin_me() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u record; v_require boolean; v_mode text; v_ok boolean;
BEGIN
  SELECT * INTO u FROM app.staff_users WHERE id = auth.uid();
  IF NOT FOUND OR u.status <> 'active' THEN PERFORM app.fail('forbidden', 'This account is not a staff account.'); END IF;
  SELECT require_staff_mfa, staff_second_step INTO v_require, v_mode FROM app.security_settings WHERE id = 1;
  v_ok := app.second_step_ok();
  UPDATE app.staff_users SET last_login_at = now() WHERE id = u.id AND (last_login_at IS NULL OR last_login_at < now() - interval '5 minutes');
  RETURN jsonb_build_object('username', u.username::text, 'displayName', u.display_name,
    'roles', coalesce((SELECT jsonb_agg(r.code ORDER BY r.code) FROM app.staff_roles sr JOIN app.roles r ON r.id = sr.role_id WHERE sr.staff_id = u.id), '[]'::jsonb),
    'permissions', CASE WHEN NOT v_ok THEN '[]'::jsonb ELSE coalesce((SELECT jsonb_agg(DISTINCT rp.permission ORDER BY rp.permission) FROM app.staff_roles sr JOIN app.role_permissions rp ON rp.role_id = sr.role_id WHERE sr.staff_id = u.id), '[]'::jsonb) END,
    'shops', CASE WHEN EXISTS (SELECT 1 FROM app.staff_roles sr JOIN app.roles r ON r.id = sr.role_id WHERE sr.staff_id = u.id AND NOT r.shop_scoped) THEN NULL
                  ELSE coalesce((SELECT jsonb_agg(s.slug) FROM app.staff_shop_access a JOIN app.shops s ON s.id = a.shop_id WHERE a.staff_id = u.id), '[]'::jsonb) END,
    'mfaRequired', v_require, 'aal', app.current_aal(), 'mustChangePassword', app.must_change_password(),
    'secondStep', v_mode, 'secondStepOk', v_ok, 'hasPin', EXISTS (SELECT 1 FROM app.staff_pins p WHERE p.staff_id = u.id));
END $$;

-- Check the PIN after the password. Never raises on a wrong PIN (so the failure count is saved); returns ok:false instead.
CREATE FUNCTION public.staff_verify_pin(p_pin text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_staff uuid := app.current_staff_id(); v_sess uuid := app.jwt_session_id(); p app.staff_pins; v_left int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in.' USING ERRCODE = '28000'; END IF;
  IF v_staff IS NULL THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  IF (SELECT staff_second_step FROM app.security_settings WHERE id = 1) <> 'pin' THEN
    PERFORM app.fail('bad_request', 'PIN sign-in is not switched on. Use your authenticator app.');
  END IF;
  IF v_sess IS NULL THEN PERFORM app.fail('bad_request', 'Sign in again, then enter your PIN.'); END IF;
  DELETE FROM app.staff_pin_sessions WHERE expires_at < now() - interval '1 day';
  SELECT * INTO p FROM app.staff_pins WHERE staff_id = v_staff FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'no_pin', 'message', 'No PIN has been set for you yet. Ask the owner to set one.'); END IF;
  IF p.locked_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'locked', 'message',
      'Too many wrong PINs. Try again in ' || greatest(1, ceil(extract(epoch FROM p.locked_until - now()) / 60))::int || ' minute(s).');
  END IF;
  IF coalesce(p_pin, '') ~ '^[0-9]{4,8}$' AND extensions.crypt(p_pin, p.pin_hash) = p.pin_hash THEN
    UPDATE app.staff_pins SET failed = 0, locked_until = NULL WHERE staff_id = v_staff;
    INSERT INTO app.staff_pin_sessions (session_id, staff_id, expires_at) VALUES (v_sess, v_staff, now() + interval '12 hours')
    ON CONFLICT (session_id) DO UPDATE SET staff_id = EXCLUDED.staff_id, verified_at = now(), expires_at = EXCLUDED.expires_at;
    PERFORM app.audit('staff.pin_ok', 'staff', v_staff::text);
    RETURN jsonb_build_object('ok', true);
  END IF;
  IF p.failed + 1 >= 5 THEN
    UPDATE app.staff_pins SET failed = 0, locked_until = now() + interval '15 minutes' WHERE staff_id = v_staff;
    PERFORM app.audit('staff.pin_locked', 'staff', v_staff::text);
    RETURN jsonb_build_object('ok', false, 'error', 'locked', 'message', 'Too many wrong PINs. Try again in 15 minute(s).');
  END IF;
  UPDATE app.staff_pins SET failed = p.failed + 1 WHERE staff_id = v_staff;
  PERFORM app.audit('staff.pin_failed', 'staff', v_staff::text);
  v_left := 5 - (p.failed + 1);
  RETURN jsonb_build_object('ok', false, 'error', 'wrong_pin', 'attemptsLeft', v_left,
    'message', 'Wrong PIN. ' || v_left || ' tr' || CASE WHEN v_left = 1 THEN 'y' ELSE 'ies' END || ' left before a 15-minute lock.');
END $$;

-- Owner sets (or removes, p_pin NULL) a staff member's PIN. The PIN itself is never stored or logged.
CREATE FUNCTION public.admin_set_staff_pin(p_staff_id uuid, p_pin text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user text;
BEGIN
  PERFORM app.require_perm('staff.manage');
  SELECT username::text INTO v_user FROM app.staff_users WHERE id = p_staff_id;
  IF NOT FOUND THEN PERFORM app.fail('not_found', 'Staff member not found.'); END IF;
  IF p_pin IS NULL OR p_pin = '' THEN
    IF p_staff_id = auth.uid() AND (SELECT staff_second_step FROM app.security_settings WHERE id = 1) = 'pin' THEN
      PERFORM app.fail('bad_request', 'Switch sign-in back to the authenticator app before removing your own PIN.');
    END IF;
    DELETE FROM app.staff_pins WHERE staff_id = p_staff_id;
    DELETE FROM app.staff_pin_sessions WHERE staff_id = p_staff_id;
    PERFORM app.audit('staff.pin_removed', 'staff', v_user);
    RETURN jsonb_build_object('ok', true, 'hasPin', false);
  END IF;
  IF p_pin !~ '^[0-9]{4,8}$' THEN PERFORM app.fail('bad_request', 'The PIN must be 4 to 8 digits.'); END IF;
  IF p_pin ~ '^(.)\1+$' OR position(p_pin IN '0123456789') > 0 OR position(p_pin IN '9876543210') > 0 THEN
    PERFORM app.fail('bad_request', 'That PIN is too easy to guess (same digit or 1234-style). Choose another.');
  END IF;
  INSERT INTO app.staff_pins (staff_id, pin_hash, set_by) VALUES (p_staff_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), app.staff_actor())
  ON CONFLICT (staff_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, failed = 0, locked_until = NULL, updated_at = now(), set_by = EXCLUDED.set_by;
  -- a changed PIN must be entered again everywhere, except in the owner's own current session
  DELETE FROM app.staff_pin_sessions WHERE staff_id = p_staff_id AND session_id IS DISTINCT FROM CASE WHEN p_staff_id = auth.uid() THEN app.jwt_session_id() END;
  PERFORM app.audit('staff.pin_set', 'staff', v_user);
  RETURN jsonb_build_object('ok', true, 'hasPin', true);
END $$;

-- Which second step staff use; who has a PIN (owner's Staff page)
CREATE FUNCTION public.admin_sign_in_settings() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app.require_perm('staff.manage');
  RETURN jsonb_build_object(
    'secondStep', (SELECT staff_second_step FROM app.security_settings WHERE id = 1),
    'required', (SELECT require_staff_mfa FROM app.security_settings WHERE id = 1),
    'withPin', coalesce((SELECT jsonb_agg(p.staff_id) FROM app.staff_pins p), '[]'::jsonb));
END $$;

CREATE FUNCTION public.admin_set_second_step(p_mode text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old text;
BEGIN
  PERFORM app.require_perm('staff.manage');
  IF coalesce(p_mode, '') NOT IN ('totp', 'pin') THEN PERFORM app.fail('bad_request', 'Choose the authenticator app or a PIN.'); END IF;
  IF p_mode = 'pin' AND NOT EXISTS (SELECT 1 FROM app.staff_pins WHERE staff_id = auth.uid()) THEN
    PERFORM app.fail('bad_request', 'Set your own PIN first, so you can still sign in.');
  END IF;
  SELECT staff_second_step INTO v_old FROM app.security_settings WHERE id = 1 FOR UPDATE;
  UPDATE app.security_settings SET staff_second_step = p_mode, updated_at = now() WHERE id = 1;
  -- the owner making the change stays signed in: their current session counts as verified in the new mode
  IF p_mode = 'pin' AND app.jwt_session_id() IS NOT NULL THEN
    INSERT INTO app.staff_pin_sessions (session_id, staff_id, expires_at) VALUES (app.jwt_session_id(), auth.uid(), now() + interval '12 hours')
    ON CONFLICT (session_id) DO NOTHING;
  END IF;
  PERFORM app.audit('security.second_step', 'settings', 'staff_second_step', jsonb_build_object('mode', v_old), jsonb_build_object('mode', p_mode));
  RETURN jsonb_build_object('ok', true, 'secondStep', p_mode);
END $$;

REVOKE ALL ON FUNCTION app.jwt_session_id(), app.second_step_ok(), public.staff_verify_pin(text), public.admin_set_staff_pin(uuid, text),
  public.admin_sign_in_settings(), public.admin_set_second_step(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_verify_pin(text), public.admin_set_staff_pin(uuid, text), public.admin_sign_in_settings(),
  public.admin_set_second_step(text) TO authenticated;
-- app.second_step_ok / app.jwt_session_id need no grant: they are only called from inside SECURITY DEFINER functions (has_perm, ...).
