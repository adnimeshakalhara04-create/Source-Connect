-- Staff (admin) and customer functions (ported from server/src/routes/admin/*.ts and routes/public/customers.ts).
-- Every admin function starts with app.require_perm(...): permission AND (if required) MFA are checked in the database.
SET search_path = app, extensions;

-- ---------- validation helpers ----------
CREATE FUNCTION v_text(p jsonb, p_key text, p_max int, p_min int DEFAULT 0, p_default text DEFAULT '') RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v text;
BEGIN
  IF p IS NULL OR NOT p ? p_key OR p -> p_key = 'null'::jsonb THEN v := p_default;
  ELSIF jsonb_typeof(p -> p_key) <> 'string' THEN PERFORM app.fail('bad_request', p_key || ' must be text');
  ELSE v := btrim(p ->> p_key); END IF;
  IF length(coalesce(v, '')) > p_max THEN PERFORM app.fail('bad_request', p_key || ' is too long (max ' || p_max || ')'); END IF;
  IF length(coalesce(v, '')) < p_min THEN PERFORM app.fail('bad_request', p_key || ' is required'); END IF;
  RETURN v;
END $$;
CREATE FUNCTION v_money(p jsonb, p_key text, p_default bigint, p_positive boolean) RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE n numeric;
BEGIN
  IF p IS NULL OR NOT p ? p_key OR p -> p_key = 'null'::jsonb THEN RETURN p_default; END IF;
  IF jsonb_typeof(p -> p_key) <> 'number' THEN PERFORM app.fail('bad_request', p_key || ' must be a number'); END IF;
  n := (p ->> p_key)::numeric;
  IF n < 0 OR n > 10000000 OR (p_positive AND n <= 0) THEN PERFORM app.fail('bad_request', CASE WHEN p_positive THEN p_key || ' must be more than 0' ELSE p_key || ' is out of range' END); END IF;
  RETURN round(n * 100)::bigint;
END $$;
CREATE FUNCTION v_bool(p jsonb, p_key text, p_default boolean) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p IS NULL OR NOT p ? p_key OR p -> p_key = 'null'::jsonb THEN RETURN p_default; END IF;
  IF jsonb_typeof(p -> p_key) <> 'boolean' THEN PERFORM app.fail('bad_request', p_key || ' must be true or false'); END IF;
  RETURN (p ->> p_key)::boolean;
END $$;
CREATE FUNCTION v_match(p_value text, p_re text, p_what text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN IF p_value !~ p_re THEN PERFORM app.fail('bad_request', p_what); END IF; RETURN p_value; END $$;
CREATE FUNCTION v_text_array(p jsonb, p_key text, p_max_items int, p_re text, p_what text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE a text[] := '{}'; x jsonb;
BEGIN
  IF p IS NULL OR NOT p ? p_key OR p -> p_key = 'null'::jsonb THEN RETURN a; END IF;
  IF jsonb_typeof(p -> p_key) <> 'array' THEN PERFORM app.fail('bad_request', p_key || ' must be a list'); END IF;
  IF jsonb_array_length(p -> p_key) > p_max_items THEN PERFORM app.fail('bad_request', p_key || ': at most ' || p_max_items); END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(p -> p_key) LOOP
    IF jsonb_typeof(x) <> 'string' OR btrim(x #>> '{}') !~ p_re THEN PERFORM app.fail('bad_request', p_what); END IF;
    a := a || btrim(x #>> '{}');
  END LOOP;
  RETURN a;
END $$;
CREATE FUNCTION staff_actor() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT app.current_staff_id() $$;
CREATE FUNCTION staff_label() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT coalesce((SELECT username::text FROM app.staff_users WHERE id = auth.uid()), '') $$;

-- ===========================================================================
-- Who am I (admin start-up)
-- ===========================================================================
CREATE FUNCTION public.admin_me() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u record; v_require boolean;
BEGIN
  SELECT * INTO u FROM app.staff_users WHERE id = auth.uid();
  IF NOT FOUND OR u.status <> 'active' THEN PERFORM app.fail('forbidden', 'This account is not a staff account.'); END IF;
  SELECT require_staff_mfa INTO v_require FROM app.security_settings WHERE id = 1;
  UPDATE app.staff_users SET last_login_at = now() WHERE id = u.id AND (last_login_at IS NULL OR last_login_at < now() - interval '5 minutes');
  RETURN jsonb_build_object('username', u.username::text, 'displayName', u.display_name,
    'roles', coalesce((SELECT jsonb_agg(r.code ORDER BY r.code) FROM app.staff_roles sr JOIN app.roles r ON r.id = sr.role_id WHERE sr.staff_id = u.id), '[]'::jsonb),
    'permissions', CASE WHEN v_require AND app.current_aal() <> 'aal2' THEN '[]'::jsonb ELSE coalesce((SELECT jsonb_agg(DISTINCT rp.permission ORDER BY rp.permission) FROM app.staff_roles sr JOIN app.role_permissions rp ON rp.role_id = sr.role_id WHERE sr.staff_id = u.id), '[]'::jsonb) END,
    'shops', CASE WHEN EXISTS (SELECT 1 FROM app.staff_roles sr JOIN app.roles r ON r.id = sr.role_id WHERE sr.staff_id = u.id AND NOT r.shop_scoped) THEN NULL
                  ELSE coalesce((SELECT jsonb_agg(s.slug) FROM app.staff_shop_access a JOIN app.shops s ON s.id = a.shop_id WHERE a.staff_id = u.id), '[]'::jsonb) END,
    'mfaRequired', v_require, 'aal', app.current_aal());
END $$;

-- ===========================================================================
-- Catalogue
-- ===========================================================================
CREATE FUNCTION public.admin_state() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_products jsonb;
BEGIN
  PERFORM app.require_perm('catalog.read');
  SELECT coalesce(jsonb_agg(p || jsonb_build_object('stockDetail', coalesce((
           SELECT jsonb_agg(jsonb_build_object('sku', v.sku, 'size', v.size, 'active', v.active, 'onHand', i.on_hand, 'reserved', i.reserved, 'reorder', i.reorder_level) ORDER BY v.sort_order)
             FROM app.product_variants v JOIN app.products pr ON pr.id = v.product_id JOIN app.inventory i ON i.variant_id = v.id WHERE pr.slug = p ->> 'id'), '[]'::jsonb))), '[]'::jsonb)
    INTO v_products FROM jsonb_array_elements(app.legacy_products(true, NULL)) p WHERE p ->> 'status' <> 'archived';
  RETURN jsonb_build_object('version', 4, 'source', 'supabase', 'settings', app.legacy_settings(), 'categories', app.legacy_categories(true),
    'collections', app.legacy_collections(), 'hero', app.legacy_banners(true), 'shops', app.shops_json(), 'products', v_products, 'me', public.admin_me());
END $$;

CREATE FUNCTION sku_for(p_slug text, p_size text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT left(btrim(regexp_replace(upper(p_slug || CASE WHEN p_size <> '' THEN '-' || p_size ELSE '' END), '[^A-Z0-9]+', '-', 'g'), '-'), 64)
$$;
CREATE FUNCTION slugify(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(nullif(left(btrim(regexp_replace(lower(p), '[^a-z0-9]+', '-', 'g'), '-'), 60), ''), 'item')
$$;

CREATE FUNCTION sync_variants(p_product uuid, p_slug text, p_sizes text[], p_initial jsonb, p_staff uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE want text[]; s text; i int := 0; ex record; v_sku text; n int; v_id uuid; v_qty int;
BEGIN
  SELECT coalesce(array_agg(DISTINCT x), '{}') INTO want FROM unnest(p_sizes) x;
  IF cardinality(want) = 0 THEN want := ARRAY['']; END IF;
  -- keep the order the admin typed
  want := ARRAY(SELECT x FROM unnest(CASE WHEN cardinality(p_sizes) = 0 THEN ARRAY[''] ELSE p_sizes END) WITH ORDINALITY t(x, o) GROUP BY x ORDER BY min(o));
  FOREACH s IN ARRAY want LOOP
    SELECT id INTO ex FROM app.product_variants WHERE product_id = p_product AND size = s AND color = '';
    IF FOUND THEN UPDATE app.product_variants SET active = true, sort_order = i WHERE id = ex.id;
    ELSE
      v_sku := app.sku_for(p_slug, s); n := 1;
      WHILE EXISTS (SELECT 1 FROM app.product_variants WHERE sku = v_sku) LOOP n := n + 1; v_sku := app.sku_for(p_slug || '-' || n, s); END LOOP;
      INSERT INTO app.product_variants (product_id, sku, size, sort_order) VALUES (p_product, v_sku, s, i) RETURNING id INTO v_id;
      v_qty := coalesce((p_initial ->> s)::int, 0);
      IF v_qty < 0 OR v_qty > 1000000 THEN PERFORM app.fail('bad_request', 'stock must be 0 or more'); END IF;
      INSERT INTO app.inventory (variant_id, on_hand) VALUES (v_id, v_qty);
      IF v_qty > 0 THEN INSERT INTO app.inventory_movements (variant_id, delta_on_hand, reason, staff_id, note) VALUES (v_id, v_qty, 'adjustment', p_staff, 'initial stock'); END IF;
    END IF;
    i := i + 1;
  END LOOP;
  UPDATE app.product_variants SET active = false WHERE product_id = p_product AND active AND NOT (size = ANY (want));
END $$;

CREATE FUNCTION public.admin_save_product(p_slug text, p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_name text; v_cat record; v_brand text; v_desc text; v_badge text; v_price bigint; v_compare bigint; v_color text; v_accent text; v_shape text; v_pattern text;
  v_origin text; v_sizes text[]; v_cols text[]; v_imgs text[]; v_featured boolean; v_flash boolean; v_status text; v_initial jsonb;
  cur record; v_slug text; v_pid uuid; v_before jsonb; u text; v_stock int;
BEGIN
  PERFORM app.require_perm('catalog.write');
  IF jsonb_typeof(p_data) <> 'object' THEN PERFORM app.fail('bad_request', 'product data missing'); END IF;
  v_name := app.v_text(p_data, 'name', 160, 1);
  SELECT id, shop_id INTO v_cat FROM app.categories WHERE slug = app.v_text(p_data, 'category', 80, 1);
  IF NOT FOUND THEN PERFORM app.fail('bad_request', 'Unknown category.'); END IF;
  IF NOT app.can_shop(v_cat.shop_id) THEN PERFORM app.fail('forbidden', 'This product belongs to a department you do not manage.'); END IF;
  v_brand := app.v_text(p_data, 'brand', 80); v_desc := app.v_text(p_data, 'description', 5000); v_badge := app.v_text(p_data, 'badge', 30);
  v_price := app.v_money(p_data, 'price', NULL, true);
  IF v_price IS NULL THEN PERFORM app.fail('bad_request', 'price must be more than 0'); END IF;
  v_compare := app.v_money(p_data, 'comparePrice', 0, false);
  v_color := app.v_match(app.v_text(p_data, 'color', 20, 0, '#0b2a6f'), '^#[0-9a-fA-F]{3,8}$', 'color must be like #0b2a6f');
  v_accent := app.v_text(p_data, 'accent', 20); IF v_accent <> '' THEN PERFORM app.v_match(v_accent, '^#[0-9a-fA-F]{3,8}$', 'accent must be like #0b2a6f'); END IF;
  v_shape := app.v_match(app.v_text(p_data, 'shape', 30, 0, 'tshirt'), '^[a-z0-9-]+$', 'invalid shape');
  v_pattern := app.v_match(app.v_text(p_data, 'pattern', 30, 0, 'solid'), '^[a-z0-9-]*$', 'invalid pattern');
  v_origin := app.v_text(p_data, 'origin', 80, 1);
  IF NOT EXISTS (SELECT 1 FROM app.import_countries WHERE code = v_origin) THEN PERFORM app.fail('bad_request', 'Unknown import country.'); END IF;
  v_sizes := app.v_text_array(p_data, 'sizes', 30, '^[A-Za-z0-9 ./+-]{0,20}$', 'sizes use letters, numbers, - . / +');
  v_sizes := ARRAY(SELECT x FROM unnest(v_sizes) x WHERE x <> '');
  v_cols := app.v_text_array(p_data, 'collections', 30, '^[a-z0-9]+(-[a-z0-9]+)*$', 'invalid collection');
  v_imgs := app.v_text_array(p_data, 'images', 8, '^(https?://|/)\S{1,1990}$', 'photos must be uploaded images or https links (up to 8)');
  v_featured := app.v_bool(p_data, 'featured', false); v_flash := app.v_bool(p_data, 'flash', false);
  v_status := app.v_text(p_data, 'status', 10, 0, 'active');
  IF v_status NOT IN ('draft', 'active', 'archived') THEN PERFORM app.fail('bad_request', 'invalid status'); END IF;
  -- initial stock (new products only)
  v_initial := CASE WHEN jsonb_typeof(p_data -> 'stockBySize') = 'object' THEN p_data -> 'stockBySize' END;
  IF v_initial IS NULL AND jsonb_typeof(p_data -> 'stock') = 'number' THEN
    v_stock := (p_data ->> 'stock')::numeric::int;
    v_initial := CASE WHEN cardinality(v_sizes) > 0 THEN jsonb_build_object(v_sizes[1], v_stock) ELSE jsonb_build_object('', v_stock) END;
  END IF;

  IF p_slug IS NULL THEN
    v_slug := coalesce(nullif(app.v_text(p_data, 'id', 80), ''), app.slugify(v_name));
    IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN v_slug := app.slugify(v_name); END IF;
    WHILE EXISTS (SELECT 1 FROM app.products WHERE slug = v_slug) LOOP v_slug := left(app.slugify(v_name), 52) || '-' || substr(md5(random()::text), 1, 5); END LOOP;
    INSERT INTO app.products (slug, shop_id, category_id, name, brand, description, origin_code, status, badge, featured, flash, price_cents, compare_price_cents, visual, created_by)
    VALUES (v_slug, v_cat.shop_id, v_cat.id, v_name, v_brand, v_desc, v_origin, v_status, v_badge, v_featured, v_flash, v_price, v_compare,
            jsonb_build_object('shape', v_shape, 'pattern', v_pattern, 'color', v_color, 'accent', v_accent), app.staff_actor())
    RETURNING id INTO v_pid;
    PERFORM app.audit('product.create', 'product', v_slug, NULL, p_data);
  ELSE
    SELECT * INTO cur FROM app.products WHERE slug = p_slug FOR UPDATE;
    IF NOT FOUND THEN PERFORM app.fail('not_found', 'Product not found.'); END IF;
    IF NOT app.can_shop(cur.shop_id) THEN PERFORM app.fail('forbidden', 'This product belongs to a department you do not manage.'); END IF;
    v_slug := p_slug; v_pid := cur.id; v_initial := NULL;
    v_before := app.legacy_products(true, ARRAY[p_slug]) -> 0;
    UPDATE app.products SET shop_id = v_cat.shop_id, category_id = v_cat.id, name = v_name, brand = v_brand, description = v_desc, origin_code = v_origin, status = v_status,
           badge = v_badge, featured = v_featured, flash = v_flash, price_cents = v_price, compare_price_cents = v_compare,
           visual = jsonb_build_object('shape', v_shape, 'pattern', v_pattern, 'color', v_color, 'accent', v_accent) WHERE id = v_pid;
    PERFORM app.audit('product.update', 'product', v_slug, v_before, p_data);
  END IF;
  PERFORM app.sync_variants(v_pid, v_slug, v_sizes, v_initial, app.staff_actor());
  DELETE FROM app.collection_products WHERE product_id = v_pid AND collection_id NOT IN (SELECT id FROM app.collections WHERE slug = ANY (v_cols));
  INSERT INTO app.collection_products (collection_id, product_id, sort_order) SELECT id, v_pid, 1000 FROM app.collections WHERE slug = ANY (v_cols) ON CONFLICT DO NOTHING;
  DELETE FROM app.product_images WHERE product_id = v_pid;
  FOR u IN SELECT x FROM unnest(v_imgs) WITH ORDINALITY t(x, o) ORDER BY o LOOP
    INSERT INTO app.product_images (product_id, url, sort_order, object_key)
    VALUES (v_pid, u, (SELECT count(*) FROM app.product_images WHERE product_id = v_pid), CASE WHEN position('/product-images/' IN u) > 0 THEN split_part(u, '/product-images/', 2) END);
  END LOOP;
  PERFORM app.enqueue_job('catalog.snapshot', '{}'::jsonb, 'catalog.snapshot:' || to_char(now(), 'YYYYMMDDHH24MI'));
  RETURN app.legacy_products(true, ARRAY[v_slug]) -> 0;
END $$;

-- "Delete" archives: orders keep their history.
CREATE FUNCTION public.admin_archive_product(p_slug text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE cur record;
BEGIN
  PERFORM app.require_perm('catalog.write');
  SELECT id, shop_id INTO cur FROM app.products WHERE slug = p_slug;
  IF NOT FOUND THEN PERFORM app.fail('not_found', 'Product not found.'); END IF;
  IF NOT app.can_shop(cur.shop_id) THEN PERFORM app.fail('forbidden', 'This product belongs to a department you do not manage.'); END IF;
  UPDATE app.products SET status = 'archived' WHERE id = cur.id;
  PERFORM app.audit('product.archive', 'product', p_slug);
  PERFORM app.enqueue_job('catalog.snapshot', '{}'::jsonb, 'catalog.snapshot:' || to_char(now(), 'YYYYMMDDHH24MI'));
  RETURN jsonb_build_object('ok', true, 'archived', true);
END $$;

CREATE FUNCTION public.admin_set_stock(p_slug text, p_stock jsonb DEFAULT NULL, p_total int DEFAULT NULL, p_reorder jsonb DEFAULT NULL, p_note text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE cur record; v record; v_target jsonb := p_stock; v_want int; n int;
BEGIN
  PERFORM app.require_perm('inventory.adjust');
  IF length(coalesce(p_note, '')) > 200 THEN PERFORM app.fail('bad_request', 'note is too long'); END IF;
  SELECT id, shop_id INTO cur FROM app.products WHERE slug = p_slug;
  IF NOT FOUND THEN PERFORM app.fail('not_found', 'Product not found.'); END IF;
  IF NOT app.can_shop(cur.shop_id) THEN PERFORM app.fail('forbidden', 'This product belongs to a department you do not manage.'); END IF;
  IF v_target IS NULL AND p_total IS NOT NULL THEN
    SELECT count(*) INTO n FROM app.product_variants WHERE product_id = cur.id AND active;
    IF n <> 1 THEN PERFORM app.fail('bad_request', 'This product has several sizes. Set the stock for each size.'); END IF;
    SELECT jsonb_build_object(size, p_total) INTO v_target FROM app.product_variants WHERE product_id = cur.id AND active;
  END IF;
  FOR v IN SELECT pv.id, pv.size, i.on_hand, i.reserved FROM app.product_variants pv JOIN app.inventory i ON i.variant_id = pv.id
            WHERE pv.product_id = cur.id AND pv.active ORDER BY pv.id FOR UPDATE OF i LOOP
    IF v_target IS NOT NULL AND v_target ? v.size THEN
      BEGIN v_want := (v_target ->> v.size)::int; EXCEPTION WHEN others THEN PERFORM app.fail('bad_request', 'stock must be a whole number'); END;
      IF v_want < 0 OR v_want > 1000000 THEN PERFORM app.fail('bad_request', 'stock must be 0 or more'); END IF;
      IF v_want < v.reserved THEN PERFORM app.fail('conflict', 'Size ' || CASE WHEN v.size = '' THEN '(one size)' ELSE v.size END || ' has ' || v.reserved || ' reserved for unpaid orders; stock cannot go below that.'); END IF;
      IF v_want <> v.on_hand THEN
        UPDATE app.inventory SET on_hand = v_want WHERE variant_id = v.id;
        INSERT INTO app.inventory_movements (variant_id, delta_on_hand, reason, staff_id, note) VALUES (v.id, v_want - v.on_hand, 'adjustment', app.staff_actor(), coalesce(p_note, ''));
      END IF;
    END IF;
    IF p_reorder IS NOT NULL AND p_reorder ? v.size THEN
      UPDATE app.inventory SET reorder_level = greatest(0, least(100000, (p_reorder ->> v.size)::int)) WHERE variant_id = v.id;
    END IF;
  END LOOP;
  PERFORM app.audit('inventory.adjust', 'product', p_slug, NULL, jsonb_build_object('stock', v_target, 'reorder', p_reorder, 'note', p_note));
  PERFORM app.enqueue_job('catalog.snapshot', '{}'::jsonb, 'catalog.snapshot:' || to_char(now(), 'YYYYMMDDHH24MI'));
  RETURN app.legacy_products(true, ARRAY[p_slug]) -> 0;
END $$;

CREATE FUNCTION public.admin_stock_history(p_slug text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app.require_perm('catalog.read');
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('created_at', m.created_at, 'size', v.size, 'delta_on_hand', m.delta_on_hand, 'delta_reserved', m.delta_reserved,
           'reason', m.reason, 'note', m.note, 'username', u.username::text, 'order_number', o.order_number) ORDER BY m.created_at DESC, m.id DESC)
    FROM (SELECT * FROM app.inventory_movements WHERE variant_id IN (SELECT pv.id FROM app.product_variants pv JOIN app.products p ON p.id = pv.product_id WHERE p.slug = p_slug)
          ORDER BY created_at DESC, id DESC LIMIT 200) m
    JOIN app.product_variants v ON v.id = m.variant_id LEFT JOIN app.staff_users u ON u.id = m.staff_id LEFT JOIN app.orders o ON o.id = m.order_id), '[]'::jsonb);
END $$;

-- ---------- categories ----------
CREATE FUNCTION full_catalog_editor() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM app.staff_roles sr JOIN app.roles r ON r.id = sr.role_id WHERE sr.staff_id = auth.uid() AND NOT r.shop_scoped)
$$;
CREATE FUNCTION public.admin_save_category(p_slug text, p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_name text; v_tag text; v_shape text; v_icon text; v_img text; v_shop uuid; v_hidden boolean; ex record;
BEGIN
  PERFORM app.require_perm('catalog.write');
  IF NOT app.full_catalog_editor() THEN PERFORM app.fail('forbidden', 'Only full catalogue editors can change categories.'); END IF;
  PERFORM app.v_match(coalesce(p_slug, ''), '^[a-z0-9]+(-[a-z0-9]+)*$', 'invalid category id');
  v_name := app.v_text(p_data, 'name', 80, 1); v_tag := app.v_text(p_data, 'tagline', 120);
  v_shape := app.v_match(app.v_text(p_data, 'shape', 30, 0, 'tshirt'), '^[a-z0-9-]+$', 'invalid shape');
  v_icon := app.v_match(app.v_text(p_data, 'icon', 20, 0, '#0b2a6f'), '^#[0-9a-fA-F]{3,8}$', 'icon must be a colour like #0b2a6f');
  v_img := app.v_text(p_data, 'image', 2000); IF v_img <> '' THEN PERFORM app.v_match(v_img, '^(https?://|/)', 'image must be an uploaded image or an https link'); END IF;
  v_hidden := app.v_bool(p_data, 'hidden', false);
  IF app.v_text(p_data, 'shop', 80) <> '' THEN
    SELECT id INTO v_shop FROM app.shops WHERE slug = p_data ->> 'shop';
    IF v_shop IS NULL THEN PERFORM app.fail('bad_request', 'Unknown department.'); END IF;
  END IF;
  SELECT id INTO ex FROM app.categories WHERE slug = p_slug;
  IF FOUND THEN
    UPDATE app.categories SET name = v_name, tagline = v_tag, shape = v_shape, icon_color = v_icon, image_url = nullif(v_img, ''),
           status = CASE WHEN v_hidden THEN 'hidden' ELSE 'active' END, shop_id = coalesce(v_shop, shop_id) WHERE id = ex.id;
    IF v_shop IS NOT NULL THEN UPDATE app.products SET shop_id = v_shop WHERE category_id = ex.id; END IF;
  ELSE
    INSERT INTO app.categories (slug, shop_id, name, tagline, shape, icon_color, image_url, sort_order, status)
    VALUES (p_slug, coalesce(v_shop, (SELECT id FROM app.shops ORDER BY sort_order LIMIT 1)), v_name, v_tag, v_shape, v_icon, nullif(v_img, ''),
            (SELECT coalesce(max(sort_order), 0) + 1 FROM app.categories), CASE WHEN v_hidden THEN 'hidden' ELSE 'active' END);
  END IF;
  PERFORM app.audit('category.save', 'category', p_slug, NULL, p_data);
  PERFORM app.enqueue_job('catalog.snapshot', '{}'::jsonb, 'catalog.snapshot:' || to_char(now(), 'YYYYMMDDHH24MI'));
  RETURN jsonb_build_object('ok', true);
END $$;
CREATE FUNCTION public.admin_delete_category(p_slug text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  PERFORM app.require_perm('catalog.write');
  IF NOT app.full_catalog_editor() THEN PERFORM app.fail('forbidden', 'Only full catalogue editors can change categories.'); END IF;
  SELECT count(*) INTO n FROM app.products p JOIN app.categories c ON c.id = p.category_id WHERE c.slug = p_slug AND p.status <> 'archived';
  IF n > 0 THEN PERFORM app.fail('conflict', 'Move or delete the ' || n || ' products in this category first.'); END IF;
  DELETE FROM app.categories c WHERE slug = p_slug AND NOT EXISTS (SELECT 1 FROM app.products p WHERE p.category_id = c.id);
  IF NOT FOUND THEN UPDATE app.categories SET status = 'hidden' WHERE slug = p_slug; END IF;
  PERFORM app.audit('category.delete', 'category', p_slug);
  RETURN jsonb_build_object('ok', true);
END $$;
CREATE FUNCTION public.admin_order_categories(p_slugs text[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s text; i int := 0;
BEGIN
  PERFORM app.require_perm('catalog.write');
  IF cardinality(p_slugs) > 200 THEN PERFORM app.fail('bad_request', 'too many categories'); END IF;
  FOREACH s IN ARRAY p_slugs LOOP UPDATE app.categories SET sort_order = i WHERE slug = s; i := i + 1; END LOOP;
  PERFORM app.audit('category.reorder', 'category', NULL, NULL, to_jsonb(p_slugs));
  RETURN jsonb_build_object('ok', true);
END $$;

-- ---------- collections ----------
CREATE FUNCTION public.admin_save_collection(p_slug text, p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_img text; v_order text[]; s text; i int := 0;
BEGIN
  PERFORM app.require_perm('catalog.write');
  PERFORM app.v_match(coalesce(p_slug, ''), '^[a-z0-9]+(-[a-z0-9]+)*$', 'invalid collection id');
  v_img := app.v_text(p_data, 'image', 2000); IF v_img <> '' THEN PERFORM app.v_match(v_img, '^(https?://|/)', 'image must be an uploaded image or an https link'); END IF;
  IF p_data ? 'order' AND p_data -> 'order' <> 'null'::jsonb THEN v_order := app.v_text_array(p_data, 'order', 2000, '^[a-z0-9]+(-[a-z0-9]+)*$', 'invalid product in order'); END IF;
  INSERT INTO app.collections (slug, name, description, accent, image_url, home_row, manual_order, sort_order)
  VALUES (p_slug, app.v_text(p_data, 'name', 80, 1), app.v_text(p_data, 'description', 300),
          app.v_match(app.v_text(p_data, 'accent', 20, 0, '#0b2a6f'), '^#[0-9a-fA-F]{3,8}$', 'accent must be a colour like #0b2a6f'),
          nullif(v_img, ''), app.v_bool(p_data, 'homeRow', false), v_order IS NOT NULL, (SELECT coalesce(max(sort_order), 0) + 1 FROM app.collections))
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, accent = EXCLUDED.accent, image_url = EXCLUDED.image_url,
     home_row = EXCLUDED.home_row, manual_order = EXCLUDED.manual_order
  RETURNING id INTO v_id;
  IF v_order IS NOT NULL THEN
    FOREACH s IN ARRAY v_order LOOP
      UPDATE app.collection_products cp SET sort_order = i FROM app.products p WHERE cp.product_id = p.id AND cp.collection_id = v_id AND p.slug = s; i := i + 1;
    END LOOP;
  END IF;
  PERFORM app.audit('collection.save', 'collection', p_slug, NULL, p_data - 'order');
  PERFORM app.enqueue_job('catalog.snapshot', '{}'::jsonb, 'catalog.snapshot:' || to_char(now(), 'YYYYMMDDHH24MI'));
  RETURN jsonb_build_object('ok', true);
END $$;
CREATE FUNCTION public.admin_delete_collection(p_slug text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app.require_perm('catalog.write');
  DELETE FROM app.collections WHERE slug = p_slug;   -- removes only the grouping, never products
  PERFORM app.audit('collection.delete', 'collection', p_slug);
  RETURN jsonb_build_object('ok', true);
END $$;

-- ===========================================================================
-- Website settings and banners
-- ===========================================================================
CREATE FUNCTION check_link(p text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT p ~ '^(#|/|https://)' AND length(p) <= 300 $$;
-- validate a list of objects: each field must be a string (or boolean when listed) with a length limit
CREATE FUNCTION v_object_list(p jsonb, p_key text, p_max_items int, p_fields jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE x jsonb; f record; v_out jsonb := '[]'::jsonb; o jsonb;
BEGIN
  IF jsonb_typeof(p -> p_key) <> 'array' THEN PERFORM app.fail('bad_request', p_key || ' must be a list'); END IF;
  IF jsonb_array_length(p -> p_key) > p_max_items THEN PERFORM app.fail('bad_request', p_key || ': at most ' || p_max_items); END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(p -> p_key) LOOP
    IF jsonb_typeof(x) <> 'object' THEN PERFORM app.fail('bad_request', p_key || ': each entry must be an object'); END IF;
    o := '{}'::jsonb;
    FOR f IN SELECT key, value FROM jsonb_each(p_fields) LOOP     -- value: {"max": 40} | {"bool": true} | {"link": true, "max": 300} | {"color": true}
      IF NOT x ? f.key THEN CONTINUE; END IF;
      IF f.value ? 'bool' THEN
        IF jsonb_typeof(x -> f.key) <> 'boolean' THEN PERFORM app.fail('bad_request', p_key || '.' || f.key || ' must be true or false'); END IF;
      ELSE
        IF jsonb_typeof(x -> f.key) <> 'string' OR length(x ->> f.key) > (f.value ->> 'max')::int THEN PERFORM app.fail('bad_request', p_key || '.' || f.key || ' is invalid or too long'); END IF;
        IF f.value ? 'link' AND NOT app.check_link(x ->> f.key) THEN PERFORM app.fail('bad_request', p_key || '.' || f.key || ' must start with #, / or https://'); END IF;
        IF f.value ? 'color' AND (x ->> f.key) !~ '^#[0-9a-fA-F]{3,8}$' THEN PERFORM app.fail('bad_request', p_key || '.' || f.key || ' must be a colour like #0b2a6f'); END IF;
        IF f.value ? 're' AND (x ->> f.key) !~ (f.value ->> 're') THEN PERFORM app.fail('bad_request', p_key || '.' || f.key || ' is invalid'); END IF;
      END IF;
      o := o || jsonb_build_object(f.key, x -> f.key);
    END LOOP;
    v_out := v_out || o;   -- unknown fields are dropped
  END LOOP;
  RETURN v_out;
END $$;

CREATE FUNCTION public.admin_save_settings(p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  content_keys text[] := ARRAY['brand','announcement','currency','phone','email','address','whatsapp','chinaDays','returnDays','welcome','navLinks','sections','services','sellerStats','chinaSteps','faq'];
  globe_keys text[] := ARRAY['heroTitle','heroSubtitle','globeCities','globeStats','globeSteps'];
  flash_keys text[] := ARRAY['flashTitle','flashMode','flashUntil'];
  ops_keys text[] := ARRAY['shippingFee','freeShipping','payCOD','payBank','payOnline','bankDetails','localDays','origins'];
  d jsonb := '{}'::jsonb; k text; c jsonb := '{}'::jsonb; v_before jsonb := app.legacy_settings(); v_ends timestamptz; o jsonb; i int := 0; n int;
  has_content boolean; has_ops boolean;
BEGIN
  IF jsonb_typeof(p_data) <> 'object' THEN PERFORM app.fail('bad_request', 'settings missing'); END IF;
  -- keep only known keys (old browser-only keys such as adminUser / adminPassHash are dropped, never stored)
  FOR k IN SELECT jsonb_object_keys(p_data) LOOP
    IF k = ANY (content_keys || globe_keys || flash_keys || ops_keys) THEN d := d || jsonb_build_object(k, p_data -> k); END IF;
  END LOOP;
  has_content := EXISTS (SELECT 1 FROM jsonb_object_keys(d) x WHERE x = ANY (content_keys || globe_keys || flash_keys));
  has_ops := EXISTS (SELECT 1 FROM jsonb_object_keys(d) x WHERE x = ANY (ops_keys));
  IF NOT has_content AND NOT has_ops THEN RETURN app.legacy_settings(); END IF;
  IF has_content THEN PERFORM app.require_perm('content.write'); END IF;
  IF has_ops THEN PERFORM app.require_perm('settings.write'); END IF;

  -- ---- presentation content ----
  FOREACH k IN ARRAY ARRAY['brand','announcement','currency','phone','email','address','chinaDays'] LOOP
    IF d ? k THEN c := c || jsonb_build_object(k, app.v_text(d, k, CASE k WHEN 'announcement' THEN 400 WHEN 'address' THEN 200 WHEN 'email' THEN 120 WHEN 'brand' THEN 80 WHEN 'phone' THEN 40 WHEN 'chinaDays' THEN 20 ELSE 8 END)); END IF;
  END LOOP;
  IF d ? 'whatsapp' THEN c := c || jsonb_build_object('whatsapp', app.v_match(app.v_text(d, 'whatsapp', 15), '^[0-9]{0,15}$', 'WhatsApp must be digits only')); END IF;
  IF d ? 'returnDays' THEN
    IF jsonb_typeof(d -> 'returnDays') <> 'number' OR (d ->> 'returnDays')::numeric NOT BETWEEN 0 AND 90 THEN PERFORM app.fail('bad_request', 'returnDays must be 0 to 90'); END IF;
    c := c || jsonb_build_object('returnDays', (d ->> 'returnDays')::numeric::int);
  END IF;
  IF d ? 'welcome' THEN
    IF jsonb_typeof(d -> 'welcome') <> 'object' OR (d #>> '{welcome,mode}') NOT IN ('session','first','visit','off') THEN PERFORM app.fail('bad_request', 'invalid welcome settings'); END IF;
    c := c || jsonb_build_object('welcome', jsonb_build_object('on', app.v_bool(d -> 'welcome', 'on', true), 'mode', d #>> '{welcome,mode}',
      'eyebrow', app.v_text(d -> 'welcome', 'eyebrow', 60), 'subtitle', app.v_text(d -> 'welcome', 'subtitle', 200), 'button', app.v_text(d -> 'welcome', 'button', 40)));
  END IF;
  IF d ? 'navLinks' THEN c := c || jsonb_build_object('navLinks', app.v_object_list(d, 'navLinks', 20, '{"label":{"max":40},"link":{"max":300,"link":true},"hot":{"bool":true}}')); END IF;
  IF d ? 'sections' THEN c := c || jsonb_build_object('sections', app.v_object_list(d, 'sections', 30, '{"id":{"max":30,"re":"^[a-z0-9-]+$"},"name":{"max":120},"on":{"bool":true},"title":{"max":80}}')); END IF;
  IF d ? 'services' THEN c := c || jsonb_build_object('services', app.v_object_list(d, 'services', 16, '{"label":{"max":40},"link":{"max":300,"link":true},"icon":{"max":20,"re":"^[a-z0-9-]+$"},"color":{"max":20,"color":true}}')); END IF;
  IF d ? 'sellerStats' THEN c := c || jsonb_build_object('sellerStats', app.v_object_list(d, 'sellerStats', 6, '{"value":{"max":20},"label":{"max":40}}')); END IF;
  IF d ? 'chinaSteps' THEN c := c || jsonb_build_object('chinaSteps', app.v_object_list(d, 'chinaSteps', 10, '{"title":{"max":60},"text":{"max":300}}')); END IF;
  IF d ? 'faq' THEN c := c || jsonb_build_object('faq', app.v_object_list(d, 'faq', 40, '{"q":{"max":200},"a":{"max":1500}}')); END IF;
  IF c <> '{}'::jsonb THEN
    INSERT INTO app.site_content (key, value, updated_by) VALUES ('storefront', c, app.staff_actor())
    ON CONFLICT (key) DO UPDATE SET value = app.site_content.value || EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by;
  END IF;
  -- ---- globe ----
  IF d ?| globe_keys THEN
    UPDATE app.globe_settings SET
      hero_title = CASE WHEN d ? 'heroTitle' THEN app.v_text(d, 'heroTitle', 120) ELSE hero_title END,
      hero_subtitle = CASE WHEN d ? 'heroSubtitle' THEN app.v_text(d, 'heroSubtitle', 400) ELSE hero_subtitle END,
      cities = CASE WHEN d ? 'globeCities' THEN app.v_text_array(d, 'globeCities', 60, '^.{1,40}$', 'invalid city') ELSE cities END,
      stats = CASE WHEN d ? 'globeStats' THEN app.v_object_list(d, 'globeStats', 4, '{"value":{"max":20},"label":{"max":40},"live":{"bool":true}}') ELSE stats END,
      steps = CASE WHEN d ? 'globeSteps' THEN app.v_object_list(d, 'globeSteps', 6, '{"title":{"max":30},"text":{"max":40}}') ELSE steps END,
      updated_at = now() WHERE id = 1;
  END IF;
  -- ---- flash sale ----
  IF d ?| flash_keys THEN
    IF d ? 'flashMode' AND (d ->> 'flashMode') NOT IN ('daily', 'until', 'off') THEN PERFORM app.fail('bad_request', 'invalid flash sale mode'); END IF;
    IF coalesce(d ->> 'flashMode', (SELECT mode FROM app.flash_sale_rules WHERE id = 1)) = 'until' AND d ? 'flashUntil' THEN
      BEGIN
        v_ends := CASE WHEN (d ->> 'flashUntil') ~ '([zZ]|[+-][0-9]{2}:?[0-9]{2})$' THEN (d ->> 'flashUntil')::timestamptz
                       ELSE ((d ->> 'flashUntil') || '+05:30')::timestamptz END;   -- staff type Sri Lanka time
      EXCEPTION WHEN others THEN PERFORM app.fail('bad_request', 'Choose a valid end date for the flash sale.'); END;
    END IF;
    UPDATE app.flash_sale_rules SET title = CASE WHEN d ? 'flashTitle' THEN app.v_text(d, 'flashTitle', 40, 1) ELSE title END,
           mode = coalesce(d ->> 'flashMode', mode), ends_at = CASE WHEN coalesce(d ->> 'flashMode', mode) = 'until' THEN coalesce(v_ends, ends_at) ELSE NULL END, updated_at = now()
     WHERE id = 1;
  END IF;
  -- ---- operations: fees, payments, countries ----
  IF d ? 'shippingFee' OR d ? 'freeShipping' THEN
    UPDATE app.shipping_rates SET fee_cents = CASE WHEN d ? 'shippingFee' THEN app.v_money(d, 'shippingFee', 0, false) ELSE fee_cents END,
           free_over_cents = CASE WHEN d ? 'freeShipping' THEN nullif(app.v_money(d, 'freeShipping', 0, false), 0) ELSE free_over_cents END, updated_at = now()
     WHERE code = 'standard';
  END IF;
  IF d ? 'payCOD' THEN UPDATE app.payment_settings SET enabled = app.v_bool(d, 'payCOD', true), updated_at = now() WHERE method = 'cod'; END IF;
  IF d ? 'payBank' THEN UPDATE app.payment_settings SET enabled = app.v_bool(d, 'payBank', true), updated_at = now() WHERE method = 'bank_transfer'; END IF;
  IF d ? 'payOnline' THEN
    IF app.v_bool(d, 'payOnline', false) AND NOT (SELECT payhere_configured FROM app.ops_settings WHERE id = 1) THEN
      -- set by the operator after the PayHere keys are stored as Edge Function secrets
      PERFORM app.fail('bad_request', 'PayHere is not configured on the server yet (merchant ID and secret).');
    END IF;
    UPDATE app.payment_settings SET enabled = app.v_bool(d, 'payOnline', false), updated_at = now() WHERE method = 'payhere';
  END IF;
  IF d ? 'bankDetails' THEN UPDATE app.payment_settings SET instructions = app.v_text(d, 'bankDetails', 500), updated_at = now() WHERE method = 'bank_transfer'; END IF;
  IF d ? 'localDays' THEN UPDATE app.import_countries SET days = app.v_text(d, 'localDays', 20) WHERE code = 'local'; END IF;
  IF d ? 'origins' THEN
    FOR o IN SELECT * FROM jsonb_array_elements(app.v_object_list(d, 'origins', 30, '{"id":{"max":80,"re":"^[a-z0-9]+(-[a-z0-9]+)*$"},"name":{"max":60},"code":{"max":2},"label":{"max":40},"days":{"max":20},"on":{"bool":true}}')) LOOP
      i := i + 1;
      IF o ->> 'id' = 'local' OR NOT o ? 'id' OR NOT o ? 'name' OR NOT o ? 'label' THEN CONTINUE; END IF;
      INSERT INTO app.import_countries (code, name, iso2, label, days, enabled, sort_order)
      VALUES (o ->> 'id', o ->> 'name', nullif(o ->> 'code', ''), o ->> 'label', coalesce(o ->> 'days', ''), coalesce((o ->> 'on')::boolean, true), i)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, iso2 = EXCLUDED.iso2, label = EXCLUDED.label, days = EXCLUDED.days, enabled = EXCLUDED.enabled, sort_order = EXCLUDED.sort_order, updated_at = now();
    END LOOP;
  END IF;
  SELECT count(*) INTO n FROM app.payment_settings WHERE enabled;
  IF n = 0 THEN PERFORM app.fail('bad_request', 'Keep at least one payment method switched on.'); END IF;
  PERFORM app.audit('settings.update', 'settings', NULL, (SELECT jsonb_object_agg(x, v_before -> x) FROM jsonb_object_keys(d) x), d);
  PERFORM app.enqueue_job('catalog.snapshot', '{}'::jsonb, 'catalog.snapshot:' || to_char(now(), 'YYYYMMDDHH24MI'));
  RETURN app.legacy_settings();
END $$;

CREATE FUNCTION public.admin_save_banners(p_list jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l jsonb; h jsonb; i int := 0; v_before jsonb := app.legacy_banners(true);
BEGIN
  PERFORM app.require_perm('content.write');
  l := app.v_object_list(jsonb_build_object('banners', p_list), 'banners', 20,
    '{"id":{"max":40,"re":"^[A-Za-z0-9_-]+$"},"eyebrow":{"max":40},"title":{"max":60},"subtitle":{"max":120},"cta":{"max":30},"link":{"max":300,"link":true},"color":{"max":20,"color":true},"shape":{"max":30,"re":"^[a-z0-9-]+$"},"image":{"max":2000,"re":"^((https?://|/).*)?$"}}');
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(l) x WHERE NOT x ? 'id') THEN PERFORM app.fail('bad_request', 'every banner needs an id'); END IF;
  IF (SELECT count(DISTINCT x ->> 'id') FROM jsonb_array_elements(l) x) <> jsonb_array_length(l) THEN PERFORM app.fail('bad_request', 'Two banners have the same id.'); END IF;
  DELETE FROM app.banners WHERE NOT (public_id = ANY (ARRAY(SELECT x ->> 'id' FROM jsonb_array_elements(l) x)));
  FOR h IN SELECT * FROM jsonb_array_elements(l) LOOP
    INSERT INTO app.banners (public_id, sort_order, eyebrow, title, subtitle, cta, link, color, shape, image_url)
    VALUES (h ->> 'id', i, coalesce(h ->> 'eyebrow', ''), coalesce(h ->> 'title', ''), coalesce(h ->> 'subtitle', ''), coalesce(h ->> 'cta', ''), coalesce(h ->> 'link', '#'),
            coalesce(h ->> 'color', '#0b2a6f'), coalesce(h ->> 'shape', 'tshirt'), nullif(h ->> 'image', ''))
    ON CONFLICT (public_id) DO UPDATE SET sort_order = EXCLUDED.sort_order, eyebrow = EXCLUDED.eyebrow, title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, cta = EXCLUDED.cta,
       link = EXCLUDED.link, color = EXCLUDED.color, shape = EXCLUDED.shape, image_url = EXCLUDED.image_url, updated_at = now();
    i := i + 1;
  END LOOP;
  PERFORM app.audit('banners.update', 'banners', NULL, v_before, l);
  PERFORM app.enqueue_job('catalog.snapshot', '{}'::jsonb, 'catalog.snapshot:' || to_char(now(), 'YYYYMMDDHH24MI'));
  RETURN app.legacy_banners(true);
END $$;

-- ===========================================================================
-- Orders (staff)
-- ===========================================================================
CREATE FUNCTION staff_sees_order(p_order uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.full_catalog_editor() OR EXISTS (SELECT 1 FROM app.order_items oi WHERE oi.order_id = p_order AND app.can_shop(oi.shop_id))
$$;

CREATE FUNCTION public.admin_orders(p_status text DEFAULT NULL, p_payment text DEFAULT NULL, p_review boolean DEFAULT false, p_q text DEFAULT NULL, p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pii boolean; v_total bigint; v_items jsonb; v_like text;
BEGIN
  PERFORM app.require_perm('orders.read');
  IF p_limit NOT BETWEEN 1 AND 200 OR p_offset < 0 OR length(coalesce(p_q, '')) > 80 THEN PERFORM app.fail('bad_request', 'invalid filter'); END IF;
  v_pii := app.has_perm('customers.read');
  v_like := CASE WHEN coalesce(p_q, '') = '' THEN NULL ELSE '%' || replace(replace(p_q, '%', ''), '_', '') || '%' END;
  WITH m AS (
    SELECT o.*, d.name AS district FROM app.orders o JOIN app.districts d ON d.code = o.ship_district
     WHERE (p_status IS NULL OR o.status = p_status) AND (p_payment IS NULL OR o.payment_status = p_payment) AND (NOT coalesce(p_review, false) OR o.needs_review)
       AND (v_like IS NULL OR o.order_number ILIKE v_like OR o.ship_name ILIKE v_like OR o.ship_phone ILIKE v_like OR o.ship_email::text ILIKE v_like)
       AND app.staff_sees_order(o.id))
  SELECT (SELECT count(*) FROM m), coalesce((SELECT jsonb_agg(x ORDER BY x ->> 'placedAt' DESC) FROM (
      SELECT jsonb_build_object('number', order_number, 'placedAt', placed_at, 'status', status, 'paymentStatus', payment_status, 'paymentMethod', payment_method,
        'total', app.rs(total_cents), 'needsReview', needs_review, 'items', (SELECT sum(quantity)::int FROM app.order_items WHERE order_id = m.id),
        'customer', CASE WHEN v_pii THEN jsonb_build_object('name', ship_name, 'phone', ship_phone, 'city', ship_city, 'district', district) ELSE jsonb_build_object('name', split_part(ship_name, ' ', 1)) END) AS x
      FROM m ORDER BY placed_at DESC LIMIT p_limit OFFSET p_offset) s), '[]'::jsonb)
    INTO v_total, v_items;
  RETURN jsonb_build_object('total', v_total, 'items', v_items);
END $$;

CREATE FUNCTION public.admin_order(p_number text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o record; v_pii boolean;
BEGIN
  PERFORM app.require_perm('orders.read');
  SELECT ord.*, d.name AS district INTO o FROM app.orders ord JOIN app.districts d ON d.code = ord.ship_district WHERE ord.order_number = upper(btrim(p_number));
  IF NOT FOUND OR NOT app.staff_sees_order(o.id) THEN PERFORM app.fail('not_found', 'Order not found.'); END IF;
  v_pii := app.has_perm('customers.read');
  RETURN jsonb_build_object('number', o.order_number, 'placedAt', o.placed_at, 'status', o.status, 'paymentStatus', o.payment_status, 'paymentMethod', o.payment_method,
    'needsReview', o.needs_review, 'reviewReason', o.review_reason, 'subtotal', app.rs(o.subtotal_cents), 'discount', app.rs(o.discount_cents),
    'shipping', app.rs(o.shipping_cents), 'total', app.rs(o.total_cents),
    'customer', CASE WHEN v_pii THEN jsonb_build_object('name', o.ship_name, 'phone', o.ship_phone, 'email', o.ship_email, 'address', o.ship_line1, 'city', o.ship_city,
                  'district', o.district, 'note', o.note, 'account', o.customer_id IS NOT NULL) ELSE jsonb_build_object('name', split_part(o.ship_name, ' ', 1)) END,
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.product_slug, 'sku', i.sku, 'name', i.product_name, 'variant', i.variant_label, 'qty', i.quantity,
               'price', app.rs(i.unit_price_cents), 'lineTotal', app.rs(i.line_total_cents), 'origin', i.origin_code, 'shop', s.name) ORDER BY i.product_name)
               FROM app.order_items i LEFT JOIN app.shops s ON s.id = i.shop_id WHERE i.order_id = o.id), '[]'::jsonb),
    'timeline', coalesce((SELECT jsonb_agg(jsonb_build_object('from_status', h.from_status, 'to_status', h.to_status, 'actor', h.actor, 'note', h.note, 'created_at', h.created_at) ORDER BY h.created_at, h.id)
               FROM app.order_status_history h WHERE h.order_id = o.id), '[]'::jsonb),
    'payments', coalesce((SELECT jsonb_agg(jsonb_build_object('provider', p.provider, 'provider_payment_id', p.provider_payment_id, 'status', p.status, 'expected', app.rs(p.expected_amount_cents),
               'method', p.method, 'card_mask', p.card_mask, 'reference', p.reference, 'paid_at', p.paid_at, 'verified_at', p.verified_at, 'verified_by', u.username::text))
               FROM app.payments p LEFT JOIN app.staff_users u ON u.id = p.verified_by WHERE p.order_id = o.id), '[]'::jsonb),
    'paymentEvents', CASE WHEN app.has_perm('payments.read') THEN coalesce((SELECT jsonb_agg(jsonb_build_object('status_code', e.status_code, 'signature_valid', e.signature_valid,
               'amount_text', e.amount_text, 'currency', e.currency, 'result', e.result, 'received_at', e.received_at, 'provider_payment_id', e.provider_payment_id) ORDER BY e.received_at, e.id)
               FROM app.payment_events e WHERE e.merchant_order_ref = o.order_number), '[]'::jsonb) ELSE '[]'::jsonb END,
    'shipments', coalesce((SELECT jsonb_agg(to_jsonb(s) || jsonb_build_object('events', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.occurred_at) FROM app.shipment_events e WHERE e.shipment_id = s.id), '[]'::jsonb)) ORDER BY s.created_at)
               FROM app.shipments s WHERE s.order_id = o.id), '[]'::jsonb),
    'refunds', coalesce((SELECT jsonb_agg(jsonb_build_object('amount', app.rs(r.amount_cents), 'reason', r.reason, 'restock', r.restock, 'created_at', r.created_at, 'username', u.username::text))
               FROM app.refunds r LEFT JOIN app.staff_users u ON u.id = r.staff_id WHERE r.order_id = o.id), '[]'::jsonb));
END $$;

CREATE FUNCTION lock_order(p_number text) RETURNS app.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o app.orders;
BEGIN
  SELECT * INTO o FROM app.orders WHERE order_number = upper(btrim(p_number)) FOR UPDATE;
  IF NOT FOUND OR NOT app.staff_sees_order(o.id) THEN PERFORM app.fail('not_found', 'Order not found.'); END IF;
  RETURN o;
END $$;

-- forward one step at a time (or one step back to fix a mistake); card/bank orders must be paid before moving past confirmed
CREATE FUNCTION public.admin_set_order_status(p_number text, p_status text, p_note text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o app.orders; flow text[] := ARRAY['confirmed','processing','shipped','arrived_lk','delivered']; v_from int; v_to int;
BEGIN
  PERFORM app.require_perm('orders.update');
  IF NOT (p_status = ANY (flow)) THEN PERFORM app.fail('bad_request', 'Unknown status.'); END IF;
  IF length(coalesce(p_note, '')) > 300 THEN PERFORM app.fail('bad_request', 'note is too long'); END IF;
  o := app.lock_order(p_number);
  v_from := array_position(flow, o.status); v_to := array_position(flow, p_status);
  IF v_from IS NULL THEN PERFORM app.fail('bad_request', 'An order that is "' || replace(o.status, '_', ' ') || '" cannot be moved to ' || p_status || '.'); END IF;
  IF v_to > v_from + 1 THEN PERFORM app.fail('bad_request', 'Move the order one step at a time.'); END IF;
  IF v_to > v_from AND v_to > 1 AND o.payment_method <> 'cod' AND o.payment_status <> 'paid' THEN PERFORM app.fail('bad_request', 'Payment is not confirmed yet.'); END IF;
  IF v_to < v_from - 1 THEN PERFORM app.fail('bad_request', 'You can only move an order one step back.'); END IF;
  IF v_to = v_from THEN RETURN jsonb_build_object('ok', true); END IF;
  UPDATE app.orders SET status = p_status WHERE id = o.id;
  PERFORM app.history(o.id, o.status, p_status, 'staff:' || app.staff_label(), coalesce(p_note, ''));
  PERFORM app.audit('order.status', 'order', o.id::text, jsonb_build_object('status', o.status), jsonb_build_object('status', p_status, 'note', p_note));
  PERFORM app.enqueue_job('email.order_status', jsonb_build_object('order', o.order_number, 'status', p_status), 'email.order_status:' || o.order_number || ':' || p_status);
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE FUNCTION public.admin_add_shipment(p_number text, p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o app.orders; v_carrier text; v_trk text; v_status text; v_sid uuid;
BEGIN
  PERFORM app.require_perm('orders.update');
  o := app.lock_order(p_number);
  IF o.status IN ('cancelled','expired','pending_payment','awaiting_bank_transfer','refunded') THEN PERFORM app.fail('bad_request', 'Only confirmed orders can be shipped.'); END IF;
  v_carrier := app.v_text(p_data, 'carrier', 60, 1); v_trk := app.v_text(p_data, 'trackingNumber', 80); v_status := app.v_text(p_data, 'status', 30, 1);
  IF v_status NOT IN ('preparing','shipped_abroad','arrived_lk','out_for_delivery','delivered','returned') THEN PERFORM app.fail('bad_request', 'Unknown shipment status.'); END IF;
  SELECT id INTO v_sid FROM app.shipments WHERE order_id = o.id AND tracking_number = v_trk;
  IF v_sid IS NULL THEN INSERT INTO app.shipments (order_id, carrier, tracking_number, status) VALUES (o.id, v_carrier, v_trk, v_status) RETURNING id INTO v_sid; END IF;
  UPDATE app.shipments SET status = v_status, carrier = v_carrier, shipped_at = coalesce(shipped_at, CASE WHEN v_status <> 'preparing' THEN now() END),
         delivered_at = CASE WHEN v_status = 'delivered' THEN now() ELSE delivered_at END WHERE id = v_sid;
  INSERT INTO app.shipment_events (shipment_id, status, location, note, staff_id) VALUES (v_sid, v_status, app.v_text(p_data, 'location', 80), app.v_text(p_data, 'note', 200), app.staff_actor());
  PERFORM app.audit('shipment.update', 'order', o.id::text, NULL, p_data);
  RETURN jsonb_build_object('ok', true);
END $$;

-- finance confirms a transfer IN THE BANK ACCOUNT (not from a screenshot)
CREATE FUNCTION public.admin_verify_bank_transfer(p_number text, p_reference text, p_confirm_checked boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o app.orders; ok boolean;
BEGIN
  PERFORM app.require_perm('payments.verify');
  IF p_confirm_checked IS DISTINCT FROM true THEN PERFORM app.fail('bad_request', 'Confirm that you checked the bank account.'); END IF;
  IF length(btrim(coalesce(p_reference, ''))) NOT BETWEEN 3 AND 80 THEN PERFORM app.fail('bad_request', 'Enter the bank reference.'); END IF;
  o := app.lock_order(p_number);
  IF o.payment_method <> 'bank_transfer' THEN PERFORM app.fail('bad_request', 'This order is not a bank transfer order.'); END IF;
  IF o.payment_status = 'paid' THEN PERFORM app.fail('conflict', 'This transfer was already confirmed.'); END IF;
  IF o.status NOT IN ('awaiting_bank_transfer', 'expired') THEN PERFORM app.fail('bad_request', 'This order cannot be confirmed in its current status.'); END IF;
  ok := app.consume_reservations(o.id);
  IF NOT ok THEN ok := app.retake_stock(o.id); END IF;
  IF NOT ok THEN PERFORM app.fail('conflict', 'Not enough stock left for this order. Restock first, or cancel and refund the transfer.'); END IF;
  UPDATE app.payments SET status = 'verified', reference = btrim(p_reference), verified_by = app.staff_actor(), verified_at = now(), paid_at = now() WHERE order_id = o.id AND provider = 'bank_transfer';
  UPDATE app.orders SET payment_status = 'paid', paid_at = now(), status = 'confirmed' WHERE id = o.id;
  PERFORM app.mark_sold(o.id);
  PERFORM app.history(o.id, o.status, 'confirmed', 'staff:' || app.staff_label(), 'bank transfer verified, ref ' || btrim(p_reference));
  PERFORM app.audit('payment.bank_verified', 'order', o.id::text, NULL, jsonb_build_object('reference', btrim(p_reference)));
  PERFORM app.enqueue_job('email.payment_received', jsonb_build_object('order', o.order_number), 'email.payment_received:' || o.order_number);
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE FUNCTION public.admin_cod_collected(p_number text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o app.orders;
BEGIN
  PERFORM app.require_perm('payments.verify');
  o := app.lock_order(p_number);
  IF o.payment_method <> 'cod' THEN PERFORM app.fail('bad_request', 'This is not a Cash on Delivery order.'); END IF;
  IF o.payment_status = 'cod_collected' THEN PERFORM app.fail('conflict', 'Cash was already recorded as collected.'); END IF;
  IF o.status IN ('cancelled', 'refunded') THEN PERFORM app.fail('bad_request', 'This order is cancelled.'); END IF;
  UPDATE app.payments SET status = 'cod_collected', verified_by = app.staff_actor(), verified_at = now(), paid_at = now() WHERE order_id = o.id AND provider = 'cod';
  UPDATE app.orders SET payment_status = 'cod_collected', paid_at = now() WHERE id = o.id;
  PERFORM app.audit('payment.cod_collected', 'order', o.id::text);
  RETURN jsonb_build_object('ok', true);
END $$;

-- cancel needs orders.update; cancel WITH refund needs refunds.create (finance / owner)
CREATE FUNCTION public.admin_cancel_order(p_number text, p_reason text, p_refund jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o app.orders; v_amount bigint; v_restock boolean; v_paid boolean; v_new_pay text; v_new_status text; v_pay uuid;
BEGIN
  IF p_refund IS NOT NULL AND p_refund <> 'null'::jsonb THEN PERFORM app.require_perm('refunds.create'); ELSE p_refund := NULL; PERFORM app.require_perm('orders.update'); END IF;
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 300 THEN PERFORM app.fail('bad_request', 'Give a reason (3 to 300 characters).'); END IF;
  o := app.lock_order(p_number);
  IF o.status IN ('cancelled', 'expired', 'refunded') THEN PERFORM app.fail('conflict', 'This order is already closed.'); END IF;
  IF o.status = 'delivered' AND p_refund IS NULL THEN PERFORM app.fail('bad_request', 'Delivered orders are closed with a refund/return, not a cancel.'); END IF;
  v_paid := o.payment_status IN ('paid', 'cod_collected');
  IF v_paid AND p_refund IS NULL THEN PERFORM app.fail('bad_request', 'This order is paid. Record a refund to cancel it.'); END IF;
  IF p_refund IS NOT NULL THEN
    v_amount := app.v_money(p_refund, 'amount', NULL, true);
    IF v_amount IS NULL OR v_amount > o.total_cents THEN PERFORM app.fail('bad_request', 'Refund amount must be between 0 and the order total.'); END IF;
    v_restock := app.v_bool(p_refund, 'restock', true);
  END IF;
  PERFORM app.release_reservations(o.id, 'reservation_released');
  IF p_refund IS NULL OR v_restock THEN PERFORM app.restock(o.id, app.staff_actor(), CASE WHEN p_refund IS NULL THEN 'order_cancelled' ELSE 'return' END); END IF;
  v_new_pay := o.payment_status;
  IF p_refund IS NOT NULL THEN
    SELECT id INTO v_pay FROM app.payments WHERE order_id = o.id ORDER BY created_at LIMIT 1;
    INSERT INTO app.refunds (order_id, payment_id, amount_cents, reason, restock, staff_id) VALUES (o.id, v_pay, v_amount, btrim(p_reason), v_restock, app.staff_actor());
    v_new_pay := CASE WHEN v_amount = o.total_cents THEN 'refunded' ELSE 'partially_refunded' END;
  ELSIF o.payment_status IN ('pending', 'unpaid', 'cod_pending') THEN v_new_pay := 'cancelled';
  END IF;
  v_new_status := CASE WHEN p_refund IS NOT NULL AND v_amount = o.total_cents THEN 'refunded' ELSE 'cancelled' END;
  UPDATE app.orders SET status = v_new_status, payment_status = v_new_pay, cancelled_at = now() WHERE id = o.id;
  UPDATE app.payments SET status = CASE WHEN p_refund IS NOT NULL THEN 'refunded' ELSE 'cancelled' END WHERE order_id = o.id AND status <> 'chargeback';
  PERFORM app.history(o.id, o.status, v_new_status, 'staff:' || app.staff_label(), btrim(p_reason));
  PERFORM app.audit(CASE WHEN p_refund IS NOT NULL THEN 'order.refund' ELSE 'order.cancel' END, 'order', o.id::text, NULL, jsonb_build_object('reason', p_reason, 'refund', p_refund));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE FUNCTION public.admin_resolve_review(p_number text, p_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o app.orders;
BEGIN
  PERFORM app.require_perm('payments.verify');
  IF length(btrim(coalesce(p_note, ''))) NOT BETWEEN 3 AND 300 THEN PERFORM app.fail('bad_request', 'Say what you did (3 to 300 characters).'); END IF;
  o := app.lock_order(p_number);
  IF NOT o.needs_review THEN PERFORM app.fail('not_found', 'No open review on this order.'); END IF;
  UPDATE app.orders SET needs_review = false WHERE id = o.id;
  PERFORM app.audit('order.review_resolved', 'order', o.id::text, NULL, jsonb_build_object('note', p_note));
  RETURN jsonb_build_object('ok', true);
END $$;

-- ===========================================================================
-- Dashboard, customers, audit, backups, promo codes, staff list
-- ===========================================================================
CREATE FUNCTION backup_health() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_last timestamptz; v_latest jsonb; v_problems text[] := '{}'; v_max_h numeric := (SELECT backup_max_age_hours FROM app.ops_settings WHERE id = 1);
BEGIN
  SELECT max(finished_at) INTO v_last FROM app.backup_job_status WHERE kind IN ('full', 'diff', 'incr') AND status = 'ok';
  SELECT coalesce(jsonb_object_agg(kind, to_jsonb(b) - 'id'), '{}'::jsonb) INTO v_latest FROM (SELECT DISTINCT ON (kind) * FROM app.backup_job_status ORDER BY kind, started_at DESC) b;
  IF v_last IS NULL THEN v_problems := v_problems || 'No successful backup has been recorded yet.'::text;
  ELSIF v_last < now() - make_interval(secs => (v_max_h * 3600)::int) THEN v_problems := v_problems || ('Last successful backup is ' || round(extract(epoch FROM now() - v_last) / 3600) || ' hours old.')::text; END IF;
  IF v_latest #>> '{check,status}' = 'failed' THEN v_problems := v_problems || 'The last backup check failed.'::text; END IF;
  IF v_latest #>> '{restore_test,status}' = 'failed' THEN v_problems := v_problems || 'The last restore test failed.'::text; END IF;
  IF v_latest #>> '{image_sync,status}' = 'failed' THEN v_problems := v_problems || 'The last product image backup failed.'::text; END IF;
  RETURN jsonb_build_object('ok', cardinality(v_problems) = 0, 'problems', to_jsonb(v_problems), 'lastSuccessfulBackupAt', v_last, 'latest', v_latest);
END $$;

CREATE FUNCTION public.admin_dashboard() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb;
BEGIN
  PERFORM app.require_perm('dashboard.view');
  WITH o AS (SELECT * FROM app.orders x WHERE app.staff_sees_order(x.id))
  SELECT jsonb_build_object(
    'received', app.rs(coalesce((SELECT sum(total_cents) FROM o WHERE payment_status IN ('paid', 'cod_collected')), 0)::bigint),
    'booked', app.rs(coalesce((SELECT sum(total_cents) FROM o WHERE status NOT IN ('cancelled', 'expired', 'refunded', 'pending_payment')), 0)::bigint),
    'orders', (SELECT count(*) FROM o WHERE status NOT IN ('cancelled', 'expired')),
    'byStatus', coalesce((SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM o GROUP BY status) s), '{}'::jsonb),
    'last7days', (SELECT jsonb_agg(jsonb_build_object('day', to_char(dd, 'YYYY-MM-DD'), 'total', app.rs(coalesce((SELECT sum(total_cents) FROM o
                     WHERE (placed_at AT TIME ZONE 'Asia/Colombo')::date = dd::date AND status NOT IN ('cancelled', 'expired', 'pending_payment')), 0)::bigint)) ORDER BY dd)
                  FROM generate_series((now() AT TIME ZONE 'Asia/Colombo')::date - 6, (now() AT TIME ZONE 'Asia/Colombo')::date, interval '1 day') dd),
    'lowStock', coalesce((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('slug', p.slug, 'name', p.name, 'size', v.size, 'available', i.on_hand - i.reserved, 'reorder_level', i.reorder_level) x
                  FROM app.inventory i JOIN app.product_variants v ON v.id = i.variant_id JOIN app.products p ON p.id = v.product_id
                 WHERE p.status = 'active' AND v.active AND i.on_hand - i.reserved <= i.reorder_level AND app.can_shop(p.shop_id) ORDER BY i.on_hand - i.reserved, p.name LIMIT 50) q), '[]'::jsonb),
    'needsReview', (SELECT count(*) FROM o WHERE needs_review),
    'payments', jsonb_build_object('bank', (SELECT count(*) FROM o WHERE status = 'awaiting_bank_transfer'),
                  'cod_uncollected', (SELECT count(*) FROM o WHERE payment_status = 'cod_pending' AND status = 'delivered'),
                  'card_pending', (SELECT count(*) FROM o WHERE status = 'pending_payment')),
    'queue', CASE WHEN app.has_perm('backups.read') THEN (SELECT jsonb_build_object('waiting', count(*) FILTER (WHERE status = 'queued'), 'running', count(*) FILTER (WHERE status = 'running'),
                  'dead', count(*) FILTER (WHERE status = 'dead'), 'oldestWaitingMinutes', round(extract(epoch FROM now() - min(created_at) FILTER (WHERE status = 'queued')) / 60)) FROM app.jobs) END,
    'backups', CASE WHEN app.has_perm('backups.read') THEN app.backup_health() END,
    'payhere', (SELECT jsonb_build_object('mode', payhere_mode, 'configured', payhere_configured) FROM app.ops_settings WHERE id = 1)
  ) INTO r;
  RETURN r;
END $$;

CREATE FUNCTION public.admin_customers(p_q text DEFAULT NULL, p_limit int DEFAULT 100, p_offset int DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb; v_like text;
BEGIN
  PERFORM app.require_perm('customers.read');
  IF p_limit NOT BETWEEN 1 AND 200 OR p_offset < 0 OR length(coalesce(p_q, '')) > 80 THEN PERFORM app.fail('bad_request', 'invalid filter'); END IF;
  v_like := CASE WHEN coalesce(p_q, '') = '' THEN NULL ELSE '%' || replace(replace(p_q, '%', ''), '_', '') || '%' END;
  SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'last_order' DESC), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('key', coalesce(c.id::text, 'phone:' || o.ship_phone), 'name', max(coalesce(c.name, o.ship_name)), 'phone', max(o.ship_phone),
      'email', max(coalesce(c.email::text, o.ship_email::text)), 'account', bool_or(c.id IS NOT NULL), 'orders', count(o.id),
      'spent', app.rs(coalesce(sum(o.total_cents) FILTER (WHERE o.payment_status IN ('paid', 'cod_collected')), 0)::bigint), 'last_order', max(o.placed_at)) x
      FROM app.orders o LEFT JOIN app.customers c ON c.id = o.customer_id
     WHERE v_like IS NULL OR o.ship_name ILIKE v_like OR o.ship_phone ILIKE v_like OR o.ship_email::text ILIKE v_like
     GROUP BY coalesce(c.id::text, 'phone:' || o.ship_phone) ORDER BY max(o.placed_at) DESC LIMIT p_limit OFFSET p_offset) q;
  PERFORM app.audit('customers.list', 'customers', NULL, NULL, jsonb_build_object('q', p_q));
  RETURN r;
END $$;

CREATE FUNCTION public.admin_audit(p_before bigint DEFAULT NULL, p_action text DEFAULT NULL, p_limit int DEFAULT 100) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app.require_perm('audit.read');
  IF p_limit NOT BETWEEN 1 AND 200 THEN PERFORM app.fail('bad_request', 'invalid limit'); END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id DESC) FROM (SELECT id, actor_type, actor_label, action, entity_type, entity_id, before, after, ip, created_at
    FROM app.audit_logs WHERE (p_before IS NULL OR id < p_before) AND (p_action IS NULL OR action LIKE replace(p_action, '%', '') || '%') ORDER BY id DESC LIMIT p_limit) a), '[]'::jsonb);
END $$;

CREATE FUNCTION public.admin_backups() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app.require_perm('backups.read');
  RETURN app.backup_health() || jsonb_build_object('recent', coalesce((SELECT jsonb_agg(to_jsonb(b) - 'id' ORDER BY b.started_at DESC) FROM (SELECT * FROM app.backup_job_status ORDER BY started_at DESC LIMIT 50) b), '[]'::jsonb),
    'queue', (SELECT coalesce(jsonb_object_agg(type || ':' || status, n), '{}'::jsonb) FROM (SELECT type, status, count(*) n FROM app.jobs WHERE status <> 'done' GROUP BY type, status) q));
END $$;

CREATE FUNCTION public.admin_coupons() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app.require_perm('settings.write');
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code::text, 'kind', c.kind, 'value', CASE WHEN c.kind = 'fixed' THEN app.rs(c.value) ELSE c.value END,
     'min_subtotal', app.rs(c.min_subtotal_cents), 'starts_at', c.starts_at, 'ends_at', c.ends_at, 'max_redemptions', c.max_redemptions, 'active', c.active,
     'used', (SELECT count(*) FROM app.coupon_redemptions r WHERE r.coupon_id = c.id)) ORDER BY c.created_at DESC) FROM app.coupons c), '[]'::jsonb);
END $$;
CREATE FUNCTION public.admin_create_coupon(p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_code text; v_kind text; v_value numeric; v_id uuid; v_min bigint; v_starts timestamptz; v_ends timestamptz; v_max int;
BEGIN
  PERFORM app.require_perm('settings.write');
  v_code := app.v_match(app.v_text(p_data, 'code', 30, 3), '^[A-Za-z0-9_-]{3,30}$', 'Codes use letters, numbers, - and _ (3 to 30).');
  v_kind := app.v_text(p_data, 'kind', 10, 1);
  IF v_kind NOT IN ('percent', 'fixed') THEN PERFORM app.fail('bad_request', 'kind must be percent or fixed'); END IF;
  IF jsonb_typeof(p_data -> 'value') <> 'number' OR (p_data ->> 'value')::numeric <= 0 THEN PERFORM app.fail('bad_request', 'value must be more than 0'); END IF;
  v_value := (p_data ->> 'value')::numeric;
  IF v_kind = 'percent' AND (v_value < 1 OR v_value > 90 OR v_value <> trunc(v_value)) THEN PERFORM app.fail('bad_request', 'Percent discounts must be a whole number from 1 to 90.'); END IF;
  v_min := app.v_money(p_data, 'minSubtotal', 0, false);
  BEGIN
    v_starts := nullif(p_data ->> 'startsAt', '')::timestamptz; v_ends := nullif(p_data ->> 'endsAt', '')::timestamptz;
  EXCEPTION WHEN others THEN PERFORM app.fail('bad_request', 'invalid date'); END;
  IF p_data ? 'maxRedemptions' AND p_data -> 'maxRedemptions' <> 'null'::jsonb THEN v_max := (p_data ->> 'maxRedemptions')::int; IF v_max < 1 THEN PERFORM app.fail('bad_request', 'max uses must be 1 or more'); END IF; END IF;
  INSERT INTO app.coupons (code, kind, value, min_subtotal_cents, starts_at, ends_at, max_redemptions, active)
  VALUES (v_code, v_kind, CASE WHEN v_kind = 'percent' THEN v_value::bigint ELSE round(v_value * 100)::bigint END, v_min, v_starts, v_ends, v_max, app.v_bool(p_data, 'active', true))
  RETURNING id INTO v_id;
  PERFORM app.audit('coupon.create', 'coupon', v_id::text, NULL, p_data);
  RETURN jsonb_build_object('id', v_id);
END $$;
CREATE FUNCTION public.admin_set_coupon_active(p_id uuid, p_active boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app.require_perm('settings.write');
  UPDATE app.coupons SET active = coalesce(p_active, false) WHERE id = p_id;
  PERFORM app.audit('coupon.update', 'coupon', p_id::text, NULL, jsonb_build_object('active', p_active));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE FUNCTION public.admin_staff_list() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app.require_perm('staff.manage');
  RETURN jsonb_build_object(
    'staff', coalesce((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'username', u.username::text, 'email', u.email::text, 'display_name', u.display_name, 'status', u.status,
       'last_login_at', u.last_login_at, 'mfa', EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = u.id AND f.status = 'verified'),
       'roles', coalesce((SELECT jsonb_agg(r.code ORDER BY r.code) FROM app.staff_roles sr JOIN app.roles r ON r.id = sr.role_id WHERE sr.staff_id = u.id), '[]'::jsonb),
       'shops', coalesce((SELECT jsonb_agg(s.slug ORDER BY s.slug) FROM app.staff_shop_access a JOIN app.shops s ON s.id = a.shop_id WHERE a.staff_id = u.id), '[]'::jsonb)) ORDER BY u.created_at) FROM app.staff_users u), '[]'::jsonb),
    'roles', coalesce((SELECT jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name, 'description', r.description, 'shop_scoped', r.shop_scoped,
       'permissions', (SELECT jsonb_agg(rp.permission ORDER BY rp.permission) FROM app.role_permissions rp WHERE rp.role_id = r.id)) ORDER BY r.name) FROM app.roles r), '[]'::jsonb));
END $$;

-- Staff accounts: the admin-staff Edge Function creates the Supabase Auth user (service role), then calls this
-- WITH THE CALLER'S OWN TOKEN, so the staff.manage permission is checked here in the database.
CREATE FUNCTION public.admin_staff_save(p_staff_id uuid, p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_roles text[]; v_shops text[]; n int; v_exists boolean; v_kind text;
BEGIN
  PERFORM app.require_perm('staff.manage');
  SELECT raw_app_meta_data ->> 'kind' INTO v_kind FROM auth.users WHERE id = p_staff_id;
  IF NOT FOUND THEN PERFORM app.fail('not_found', 'That sign-in account does not exist.'); END IF;
  IF coalesce(v_kind, '') <> 'staff' THEN PERFORM app.fail('bad_request', 'Only accounts created as staff can be given staff roles.'); END IF;
  v_exists := EXISTS (SELECT 1 FROM app.staff_users WHERE id = p_staff_id);
  IF NOT v_exists THEN
    INSERT INTO app.staff_users (id, username, email, display_name)
    VALUES (p_staff_id, app.v_match(app.v_text(p_data, 'username', 40, 3), '^[A-Za-z0-9._-]{3,40}$', 'Username: 3 to 40 letters, numbers, . _ -'),
            nullif(app.v_text(p_data, 'email', 200), ''), app.v_text(p_data, 'displayName', 80, 1));
  ELSE
    IF p_data ? 'displayName' THEN UPDATE app.staff_users SET display_name = app.v_text(p_data, 'displayName', 80, 1) WHERE id = p_staff_id; END IF;
  END IF;
  IF p_data ? 'status' THEN
    IF p_data ->> 'status' NOT IN ('active', 'disabled') THEN PERFORM app.fail('bad_request', 'invalid status'); END IF;
    IF p_staff_id = auth.uid() AND p_data ->> 'status' = 'disabled' THEN PERFORM app.fail('bad_request', 'You cannot disable yourself.'); END IF;
    UPDATE app.staff_users SET status = p_data ->> 'status' WHERE id = p_staff_id;
  END IF;
  IF p_data ? 'roles' THEN
    v_roles := app.v_text_array(p_data, 'roles', 7, '^[a-z_]{2,40}$', 'invalid role');
    IF cardinality(v_roles) = 0 THEN PERFORM app.fail('bad_request', 'Give at least one role.'); END IF;
    SELECT count(*) INTO n FROM app.roles WHERE code = ANY (v_roles);
    IF n <> (SELECT count(DISTINCT x) FROM unnest(v_roles) x) THEN PERFORM app.fail('bad_request', 'Unknown role.'); END IF;
    DELETE FROM app.staff_roles WHERE staff_id = p_staff_id;
    INSERT INTO app.staff_roles (staff_id, role_id) SELECT p_staff_id, id FROM app.roles WHERE code = ANY (v_roles);
  END IF;
  IF p_data ? 'shops' THEN
    v_shops := app.v_text_array(p_data, 'shops', 20, '^[a-z0-9]+(-[a-z0-9]+)*$', 'invalid department');
    SELECT count(*) INTO n FROM app.shops WHERE slug = ANY (v_shops);
    IF n <> (SELECT count(DISTINCT x) FROM unnest(v_shops) x) THEN PERFORM app.fail('bad_request', 'Unknown department.'); END IF;
    DELETE FROM app.staff_shop_access WHERE staff_id = p_staff_id;
    INSERT INTO app.staff_shop_access (staff_id, shop_id) SELECT p_staff_id, id FROM app.shops WHERE slug = ANY (v_shops);
  END IF;
  -- never leave the shop without an active owner
  IF NOT EXISTS (SELECT 1 FROM app.staff_users u JOIN app.staff_roles sr ON sr.staff_id = u.id JOIN app.roles r ON r.id = sr.role_id WHERE r.code = 'owner' AND u.status = 'active') THEN
    PERFORM app.fail('bad_request', 'At least one active owner account is required.');
  END IF;
  PERFORM app.audit(CASE WHEN v_exists THEN 'staff.update' ELSE 'staff.create' END, 'staff', p_staff_id::text, NULL, p_data);
  RETURN jsonb_build_object('ok', true, 'id', p_staff_id);
END $$;

-- ===========================================================================
-- Customer self-service
-- ===========================================================================
CREATE FUNCTION public.my_profile() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email::text, 'phone', c.phone,
    'verified', (SELECT u.email_confirmed_at IS NOT NULL FROM auth.users u WHERE u.id = c.id),
    'address', (SELECT jsonb_build_object('name', a.name, 'phone', a.phone, 'line1', a.line1, 'city', a.city, 'district', d.name)
                  FROM app.customer_addresses a JOIN app.districts d ON d.code = a.district_code WHERE a.customer_id = c.id AND a.is_default))
    FROM app.customers c WHERE c.id = auth.uid() AND c.status = 'active'
$$;
CREATE FUNCTION public.update_my_profile(p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_name text; v_phone text; v_d text; a jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM app.customers WHERE id = auth.uid() AND status = 'active') THEN PERFORM app.fail('unauthorized', 'Please sign in to your account.'); END IF;
  v_name := app.v_text(p_data, 'name', 80, 2); v_phone := app.v_text(p_data, 'phone', 20);
  UPDATE app.customers SET name = v_name, phone = nullif(v_phone, '') WHERE id = auth.uid();
  a := p_data -> 'address';
  IF a IS NOT NULL AND a <> 'null'::jsonb THEN
    SELECT code INTO v_d FROM app.districts WHERE code = a ->> 'district' OR lower(name) = lower(a ->> 'district');
    IF v_d IS NULL THEN PERFORM app.fail('bad_request', 'Please choose your district.'); END IF;
    DELETE FROM app.customer_addresses WHERE customer_id = auth.uid() AND is_default;
    INSERT INTO app.customer_addresses (customer_id, name, phone, line1, city, district_code, is_default)
    VALUES (auth.uid(), v_name, coalesce(v_phone, ''), app.v_text(a, 'line1', 200, 4), app.v_text(a, 'city', 60, 2), v_d, true);
  END IF;
  RETURN public.my_profile();
END $$;

-- ---------- grants: browser roles may call only these ----------
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND (p.proname LIKE 'admin\_%' OR p.proname IN ('my_profile', 'update_my_profile')) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.has_perm(text), app.current_aal(), app.must_change_password() TO authenticated;
