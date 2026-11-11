-- Checks run on a RESTORED copy of the Supabase database. Any failure stops with an error (psql ON_ERROR_STOP).
\set ON_ERROR_STOP on
DO $$
DECLARE n bigint;
BEGIN
  -- business data is consistent
  SELECT count(*) INTO n FROM app.inventory WHERE on_hand < 0 OR reserved < 0 OR reserved > on_hand; IF n > 0 THEN RAISE EXCEPTION 'impossible stock rows: %', n; END IF;
  SELECT count(*) INTO n FROM app.product_variants v WHERE NOT EXISTS (SELECT 1 FROM app.inventory i WHERE i.variant_id = v.id); IF n > 0 THEN RAISE EXCEPTION 'variants without inventory: %', n; END IF;
  SELECT count(*) INTO n FROM app.orders WHERE total_cents <> subtotal_cents - discount_cents + shipping_cents; IF n > 0 THEN RAISE EXCEPTION 'order totals wrong: %', n; END IF;
  SELECT count(*) INTO n FROM app.orders o WHERE o.subtotal_cents <> (SELECT coalesce(sum(line_total_cents), 0) FROM app.order_items i WHERE i.order_id = o.id); IF n > 0 THEN RAISE EXCEPTION 'order lines do not add up: %', n; END IF;
  SELECT count(*) INTO n FROM app.orders o WHERE o.payment_status = 'paid' AND NOT EXISTS (SELECT 1 FROM app.payments p WHERE p.order_id = o.id AND p.status IN ('paid','verified','refunded','chargeback')); IF n > 0 THEN RAISE EXCEPTION 'paid orders without a payment: %', n; END IF;
  SELECT count(*) INTO n FROM app.orders o WHERE NOT EXISTS (SELECT 1 FROM app.order_status_history h WHERE h.order_id = o.id); IF n > 0 THEN RAISE EXCEPTION 'orders without history: %', n; END IF;
  SELECT count(*) INTO n FROM app.inventory i
   WHERE i.reserved <> coalesce((SELECT sum(r.quantity) FROM app.stock_reservations r WHERE r.variant_id = i.variant_id AND r.state = 'active'), 0);
  IF n > 0 THEN RAISE EXCEPTION 'reserved stock does not match active reservations: %', n; END IF;
  -- accounts: staff and customers still linked to their sign-in accounts
  SELECT count(*) INTO n FROM app.staff_users s WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = s.id); IF n > 0 THEN RAISE EXCEPTION 'staff without sign-in account: %', n; END IF;
  SELECT count(*) INTO n FROM app.staff_users u WHERE u.status = 'active' AND EXISTS (SELECT 1 FROM app.staff_roles sr JOIN app.roles r ON r.id = sr.role_id WHERE sr.staff_id = u.id AND r.code = 'owner');
  IF n < 1 THEN RAISE EXCEPTION 'no active owner account'; END IF;
  -- security came back with the data: every app table has forced row level security, nothing granted to the website roles
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'app' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF n > 0 THEN RAISE EXCEPTION 'app tables without forced RLS: %', n; END IF;
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'app' AND c.relkind = 'r'
     AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT')); IF n > 0 THEN RAISE EXCEPTION 'app tables readable by website roles: %', n; END IF;
  IF has_function_privilege('anon', 'public.place_order(jsonb, uuid, text, text)', 'EXECUTE') THEN RAISE EXCEPTION 'place_order callable by anon'; END IF;
  IF NOT has_function_privilege('anon', 'public.storefront_snapshot()', 'EXECUTE') THEN RAISE EXCEPTION 'storefront not callable by anon'; END IF;
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname IN ('app', 'public') AND p.prosecdef AND p.proconfig IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'SECURITY DEFINER functions without a fixed search_path: %', n; END IF;
  -- the scheduled jobs (reservation expiry) are back
  SELECT count(*) INTO n FROM cron.job WHERE jobname = 'release-expired-reservations'; IF n <> 1 THEN RAISE EXCEPTION 'reservation expiry job missing'; END IF;
  -- a real order view can be built (functions work on the restored data)
  PERFORM app.order_view(id, true) FROM app.orders ORDER BY placed_at DESC LIMIT 5;
END $$;
