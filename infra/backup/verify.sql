-- Consistency checks run on a RESTORED copy. Any failed check stops the script with an error.
\set ON_ERROR_STOP on
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM schema_migrations; IF n < 2 THEN RAISE EXCEPTION 'migrations missing'; END IF;
  SELECT count(*) INTO n FROM inventory WHERE on_hand < 0 OR reserved < 0 OR reserved > on_hand; IF n > 0 THEN RAISE EXCEPTION 'impossible stock rows: %', n; END IF;
  SELECT count(*) INTO n FROM product_variants v WHERE NOT EXISTS (SELECT 1 FROM inventory i WHERE i.variant_id = v.id); IF n > 0 THEN RAISE EXCEPTION 'variants without inventory: %', n; END IF;
  SELECT count(*) INTO n FROM orders o WHERE total_cents <> subtotal_cents - discount_cents + shipping_cents; IF n > 0 THEN RAISE EXCEPTION 'order totals wrong: %', n; END IF;
  SELECT count(*) INTO n FROM orders o WHERE o.subtotal_cents <> (SELECT coalesce(sum(line_total_cents),0) FROM order_items i WHERE i.order_id = o.id); IF n > 0 THEN RAISE EXCEPTION 'order lines do not add up: %', n; END IF;
  SELECT count(*) INTO n FROM orders o WHERE o.payment_status = 'paid' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status IN ('paid','verified','refunded','chargeback')); IF n > 0 THEN RAISE EXCEPTION 'paid orders without a payment: %', n; END IF;
  SELECT count(*) INTO n FROM stock_reservations r JOIN inventory i ON i.variant_id = r.variant_id WHERE r.state = 'active' GROUP BY r.variant_id, i.reserved HAVING sum(r.quantity) <> i.reserved LIMIT 1;
  IF n IS NOT NULL AND n > 0 THEN RAISE EXCEPTION 'reserved stock does not match active reservations'; END IF;
  SELECT count(*) INTO n FROM staff_users u WHERE u.status = 'active' AND EXISTS (SELECT 1 FROM staff_roles sr JOIN roles r ON r.id = sr.role_id WHERE sr.staff_id = u.id AND r.code = 'owner');
  IF n < 1 THEN RAISE EXCEPTION 'no active owner account'; END IF;
END $$;
SELECT json_build_object(
  'products', (SELECT count(*) FROM products), 'variants', (SELECT count(*) FROM product_variants),
  'stock_units', (SELECT coalesce(sum(on_hand),0) FROM inventory), 'orders', (SELECT count(*) FROM orders),
  'paid_orders', (SELECT count(*) FROM orders WHERE payment_status IN ('paid','cod_collected')),
  'payments', (SELECT count(*) FROM payments), 'payment_events', (SELECT count(*) FROM payment_events),
  'staff', (SELECT count(*) FROM staff_users), 'role_grants', (SELECT count(*) FROM role_permissions),
  'audit_rows', (SELECT count(*) FROM audit_logs), 'newest_order', (SELECT max(placed_at) FROM orders))::text;
