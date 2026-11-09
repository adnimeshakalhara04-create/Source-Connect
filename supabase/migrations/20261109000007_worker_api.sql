-- VPS worker API. The `sc_worker` database role (used by the VPS) can call only these functions.
SET search_path = app, extensions;

-- Claim up to p_limit ready jobs of the given types. A job whose lease expired (worker crashed) is claimed again.
CREATE FUNCTION worker_claim_jobs(p_worker text, p_types text[], p_limit int DEFAULT 1, p_lease_seconds int DEFAULT 300)
RETURNS SETOF app.jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_limit NOT BETWEEN 1 AND 50 OR p_lease_seconds NOT BETWEEN 10 AND 7200 THEN RAISE EXCEPTION 'invalid claim'; END IF;
  RETURN QUERY
  UPDATE app.jobs j SET status = 'running', attempts = j.attempts + 1, locked_by = left(p_worker, 100), locked_until = now() + make_interval(secs => p_lease_seconds)
   WHERE j.id IN (SELECT id FROM app.jobs
                   WHERE type = ANY (p_types)
                     AND ((status = 'queued' AND run_after <= now()) OR (status = 'running' AND locked_until < now()))
                   ORDER BY priority, id LIMIT p_limit FOR UPDATE SKIP LOCKED)
  RETURNING j.*;
END $$;

-- Mark done (only the worker that holds the lease can).
CREATE FUNCTION worker_complete_job(p_id bigint, p_worker text, p_result jsonb DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  UPDATE app.jobs SET status = 'done', result = p_result, finished_at = now(), locked_until = NULL, last_error = NULL
   WHERE id = p_id AND status = 'running' AND locked_by = left(p_worker, 100);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;

-- Failure: retry later with exponential backoff, or move to "dead" after max_attempts (shown in the admin Backups page).
CREATE FUNCTION worker_fail_job(p_id bigint, p_worker text, p_error text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j app.jobs;
BEGIN
  SELECT * INTO j FROM app.jobs WHERE id = p_id AND status = 'running' AND locked_by = left(p_worker, 100) FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_owner'; END IF;
  IF j.attempts >= j.max_attempts THEN
    UPDATE app.jobs SET status = 'dead', last_error = left(p_error, 2000), finished_at = now(), locked_until = NULL WHERE id = p_id;
    RETURN 'dead';
  END IF;
  UPDATE app.jobs SET status = 'queued', last_error = left(p_error, 2000), locked_until = NULL, locked_by = NULL,
         run_after = now() + make_interval(secs => least(3600, (power(2, j.attempts) * 15)::int)) WHERE id = p_id;
  RETURN 'retry';
END $$;

CREATE FUNCTION worker_enqueue(p_type text, p_payload jsonb, p_dedupe_key text DEFAULT NULL) RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.enqueue_job(p_type, p_payload, p_dedupe_key)
$$;

CREATE FUNCTION worker_record_backup(p_kind text, p_status text, p_started timestamptz, p_detail jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO app.backup_job_status (kind, status, started_at, finished_at, detail)
  VALUES (p_kind, p_status, p_started, CASE WHEN p_status = 'running' THEN NULL ELSE now() END, coalesce(p_detail, '{}'::jsonb))
$$;

-- what workers need to read for their jobs
CREATE FUNCTION worker_order_for_email(p_number text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.order_view(o.id, true) || jsonb_build_object('email', o.ship_email::text) FROM app.orders o WHERE o.order_number = p_number
$$;
CREATE FUNCTION worker_queue_stats() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('queued', count(*) FILTER (WHERE status = 'queued'), 'running', count(*) FILTER (WHERE status = 'running'),
    'dead', count(*) FILTER (WHERE status = 'dead'), 'oldest_queued_seconds', coalesce(extract(epoch FROM now() - min(created_at) FILTER (WHERE status = 'queued'))::int, 0))
  FROM app.jobs
$$;
-- keep the queue table small: finished jobs older than 30 days are removed (dead jobs are kept for inspection)
SELECT cron.schedule('prune-finished-jobs', '23 3 * * *', $$DELETE FROM app.jobs WHERE status = 'done' AND finished_at < now() - interval '30 days'$$);

-- rate limit counter for the Edge Functions (service role only)
CREATE FUNCTION public.hit_rate_limit_public(p_key text, p_max int, p_window_seconds int) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.hit_rate_limit(p_key, p_max, p_window_seconds)
$$;
REVOKE ALL ON FUNCTION public.hit_rate_limit_public(text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hit_rate_limit_public(text, int, int) TO service_role;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.has_perm(text), app.current_aal(), app.must_change_password() TO authenticated;
GRANT EXECUTE ON FUNCTION app.worker_claim_jobs(text, text[], int, int), app.worker_complete_job(bigint, text, jsonb), app.worker_fail_job(bigint, text, text),
  app.worker_enqueue(text, jsonb, text), app.worker_record_backup(text, text, timestamptz, jsonb), app.worker_order_for_email(text), app.worker_queue_stats() TO sc_worker;
