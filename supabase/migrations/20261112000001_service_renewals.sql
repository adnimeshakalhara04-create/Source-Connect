-- Service renewals: the owner records when paid services renew or a trial ends (Supabase Pro, VPS, domain, Cloudflare ...)
-- and the admin shows a warning from `remind_days` days before the date (default 1 = the day before) until the day itself.
--
--   * monthly / yearly: the date moves on by itself after it passes (these services charge the card automatically),
--     counted from the first date entered, so "31st" stays the last day of shorter months (31 Jan -> 28 Feb -> 31 Mar).
--   * once (a trial that ends, a one-time payment): the date stays; after it passes it shows as overdue
--     until the owner changes or removes it.
-- Days are Sri Lanka calendar days (Asia/Colombo). Only the owner (`renewals.manage`) can see or change them.
SET search_path = app, extensions;

INSERT INTO app.permissions (code, description) VALUES
  ('renewals.manage', 'See and change service renewal reminders (Supabase, VPS, domain ...)')
ON CONFLICT (code) DO NOTHING;
INSERT INTO app.role_permissions (role_id, permission)
SELECT r.id, 'renewals.manage' FROM app.roles r WHERE r.code = 'owner'
ON CONFLICT DO NOTHING;

CREATE TABLE app.service_renewals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  provider     text NOT NULL DEFAULT '' CHECK (length(provider) <= 60),
  first_due    date NOT NULL CHECK (first_due BETWEEN DATE '2020-01-01' AND DATE '2100-12-31'),
  cycle        text NOT NULL CHECK (cycle IN ('monthly', 'yearly', 'once')),
  remind_days  int  NOT NULL DEFAULT 1 CHECK (remind_days BETWEEN 0 AND 30),
  note         text NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES app.staff_users(id) ON DELETE SET NULL
);
CREATE TRIGGER service_renewals_upd BEFORE UPDATE ON app.service_renewals FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
ALTER TABLE app.service_renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.service_renewals FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON app.service_renewals TO postgres USING (true) WITH CHECK (true);
REVOKE ALL ON app.service_renewals FROM PUBLIC, anon, authenticated;

-- The next due date on or after p_today. Each step is counted from first_due (first_due + k months), never from the
-- previous step, so a date at the end of a month does not drift (31 Jan, 28/29 Feb, 31 Mar, 30 Apr ...).
CREATE FUNCTION app.renewal_due(p_first date, p_cycle text, p_today date) RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_step int; v_k int; v_d date;
BEGIN
  IF p_cycle = 'once' OR p_first >= p_today THEN RETURN p_first; END IF;
  v_step := CASE p_cycle WHEN 'monthly' THEN 1 WHEN 'yearly' THEN 12 ELSE NULL END;
  IF v_step IS NULL THEN RAISE EXCEPTION 'unknown cycle %', p_cycle; END IF;
  -- whole steps between the two dates, then at most one more so the result is on or after p_today
  v_k := ((extract(year FROM p_today)::int - extract(year FROM p_first)::int) * 12
          + extract(month FROM p_today)::int - extract(month FROM p_first)::int) / v_step;
  IF v_k < 0 THEN v_k := 0; END IF;
  v_d := (p_first + make_interval(months => v_k * v_step))::date;
  WHILE v_d < p_today LOOP
    v_k := v_k + 1;
    v_d := (p_first + make_interval(months => v_k * v_step))::date;
  END LOOP;
  RETURN v_d;
END $$;

CREATE FUNCTION app.colombo_today() RETURNS date LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (now() AT TIME ZONE 'Asia/Colombo')::date
$$;

CREATE FUNCTION app.renewal_json(r app.service_renewals, p_today date) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE v_due date := app.renewal_due(r.first_due, r.cycle, p_today); v_left int;
BEGIN
  v_left := v_due - p_today;
  RETURN jsonb_build_object(
    'id', r.id, 'name', r.name, 'provider', r.provider, 'cycle', r.cycle, 'firstDue', r.first_due,
    'dueOn', v_due, 'daysLeft', v_left, 'remindDays', r.remind_days, 'note', r.note, 'active', r.active,
    'status', CASE WHEN NOT r.active THEN 'off'
                   WHEN v_left < 0 THEN 'overdue'
                   WHEN v_left <= r.remind_days THEN 'due_soon'
                   ELSE 'ok' END);
END $$;

-- All reminders, soonest first, and how many need attention now (due soon or overdue).
CREATE FUNCTION public.admin_renewals() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_today date := app.colombo_today(); v_items jsonb;
BEGIN
  PERFORM app.require_perm('renewals.manage');
  SELECT coalesce(jsonb_agg(j ORDER BY (j ->> 'active')::boolean DESC, (j ->> 'dueOn')::date, j ->> 'name'), '[]'::jsonb) INTO v_items
    FROM (SELECT app.renewal_json(r, v_today) j FROM app.service_renewals r) x;
  RETURN jsonb_build_object('today', v_today, 'items', v_items,
    'alerts', (SELECT count(*) FROM jsonb_array_elements(v_items) e WHERE e ->> 'status' IN ('due_soon', 'overdue')));
END $$;

-- Add (p_id NULL) or change a reminder.
CREATE FUNCTION public.admin_save_renewal(p_id uuid, p_name text, p_provider text, p_due date, p_cycle text,
                                          p_remind_days int DEFAULT 1, p_note text DEFAULT '', p_active boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r app.service_renewals; v_before jsonb;
BEGIN
  PERFORM app.require_perm('renewals.manage');
  p_name := btrim(coalesce(p_name, '')); p_provider := btrim(coalesce(p_provider, '')); p_note := btrim(coalesce(p_note, ''));
  IF length(p_name) NOT BETWEEN 1 AND 60 THEN PERFORM app.fail('bad_request', 'Enter a name (up to 60 characters).'); END IF;
  IF length(p_provider) > 60 THEN PERFORM app.fail('bad_request', 'Provider name is too long (up to 60 characters).'); END IF;
  IF length(p_note) > 200 THEN PERFORM app.fail('bad_request', 'Note is too long (up to 200 characters).'); END IF;
  IF p_due IS NULL OR p_due NOT BETWEEN DATE '2020-01-01' AND DATE '2100-12-31' THEN PERFORM app.fail('bad_request', 'Choose a valid renewal date.'); END IF;
  IF coalesce(p_cycle, '') NOT IN ('monthly', 'yearly', 'once') THEN PERFORM app.fail('bad_request', 'Choose monthly, yearly or one time.'); END IF;
  IF p_remind_days IS NULL OR p_remind_days NOT BETWEEN 0 AND 30 THEN PERFORM app.fail('bad_request', 'Remind 0 to 30 days before.'); END IF;
  IF p_id IS NULL THEN
    INSERT INTO app.service_renewals (name, provider, first_due, cycle, remind_days, note, active, updated_by)
    VALUES (p_name, p_provider, p_due, p_cycle, p_remind_days, p_note, coalesce(p_active, true), app.staff_actor())
    RETURNING * INTO r;
  ELSE
    SELECT to_jsonb(s) - 'updated_at' - 'updated_by' - 'created_at' INTO v_before FROM app.service_renewals s WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN PERFORM app.fail('not_found', 'Reminder not found.'); END IF;
    UPDATE app.service_renewals SET name = p_name, provider = p_provider, first_due = p_due, cycle = p_cycle,
           remind_days = p_remind_days, note = p_note, active = coalesce(p_active, true), updated_by = app.staff_actor()
     WHERE id = p_id RETURNING * INTO r;
  END IF;
  PERFORM app.audit(CASE WHEN p_id IS NULL THEN 'renewal.create' ELSE 'renewal.update' END, 'renewal', r.id::text, v_before,
                    to_jsonb(r) - 'updated_at' - 'updated_by' - 'created_at');
  RETURN app.renewal_json(r, app.colombo_today());
END $$;

CREATE FUNCTION public.admin_delete_renewal(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_before jsonb;
BEGIN
  PERFORM app.require_perm('renewals.manage');
  DELETE FROM app.service_renewals s WHERE s.id = p_id RETURNING to_jsonb(s) - 'updated_at' - 'updated_by' - 'created_at' INTO v_before;
  IF v_before IS NULL THEN PERFORM app.fail('not_found', 'Reminder not found.'); END IF;
  PERFORM app.audit('renewal.delete', 'renewal', p_id::text, v_before, NULL);
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.admin_renewals(), public.admin_save_renewal(uuid, text, text, date, text, int, text, boolean),
  public.admin_delete_renewal(uuid), app.renewal_due(date, text, date), app.colombo_today(),
  app.renewal_json(app.service_renewals, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_renewals(), public.admin_save_renewal(uuid, text, text, date, text, int, text, boolean),
  public.admin_delete_renewal(uuid) TO authenticated;
