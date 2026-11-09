-- Row counts of the tables that only grow (orders, payments, audit). Taken just BEFORE each dump and again after a
-- restore: the restored copy must have at least as many rows. Prints one JSON line.
-- security_fingerprint = hash of every permission that protects the data (function grants, SECURITY DEFINER + search_path,
-- table grants, row level security flags, policies). A restore must reproduce it EXACTLY.
SELECT json_build_object(
  'orders', (SELECT count(*) FROM app.orders), 'order_items', (SELECT count(*) FROM app.order_items),
  'payments', (SELECT count(*) FROM app.payments), 'payment_events', (SELECT count(*) FROM app.payment_events),
  'order_status_history', (SELECT count(*) FROM app.order_status_history), 'audit_logs', (SELECT count(*) FROM app.audit_logs),
  'products', (SELECT count(*) FROM app.products), 'variants', (SELECT count(*) FROM app.product_variants),
  'customers', (SELECT count(*) FROM app.customers), 'staff', (SELECT count(*) FROM app.staff_users),
  'auth_users', (SELECT count(*) FROM auth.users), 'storage_objects', (SELECT count(*) FROM storage.objects),
  'newest_order', (SELECT max(placed_at) FROM app.orders),
  'security_fingerprint', (SELECT md5(string_agg(line, '|' ORDER BY line)) FROM (
    -- effective privileges (who may do what), so "default" and an equivalent explicit owner-only list compare equal
    SELECT format('F %s.%s(%s) acl=%s def=%s cfg=%s', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
             (SELECT string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' ORDER BY a.grantee::regrole::text, a.privilege_type)
                FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), p.prosecdef, p.proconfig) AS line
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('app', 'public')
    UNION ALL
    SELECT format('T %s.%s acl=%s rls=%s/%s', n.nspname, c.relname,
             (SELECT string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' ORDER BY a.grantee::regrole::text, a.privilege_type)
                FROM aclexplode(coalesce(c.relacl, acldefault(CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END::"char", c.relowner))) a),
             c.relrowsecurity, c.relforcerowsecurity)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('app', 'public') AND c.relkind IN ('r', 'v', 'S')
    UNION ALL
    SELECT format('P %s.%s %s %s %s %s %s', schemaname, tablename, policyname, cmd, roles, qual, with_check)
      FROM pg_policies WHERE schemaname IN ('app', 'storage')) x))::text;
