-- Catalogue reads and server-side pricing (ported from server/src/catalog.ts and server/src/orders/pricing.ts).
SET search_path = app, extensions;

CREATE FUNCTION rs(p_cents bigint) RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT round(p_cents / 100.0, 2) $$;
CREATE FUNCTION ms(p_t timestamptz) RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT (extract(epoch FROM p_t) * 1000)::bigint $$;

-- Products in the legacy storefront shape. `stock` = units available now (on hand - reserved).
CREATE FUNCTION legacy_products(p_include_inactive boolean DEFAULT false, p_slugs text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.created_at DESC, x.id), '[]'::jsonb) FROM (
    SELECT p.id, p.created_at, jsonb_build_object(
      'id', p.slug, 'name', p.name, 'category', c.slug, 'shop', s.slug, 'brand', p.brand, 'description', p.description,
      'shape', coalesce(p.visual ->> 'shape', 'tshirt'), 'pattern', coalesce(p.visual ->> 'pattern', 'solid'),
      'color', coalesce(p.visual ->> 'color', '#0b2a6f'), 'accent', coalesce(p.visual ->> 'accent', ''),
      'collections', coalesce((SELECT jsonb_agg(co.slug ORDER BY co.sort_order) FROM app.collection_products cp JOIN app.collections co ON co.id = cp.collection_id WHERE cp.product_id = p.id), '[]'::jsonb),
      'price', app.rs(p.price_cents), 'comparePrice', app.rs(p.compare_price_cents),
      'image', coalesce((SELECT im.url FROM app.product_images im WHERE im.product_id = p.id ORDER BY im.sort_order LIMIT 1), ''),
      'images', coalesce((SELECT jsonb_agg(im.url ORDER BY im.sort_order) FROM app.product_images im WHERE im.product_id = p.id), '[]'::jsonb),
      'sizes', coalesce((SELECT jsonb_agg(v.size ORDER BY v.sort_order, v.size) FROM app.product_variants v WHERE v.product_id = p.id AND v.active AND v.size <> ''), '[]'::jsonb),
      'variants', coalesce((SELECT jsonb_agg(jsonb_build_object('sku', v.sku, 'size', v.size, 'color', v.color, 'stock', greatest(0, i.on_hand - i.reserved),
                   'price', CASE WHEN v.price_cents IS NULL THEN NULL ELSE app.rs(v.price_cents) END) ORDER BY v.sort_order, v.size)
                 FROM app.product_variants v JOIN app.inventory i ON i.variant_id = v.id WHERE v.product_id = p.id AND v.active), '[]'::jsonb),
      'stock', coalesce((SELECT sum(greatest(0, i.on_hand - i.reserved)) FROM app.product_variants v JOIN app.inventory i ON i.variant_id = v.id WHERE v.product_id = p.id AND v.active), 0),
      'sold', p.sold_count, 'rating', p.rating, 'reviews', p.reviews_count, 'origin', p.origin_code, 'badge', p.badge,
      'flash', p.flash, 'featured', p.featured, 'status', p.status, 'createdAt', app.ms(p.created_at)) AS j
    FROM app.products p JOIN app.categories c ON c.id = p.category_id JOIN app.shops s ON s.id = p.shop_id
    WHERE (p_include_inactive OR p.status = 'active') AND (p_slugs IS NULL OR p.slug = ANY (p_slugs))) x
$$;

CREATE FUNCTION legacy_settings() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s jsonb; g record; f record; sh record; v_cod boolean; v_bank boolean; v_online boolean; v_bank_text text;
BEGIN
  SELECT value INTO s FROM app.site_content WHERE key = 'storefront';
  s := coalesce(s, '{}'::jsonb);
  SELECT * INTO g FROM app.globe_settings WHERE id = 1;
  SELECT * INTO f FROM app.flash_sale_rules WHERE id = 1;
  SELECT * INTO sh FROM app.shipping_rates WHERE code = 'standard';
  SELECT enabled INTO v_cod FROM app.payment_settings WHERE method = 'cod';
  SELECT enabled, instructions INTO v_bank, v_bank_text FROM app.payment_settings WHERE method = 'bank_transfer';
  SELECT enabled INTO v_online FROM app.payment_settings WHERE method = 'payhere';
  RETURN s || jsonb_build_object(
    'currency', coalesce(s ->> 'currency', 'Rs.'),
    'heroTitle', coalesce(g.hero_title, ''), 'heroSubtitle', coalesce(g.hero_subtitle, ''),
    'globeCities', to_jsonb(coalesce(g.cities, '{}'::text[])), 'globeStats', coalesce(g.stats, '[]'::jsonb), 'globeSteps', coalesce(g.steps, '[]'::jsonb),
    'flashTitle', coalesce(f.title, 'Flash Sale'), 'flashMode', coalesce(f.mode, 'daily'),
    'flashUntil', CASE WHEN f.ends_at IS NULL THEN '' ELSE to_char(f.ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') END,
    'shippingFee', CASE WHEN sh IS NULL THEN 0 ELSE app.rs(sh.fee_cents) END,
    'freeShipping', CASE WHEN sh.free_over_cents IS NULL THEN 0 ELSE app.rs(sh.free_over_cents) END,
    'payCOD', coalesce(v_cod, false), 'payBank', coalesce(v_bank, false), 'payOnline', coalesce(v_online, false),
    'bankDetails', coalesce(v_bank_text, ''),
    'paymentMethods', (SELECT coalesce(jsonb_agg(m), '[]'::jsonb) FROM unnest(ARRAY[
        CASE WHEN v_cod THEN 'Cash on Delivery' END, CASE WHEN v_bank THEN 'Bank Transfer' END, CASE WHEN v_online THEN 'Card (PayHere)' END]) m WHERE m IS NOT NULL),
    'localDays', coalesce((SELECT days FROM app.import_countries WHERE code = 'local'), '2–4'),
    'origins', coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.code, 'name', o.name, 'code', coalesce(o.iso2, ''), 'label', o.label, 'days', o.days, 'on', o.enabled) ORDER BY o.sort_order, o.code)
                         FROM app.import_countries o WHERE o.code <> 'local'), '[]'::jsonb));
END $$;

CREATE FUNCTION legacy_categories(p_include_hidden boolean DEFAULT false) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.slug, 'name', c.name, 'tagline', c.tagline, 'shape', c.shape, 'icon', c.icon_color,
           'image', coalesce(c.image_url, ''), 'shop', s.slug, 'hidden', c.status <> 'active') ORDER BY c.sort_order, c.name), '[]'::jsonb)
    FROM app.categories c JOIN app.shops s ON s.id = c.shop_id WHERE p_include_hidden OR c.status = 'active'
$$;

CREATE FUNCTION legacy_collections() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', co.slug, 'name', co.name, 'description', co.description, 'accent', co.accent,
           'image', coalesce(co.image_url, ''), 'homeRow', co.home_row)
         || CASE WHEN co.manual_order THEN jsonb_build_object('order', coalesce((SELECT jsonb_agg(p.slug ORDER BY cp.sort_order, p.created_at DESC)
                FROM app.collection_products cp JOIN app.products p ON p.id = cp.product_id WHERE cp.collection_id = co.id), '[]'::jsonb)) ELSE '{}'::jsonb END
         ORDER BY co.sort_order, co.name), '[]'::jsonb)
    FROM app.collections co
$$;

CREATE FUNCTION legacy_banners(p_include_inactive boolean DEFAULT false) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', h.public_id, 'eyebrow', h.eyebrow, 'title', h.title, 'subtitle', h.subtitle, 'cta', h.cta,
           'link', h.link, 'color', h.color, 'shape', h.shape, 'image', coalesce(h.image_url, '')) ORDER BY h.sort_order, h.public_id), '[]'::jsonb)
    FROM app.banners h WHERE p_include_inactive OR h.active
$$;

CREATE FUNCTION shops_json() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', slug, 'name', name, 'status', status) ORDER BY sort_order, name), '[]'::jsonb) FROM app.shops
$$;

-- ===========================================================================
-- Server-side pricing. Never trusts a price from the browser.
-- p_items: [{"id": "<product slug>", "size": "M", "qty": 2, "color": "..."(ignored)}]
-- With p_lock = true (inside checkout) inventory rows are locked FOR UPDATE in variant-id order:
-- concurrent checkouts cannot oversell and cannot deadlock.
-- ===========================================================================
CREATE FUNCTION validate_cart_items(p_items jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE it jsonb; k text; v_out jsonb := '[]'::jsonb; v_qty int; v_merged jsonb := '{}'::jsonb; v_key text;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'items must be a list' USING ERRCODE = '22023'; END IF;
  IF jsonb_array_length(p_items) > 50 THEN RAISE EXCEPTION 'too many items (max 50)' USING ERRCODE = '22023'; END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(it) <> 'object' THEN RAISE EXCEPTION 'each item must be an object' USING ERRCODE = '22023'; END IF;
    FOR k IN SELECT jsonb_object_keys(it) LOOP
      IF k NOT IN ('id', 'size', 'qty', 'color') THEN RAISE EXCEPTION 'unknown field in item: %', k USING ERRCODE = '22023'; END IF;
    END LOOP;
    IF coalesce(it ->> 'id', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(it ->> 'id') > 80 THEN RAISE EXCEPTION 'invalid product id' USING ERRCODE = '22023'; END IF;
    IF length(coalesce(it ->> 'size', '')) > 20 THEN RAISE EXCEPTION 'invalid size' USING ERRCODE = '22023'; END IF;
    BEGIN v_qty := (it ->> 'qty')::int; EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid quantity' USING ERRCODE = '22023'; END;
    IF v_qty IS NULL OR v_qty < 1 OR v_qty > 99 THEN RAISE EXCEPTION 'quantity must be 1 to 99' USING ERRCODE = '22023'; END IF;
    v_key := (it ->> 'id') || '|' || coalesce(it ->> 'size', '');
    v_merged := jsonb_set(v_merged, ARRAY[v_key], to_jsonb(least(99, coalesce((v_merged ->> v_key)::int, 0) + v_qty)));
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', split_part(key, '|', 1), 'size', substr(key, length(split_part(key, '|', 1)) + 2), 'qty', value::int)), '[]'::jsonb)
    INTO v_out FROM jsonb_each_text(v_merged);
  RETURN v_out;
END $$;

CREATE FUNCTION price_cart(p_items jsonb, p_coupon text DEFAULT NULL, p_lock boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_items jsonb := app.validate_cart_items(p_items);
  it jsonb; r record; v_avail int; v_qty int;
  v_lines jsonb := '[]'::jsonb; v_issues jsonb := '[]'::jsonb;
  v_sub bigint := 0; v_disc bigint := 0; v_ship bigint := 0;
  v_coupon record; v_coupon_json jsonb := NULL; v_coupon_err text := NULL;
  v_rate record; v_free bigint;
BEGIN
  IF p_lock THEN
    -- lock every inventory row this cart touches, in a fixed order
    PERFORM 1 FROM app.inventory i
      WHERE i.variant_id IN (SELECT v.id FROM app.products p JOIN app.product_variants v ON v.product_id = p.id
                              JOIN jsonb_array_elements(v_items) x ON p.slug = x ->> 'id' AND v.size = coalesce(x ->> 'size', ''))
      ORDER BY i.variant_id FOR UPDATE;
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    SELECT p.slug, v.size, v.id AS variant_id, p.id AS product_id, p.shop_id, v.sku, p.name, p.origin_code,
           coalesce(v.price_cents, p.price_cents) AS unit_cents, i.on_hand - i.reserved AS available
      INTO r
      FROM app.products p JOIN app.product_variants v ON v.product_id = p.id JOIN app.inventory i ON i.variant_id = v.id
     WHERE p.slug = it ->> 'id' AND v.size = coalesce(it ->> 'size', '') AND p.status = 'active' AND v.active;
    IF NOT FOUND THEN
      v_issues := v_issues || jsonb_build_object('id', it ->> 'id', 'size', it ->> 'size', 'problem', 'not_found'); CONTINUE;
    END IF;
    v_avail := greatest(0, r.available);
    IF v_avail <= 0 THEN
      v_issues := v_issues || jsonb_build_object('id', r.slug, 'size', r.size, 'problem', 'out_of_stock', 'available', 0); CONTINUE;
    END IF;
    v_qty := least((it ->> 'qty')::int, v_avail);
    IF v_qty < (it ->> 'qty')::int THEN
      v_issues := v_issues || jsonb_build_object('id', r.slug, 'size', r.size, 'problem', 'reduced', 'available', v_avail);
    END IF;
    v_lines := v_lines || jsonb_build_object('id', r.slug, 'size', r.size, 'qty', v_qty, 'requestedQty', (it ->> 'qty')::int,
      'variantId', r.variant_id, 'productId', r.product_id, 'shopId', r.shop_id, 'sku', r.sku, 'name', r.name, 'origin', r.origin_code,
      'unitCents', r.unit_cents, 'lineCents', r.unit_cents * v_qty, 'available', v_avail);
    v_sub := v_sub + r.unit_cents * v_qty;
  END LOOP;

  IF p_coupon IS NOT NULL AND btrim(p_coupon) <> '' THEN
    SELECT c.*, (SELECT count(*) FROM app.coupon_redemptions x WHERE x.coupon_id = c.id)::int AS used INTO v_coupon FROM app.coupons c WHERE lower(c.code::text) = lower(btrim(p_coupon));
    IF NOT FOUND OR NOT v_coupon.active THEN v_coupon_err := 'This promo code is not valid.';
    ELSIF v_coupon.starts_at IS NOT NULL AND v_coupon.starts_at > now() THEN v_coupon_err := 'This promo code is not active yet.';
    ELSIF v_coupon.ends_at IS NOT NULL AND v_coupon.ends_at < now() THEN v_coupon_err := 'This promo code has expired.';
    ELSIF v_coupon.max_redemptions IS NOT NULL AND v_coupon.used >= v_coupon.max_redemptions THEN v_coupon_err := 'This promo code has been fully used.';
    ELSIF v_sub < v_coupon.min_subtotal_cents THEN v_coupon_err := 'Spend at least Rs. ' || to_char(v_coupon.min_subtotal_cents / 100.0, 'FM999,999,990') || ' to use this code.';
    ELSE
      v_disc := CASE WHEN v_coupon.kind = 'percent' THEN floor(v_sub * v_coupon.value / 100.0)::bigint ELSE least(v_sub, v_coupon.value) END;
      v_coupon_json := jsonb_build_object('id', v_coupon.id, 'code', v_coupon.code::text);
    END IF;
  END IF;

  SELECT fee_cents, free_over_cents INTO v_rate FROM app.shipping_rates WHERE code = 'standard' AND active;
  v_free := v_rate.free_over_cents;
  IF jsonb_array_length(v_lines) > 0 AND v_rate IS NOT NULL THEN
    v_ship := CASE WHEN v_free IS NOT NULL AND v_free > 0 AND v_sub >= v_free THEN 0 ELSE v_rate.fee_cents END;
  END IF;
  RETURN jsonb_build_object('lines', v_lines, 'issues', v_issues, 'subtotalCents', v_sub, 'discountCents', v_disc, 'shippingCents', v_ship,
    'totalCents', v_sub - v_disc + v_ship, 'coupon', v_coupon_json, 'couponError', v_coupon_err, 'freeShippingOverCents', v_free);
END $$;

-- the quote as the website shows it (rupees, no internal ids)
CREATE FUNCTION quote_for_client(q jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('id', l ->> 'id', 'size', l ->> 'size', 'qty', (l ->> 'qty')::int, 'requestedQty', (l ->> 'requestedQty')::int,
              'sku', l ->> 'sku', 'name', l ->> 'name', 'price', app.rs((l ->> 'unitCents')::bigint), 'lineTotal', app.rs((l ->> 'lineCents')::bigint), 'available', (l ->> 'available')::int))
              FROM jsonb_array_elements(q -> 'lines') l), '[]'::jsonb),
    'issues', q -> 'issues', 'subtotal', app.rs((q ->> 'subtotalCents')::bigint), 'discount', app.rs((q ->> 'discountCents')::bigint),
    'shipping', app.rs((q ->> 'shippingCents')::bigint), 'total', app.rs((q ->> 'totalCents')::bigint),
    'coupon', q #>> '{coupon,code}', 'couponError', q ->> 'couponError',
    'freeShippingOver', CASE WHEN q ->> 'freeShippingOverCents' IS NULL THEN NULL ELSE app.rs((q ->> 'freeShippingOverCents')::bigint) END)
$$;

-- ===========================================================================
-- Public API (exposed through the Supabase REST API as /rest/v1/rpc/<name>)
-- ===========================================================================
CREATE FUNCTION public.storefront_snapshot() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('version', 4, 'source', 'supabase', 'settings', app.legacy_settings(), 'categories', app.legacy_categories(false),
    'collections', app.legacy_collections(), 'hero', app.legacy_banners(false), 'products', app.legacy_products(false, NULL), 'shops', app.shops_json())
$$;

CREATE FUNCTION public.search_products(p_q text DEFAULT NULL, p_category text DEFAULT NULL, p_shop text DEFAULT NULL, p_origin text DEFAULT NULL,
  p_sort text DEFAULT 'new', p_limit int DEFAULT 24, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_slugs text[]; v_total bigint;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 OR p_offset IS NULL OR p_offset < 0 OR p_offset > 10000 THEN RAISE EXCEPTION 'invalid paging' USING ERRCODE = '22023'; END IF;
  IF p_sort NOT IN ('new', 'price_asc', 'price_desc') THEN RAISE EXCEPTION 'invalid sort' USING ERRCODE = '22023'; END IF;
  IF length(coalesce(p_q, '')) > 80 THEN RAISE EXCEPTION 'search text too long' USING ERRCODE = '22023'; END IF;
  WITH m AS (
    SELECT p.slug, p.created_at, p.price_cents, p.id FROM app.products p JOIN app.categories c ON c.id = p.category_id JOIN app.shops s ON s.id = p.shop_id
     WHERE p.status = 'active'
       AND (p_q IS NULL OR p_q = '' OR p.search @@ plainto_tsquery('simple', p_q) OR p.name ILIKE '%' || replace(replace(p_q, '%', ''), '_', '') || '%')
       AND (p_category IS NULL OR c.slug = p_category) AND (p_shop IS NULL OR s.slug = p_shop) AND (p_origin IS NULL OR p.origin_code = p_origin))
  SELECT (SELECT count(*) FROM m),
         ARRAY(SELECT slug FROM m ORDER BY
           CASE WHEN p_sort = 'price_asc' THEN price_cents END ASC, CASE WHEN p_sort = 'price_desc' THEN price_cents END DESC,
           CASE WHEN p_sort = 'new' THEN created_at END DESC, id LIMIT p_limit OFFSET p_offset)
    INTO v_total, v_slugs;
  RETURN jsonb_build_object('total', v_total, 'items', coalesce((
    SELECT jsonb_agg(p ORDER BY array_position(v_slugs, p ->> 'id')) FROM jsonb_array_elements(app.legacy_products(false, v_slugs)) p), '[]'::jsonb));
END $$;

CREATE FUNCTION public.get_product(p_slug text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.legacy_products(false, ARRAY[p_slug]) -> 0
$$;

CREATE FUNCTION public.quote_cart(p_items jsonb, p_coupon text DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.quote_for_client(app.price_cart(p_items, p_coupon, false))
$$;

REVOKE ALL ON FUNCTION public.storefront_snapshot(), public.search_products(text, text, text, text, text, int, int), public.get_product(text), public.quote_cart(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storefront_snapshot(), public.search_products(text, text, text, text, text, int, int), public.get_product(text), public.quote_cart(jsonb, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storefront_snapshot() TO sc_worker;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.has_perm(text), app.current_aal(), app.must_change_password() TO authenticated;
