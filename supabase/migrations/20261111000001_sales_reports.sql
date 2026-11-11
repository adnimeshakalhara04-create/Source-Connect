-- Sales & profit reports for the owner: what sold most / least each day, money taken, cost of goods and profit.
--
-- Cost prices are SECRET business data:
--   * they live in their own table (app.product_costs), never in the product JSON the website reads;
--   * only staff with `reports.view` can read them, only `costs.write` (owner) can change them;
--   * each order line keeps the cost AT THE TIME OF SALE (order_items.unit_cost_cents), so changing a cost later
--     never rewrites the profit of past sales.
SET search_path = app, extensions;

INSERT INTO app.permissions (code, description) VALUES
  ('reports.view', 'See sales reports, cost prices and profit'),
  ('costs.write',  'Set product cost prices (used for profit)')
ON CONFLICT (code) DO NOTHING;
INSERT INTO app.role_permissions (role_id, permission)
SELECT r.id, p FROM app.roles r, unnest(ARRAY['reports.view', 'costs.write']) p WHERE r.code = 'owner'
ON CONFLICT DO NOTHING;
INSERT INTO app.role_permissions (role_id, permission)
SELECT r.id, 'reports.view' FROM app.roles r WHERE r.code = 'finance'
ON CONFLICT DO NOTHING;

CREATE TABLE app.product_costs (
  product_id  uuid PRIMARY KEY REFERENCES app.products(id) ON DELETE CASCADE,
  cost_cents  bigint NOT NULL CHECK (cost_cents >= 0 AND cost_cents <= 1000000000),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES app.staff_users(id) ON DELETE SET NULL
);
ALTER TABLE app.product_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.product_costs FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON app.product_costs TO postgres USING (true) WITH CHECK (true);
REVOKE ALL ON app.product_costs FROM PUBLIC, anon, authenticated;

-- cost of one unit when the line was sold; NULL = no cost price was set at that time
ALTER TABLE app.order_items ADD COLUMN unit_cost_cents bigint CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0);

CREATE FUNCTION app.order_item_cost_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.unit_cost_cents IS NULL AND NEW.product_id IS NOT NULL THEN
    SELECT c.cost_cents INTO NEW.unit_cost_cents FROM app.product_costs c WHERE c.product_id = NEW.product_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_item_cost_snapshot BEFORE INSERT ON app.order_items FOR EACH ROW EXECUTE FUNCTION app.order_item_cost_snapshot();
REVOKE ALL ON FUNCTION app.order_item_cost_snapshot() FROM PUBLIC, anon, authenticated;

-- order_items is append-only (sold lines are never edited). When the owner sets a cost later and chooses to use it for
-- EARLIER sales that had none, the cost is written here instead; it never replaces a cost recorded at the time of sale.
CREATE TABLE app.order_item_cost_fills (
  order_item_id   uuid PRIMARY KEY REFERENCES app.order_items(id) ON DELETE RESTRICT,
  unit_cost_cents bigint NOT NULL CHECK (unit_cost_cents >= 0),
  filled_at       timestamptz NOT NULL DEFAULT now(),
  filled_by       uuid REFERENCES app.staff_users(id) ON DELETE SET NULL
);
CREATE TRIGGER order_item_cost_fills_ro BEFORE UPDATE OR DELETE ON app.order_item_cost_fills FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
ALTER TABLE app.order_item_cost_fills ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.order_item_cost_fills FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON app.order_item_cost_fills TO postgres USING (true) WITH CHECK (true);
REVOKE ALL ON app.order_item_cost_fills FROM PUBLIC, anon, authenticated;

-- Orders that count as a sale: placed and not cancelled / expired / refunded, and not an unpaid card checkout.
-- (Same rule as the dashboard's "Orders value". Bank-transfer and COD orders count; whether their money has
-- arrived is shown separately as "received" / "still to collect".)
CREATE FUNCTION app.is_sale(p_status text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_status NOT IN ('pending_payment', 'cancelled', 'expired', 'refunded')
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- The report. Dates are Sri Lanka calendar days (Asia/Colombo), both ends included, at most 366 days.
-- Money is returned in rupees (2 decimals). profit is NULL when any sold unit has no cost price, because a
-- profit figure that silently treats a missing cost as 0 would be wrong; costMissingUnits says how many.
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.admin_sales_report(p_from date, p_to date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb; v_start timestamptz; v_end timestamptz;
BEGIN
  PERFORM app.require_perm('reports.view');
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN PERFORM app.fail('bad_request', 'Choose a start date on or before the end date.'); END IF;
  IF p_to - p_from > 365 THEN PERFORM app.fail('bad_request', 'Choose at most one year.'); END IF;
  v_start := p_from::timestamp AT TIME ZONE 'Asia/Colombo';
  v_end := (p_to + 1)::timestamp AT TIME ZONE 'Asia/Colombo';

  WITH o AS (
    SELECT x.*, (x.placed_at AT TIME ZONE 'Asia/Colombo')::date AS day FROM app.orders x
     WHERE x.placed_at >= v_start AND x.placed_at < v_end AND app.staff_sees_order(x.id)),
  sold AS (SELECT * FROM o WHERE app.is_sale(o.status)),
  lines AS (
    SELECT i.product_id, i.product_slug, i.product_name, i.quantity, i.line_total_cents, c.unit_cost_cents, s.day,
           c.unit_cost_cents * i.quantity AS cost_cents
      FROM app.order_items i JOIN sold s ON s.id = i.order_id
      LEFT JOIN app.order_item_cost_fills f ON f.order_item_id = i.id
      CROSS JOIN LATERAL (SELECT coalesce(i.unit_cost_cents, f.unit_cost_cents) AS unit_cost_cents) c),
  -- per product (key: slug; name = current name if the product still exists, else the name at the time of sale)
  prod AS (
    SELECT l.product_slug AS slug, coalesce(max(p.name), max(l.product_name)) AS name,
           sum(l.quantity)::bigint AS units,
           sum(l.line_total_cents)::bigint AS sales, sum(l.cost_cents)::bigint AS cost,
           coalesce(sum(l.quantity) FILTER (WHERE l.unit_cost_cents IS NULL), 0)::bigint AS missing
      FROM lines l LEFT JOIN app.products p ON p.slug = l.product_slug
     GROUP BY l.product_slug),
  prod_json AS (
    SELECT slug, name, units, sales, jsonb_build_object('slug', slug, 'name', name, 'units', units, 'sales', app.rs(sales),
             'cost', CASE WHEN missing = 0 THEN app.rs(cost) END,
             'profit', CASE WHEN missing = 0 THEN app.rs(sales - cost) END,
             'marginPercent', CASE WHEN missing = 0 AND sales > 0 THEN round((sales - cost) * 100.0 / sales, 1) END,
             'costMissingUnits', missing) AS j
      FROM prod),
  -- products on sale now (active), with their units in the period (0 when nothing sold) - for "sold least"
  active AS (
    SELECT p.slug, p.name, coalesce(pr.units, 0) AS units, coalesce(pr.sales, 0) AS sales
      FROM app.products p LEFT JOIN prod pr ON pr.slug = p.slug
     WHERE p.status = 'active' AND (app.full_catalog_editor() OR app.can_shop(p.shop_id))),
  per_day_lines AS (
    SELECT l.day, sum(l.quantity)::bigint AS units, sum(l.line_total_cents)::bigint AS sales, sum(l.cost_cents)::bigint AS cost,
           coalesce(sum(l.quantity) FILTER (WHERE l.unit_cost_cents IS NULL), 0)::bigint AS missing
      FROM lines l GROUP BY l.day),
  per_day_orders AS (
    SELECT s.day, count(*)::int AS orders, sum(s.discount_cents)::bigint AS discounts, sum(s.shipping_cents)::bigint AS shipping
      FROM sold s GROUP BY s.day),
  best_per_day AS (
    SELECT DISTINCT ON (day) day, slug, name, units FROM (
      SELECT l.day, l.product_slug AS slug, coalesce(max(p.name), max(l.product_name)) AS name, sum(l.quantity)::bigint AS units, sum(l.line_total_cents) AS sales
        FROM lines l LEFT JOIN app.products p ON p.slug = l.product_slug GROUP BY l.day, l.product_slug) t
     ORDER BY day, units DESC, sales DESC, name),
  days AS (
    SELECT d::date AS day, coalesce(po.orders, 0) AS orders, coalesce(pl.units, 0) AS units, coalesce(pl.sales, 0) AS sales,
           coalesce(po.discounts, 0) AS discounts, coalesce(po.shipping, 0) AS shipping, coalesce(pl.cost, 0) AS cost,
           coalesce(pl.missing, 0) AS missing, b.slug AS best_slug, b.name AS best_name, b.units AS best_units
      FROM generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
      LEFT JOIN per_day_lines pl ON pl.day = d::date LEFT JOIN per_day_orders po ON po.day = d::date LEFT JOIN best_per_day b ON b.day = d::date),
  tot AS (
    SELECT (SELECT count(*) FROM sold)::int AS orders,
           (SELECT coalesce(sum(quantity), 0) FROM lines)::bigint AS units,
           (SELECT coalesce(sum(line_total_cents), 0) FROM lines)::bigint AS sales,
           (SELECT coalesce(sum(discount_cents), 0) FROM sold)::bigint AS discounts,
           (SELECT coalesce(sum(shipping_cents), 0) FROM sold)::bigint AS shipping,
           (SELECT coalesce(sum(total_cents), 0) FROM sold)::bigint AS total,
           (SELECT coalesce(sum(total_cents), 0) FROM sold WHERE payment_status IN ('paid', 'cod_collected'))::bigint AS received,
           (SELECT coalesce(sum(cost_cents), 0) FROM lines)::bigint AS cost,
           (SELECT coalesce(sum(quantity), 0) FROM lines WHERE unit_cost_cents IS NULL)::bigint AS missing,
           (SELECT coalesce(sum(line_total_cents - cost_cents), 0) FROM lines WHERE unit_cost_cents IS NOT NULL)::bigint AS profit_known,
           (SELECT count(*) FROM o WHERE status IN ('cancelled', 'expired', 'refunded'))::int AS closed_orders,
           (SELECT coalesce(sum(total_cents), 0) FROM o WHERE status IN ('cancelled', 'expired', 'refunded'))::bigint AS closed_value,
           (SELECT count(*) FROM o WHERE status = 'pending_payment')::int AS unpaid_card_orders,
           (SELECT coalesce(sum(rf.amount_cents), 0) FROM app.refunds rf JOIN o ON o.id = rf.order_id)::bigint AS refunds)
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to, 'timezone', 'Asia/Colombo', 'generatedAt', now(),
    'summary', jsonb_build_object(
      'orders', t.orders, 'units', t.units,
      'itemSales', app.rs(t.sales), 'discounts', app.rs(t.discounts), 'netSales', app.rs(t.sales - t.discounts),
      'shipping', app.rs(t.shipping), 'total', app.rs(t.total),
      'received', app.rs(t.received), 'toCollect', app.rs(t.total - t.received),
      'cost', CASE WHEN t.missing = 0 THEN app.rs(t.cost) END,
      'profit', CASE WHEN t.missing = 0 THEN app.rs(t.sales - t.discounts - t.cost) END,
      'marginPercent', CASE WHEN t.missing = 0 AND t.sales - t.discounts > 0 THEN round((t.sales - t.discounts - t.cost) * 100.0 / (t.sales - t.discounts), 1) END,
      'costMissingUnits', t.missing, 'profitOnItemsWithCost', app.rs(t.profit_known),
      'averageOrder', CASE WHEN t.orders > 0 THEN app.rs(round(t.total::numeric / t.orders)::bigint) ELSE 0 END,
      'closedOrders', t.closed_orders, 'closedValue', app.rs(t.closed_value), 'refunds', app.rs(t.refunds), 'unpaidCardOrders', t.unpaid_card_orders),
    'days', (SELECT coalesce(jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'orders', d.orders, 'units', d.units,
               'netSales', app.rs(d.sales - d.discounts), 'shipping', app.rs(d.shipping),
               'profit', CASE WHEN d.missing = 0 THEN app.rs(d.sales - d.discounts - d.cost) END, 'costMissingUnits', d.missing,
               'best', CASE WHEN d.best_slug IS NOT NULL THEN jsonb_build_object('slug', d.best_slug, 'name', d.best_name, 'units', d.best_units) END)
             ORDER BY d.day), '[]'::jsonb) FROM days d),
    'topProducts', (SELECT coalesce(jsonb_agg(j ORDER BY units DESC, sales DESC, name), '[]'::jsonb) FROM (SELECT * FROM prod_json ORDER BY units DESC, sales DESC, name LIMIT 10) x),
    'allProducts', (SELECT coalesce(jsonb_agg(j ORDER BY units DESC, sales DESC, name), '[]'::jsonb) FROM prod_json),
    'leastSold', (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'units', units, 'sales', app.rs(sales)) ORDER BY units, sales, name), '[]'::jsonb)
                    FROM (SELECT * FROM active ORDER BY units, sales, name LIMIT 10) x),
    'notSoldCount', (SELECT count(*) FROM active WHERE units = 0))
  INTO r FROM tot t;
  RETURN r;
END $$;

-- cost price list for the Reports page
CREATE FUNCTION public.admin_product_costs() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app.require_perm('reports.view');
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', p.slug, 'name', p.name, 'status', p.status, 'price', app.rs(p.price_cents),
            'cost', app.rs(c.cost_cents), 'updatedAt', c.updated_at) ORDER BY p.status = 'archived', p.name), '[]'::jsonb)
            FROM app.products p LEFT JOIN app.product_costs c ON c.product_id = p.id
           WHERE app.full_catalog_editor() OR app.can_shop(p.shop_id));
END $$;

-- Set (or clear, with NULL) a product's cost price. p_apply_to_past = also use it for EARLIER sales of this product that
-- had no cost recorded (never overwrites a cost recorded at the time of sale, nor an earlier fill-in).
CREATE FUNCTION public.admin_set_product_cost(p_slug text, p_cost numeric, p_apply_to_past boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_shop uuid; v_old bigint; v_new bigint; v_filled int := 0;
BEGIN
  PERFORM app.require_perm('costs.write');
  SELECT id, shop_id INTO v_id, v_shop FROM app.products WHERE slug = p_slug;
  IF NOT FOUND OR NOT (app.full_catalog_editor() OR app.can_shop(v_shop)) THEN PERFORM app.fail('not_found', 'Product not found.'); END IF;
  IF p_cost IS NOT NULL AND (p_cost < 0 OR p_cost > 10000000 OR p_cost * 100 <> round(p_cost * 100)) THEN
    PERFORM app.fail('bad_request', 'Cost must be between Rs. 0 and Rs. 10,000,000 with at most 2 decimals.');
  END IF;
  IF p_apply_to_past AND p_cost IS NULL THEN PERFORM app.fail('bad_request', 'Enter a cost before applying it to earlier sales.'); END IF;
  SELECT cost_cents INTO v_old FROM app.product_costs WHERE product_id = v_id FOR UPDATE;
  v_new := CASE WHEN p_cost IS NULL THEN NULL ELSE (p_cost * 100)::bigint END;
  IF v_new IS NULL THEN DELETE FROM app.product_costs WHERE product_id = v_id;
  ELSE
    INSERT INTO app.product_costs (product_id, cost_cents, updated_at, updated_by) VALUES (v_id, v_new, now(), app.staff_actor())
    ON CONFLICT (product_id) DO UPDATE SET cost_cents = EXCLUDED.cost_cents, updated_at = now(), updated_by = EXCLUDED.updated_by;
  END IF;
  IF p_apply_to_past THEN
    INSERT INTO app.order_item_cost_fills (order_item_id, unit_cost_cents, filled_by)
    SELECT i.id, v_new, app.staff_actor() FROM app.order_items i
     WHERE i.product_id = v_id AND i.unit_cost_cents IS NULL
    ON CONFLICT (order_item_id) DO NOTHING;
    GET DIAGNOSTICS v_filled = ROW_COUNT;
  END IF;
  PERFORM app.audit('product.cost', 'product', p_slug, jsonb_build_object('cost', app.rs(v_old)),
                    jsonb_build_object('cost', app.rs(v_new), 'appliedToEarlierSaleLines', v_filled));
  RETURN jsonb_build_object('ok', true, 'slug', p_slug, 'cost', app.rs(v_new), 'appliedToEarlierSaleLines', v_filled);
END $$;

REVOKE ALL ON FUNCTION public.admin_sales_report(date, date), public.admin_product_costs(), public.admin_set_product_cost(text, numeric, boolean),
  app.is_sale(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_sales_report(date, date), public.admin_product_costs(), public.admin_set_product_cost(text, numeric, boolean) TO authenticated;
