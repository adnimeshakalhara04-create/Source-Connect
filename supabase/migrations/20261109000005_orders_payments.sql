-- Orders, stock reservations and payments (ported from server/src/orders/{create,reservations,payments}.ts).
-- Every function runs in ONE transaction: stock, order, payment and audit rows change together or not at all.
SET search_path = app, extensions;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ---------- helpers ----------
CREATE FUNCTION sha256_hex(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT encode(extensions.digest(p, 'sha256'), 'hex') $$;
CREATE FUNCTION random_token(p_bytes int DEFAULT 24) RETURNS text LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT rtrim(translate(encode(extensions.gen_random_bytes(p_bytes), 'base64'), '+/', '-_'), '=')
$$;
CREATE FUNCTION new_order_number() RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea := extensions.gen_random_bytes(6); s text := ''; i int;
BEGIN
  FOR i IN 0..5 LOOP s := s || substr(a, (get_byte(b, i) % length(a)) + 1, 1); END LOOP;
  RETURN 'SC-' || to_char(now() AT TIME ZONE 'UTC', 'YYMMDD') || '-' || s;
END $$;
-- PayHere amount: exactly two decimals, no thousands separator (123450 -> "1234.50")
CREATE FUNCTION format_amount(p_cents bigint) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT (p_cents / 100)::text || '.' || lpad((p_cents % 100)::text, 2, '0')
$$;
-- "1234.5" / "1234.50" -> 123450 cents; NULL when malformed (no floating point)
CREATE FUNCTION parse_amount(p text) RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE m text[];
BEGIN
  m := regexp_match(btrim(coalesce(p, '')), '^([0-9]{1,10})(?:\.([0-9]{1,2}))?$');
  IF m IS NULL THEN RETURN NULL; END IF;
  RETURN m[1]::bigint * 100 + rpad(coalesce(m[2], '0'), 2, '0')::bigint;
END $$;
CREATE FUNCTION history(p_order uuid, p_from text, p_to text, p_actor text, p_note text DEFAULT '') RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO app.order_status_history (order_id, from_status, to_status, actor, note) VALUES (p_order, p_from, p_to, p_actor, coalesce(p_note, ''))
$$;
CREATE FUNCTION fail(p_code text, p_message text, p_detail jsonb DEFAULT NULL) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = p_message, HINT = p_code, DETAIL = coalesce(p_detail::text, ''); END $$;

-- ---------- stock ----------
CREATE FUNCTION reserve(p_order uuid, p_items jsonb, p_minutes int) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE it jsonb; n int;
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) ORDER BY value ->> 'variantId' LOOP
    UPDATE app.inventory SET reserved = reserved + (it ->> 'qty')::int WHERE variant_id = (it ->> 'variantId')::uuid AND on_hand - reserved >= (it ->> 'qty')::int;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN PERFORM app.fail('stock_changed', 'Sorry, an item just sold out. Please check your cart again.'); END IF;
    INSERT INTO app.stock_reservations (order_id, variant_id, quantity, expires_at) VALUES (p_order, (it ->> 'variantId')::uuid, (it ->> 'qty')::int, now() + make_interval(mins => p_minutes));
    INSERT INTO app.inventory_movements (variant_id, delta_reserved, reason, order_id) VALUES ((it ->> 'variantId')::uuid, (it ->> 'qty')::int, 'order_reserved', p_order);
  END LOOP;
END $$;

CREATE FUNCTION take_stock(p_order uuid, p_items jsonb, p_staff uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE it jsonb; n int;
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) ORDER BY value ->> 'variantId' LOOP
    UPDATE app.inventory SET on_hand = on_hand - (it ->> 'qty')::int WHERE variant_id = (it ->> 'variantId')::uuid AND on_hand - reserved >= (it ->> 'qty')::int;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN PERFORM app.fail('stock_changed', 'Sorry, an item just sold out. Please check your cart again.'); END IF;
    INSERT INTO app.inventory_movements (variant_id, delta_on_hand, reason, order_id, staff_id) VALUES ((it ->> 'variantId')::uuid, -(it ->> 'qty')::int, 'order_consumed', p_order, p_staff);
  END LOOP;
END $$;

-- payment confirmed: reservations become sold stock. false when they had already expired.
CREATE FUNCTION consume_reservations(p_order uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE x record; found_any boolean := false;
BEGIN
  FOR x IN SELECT id, variant_id, quantity FROM app.stock_reservations WHERE order_id = p_order AND state = 'active' ORDER BY variant_id FOR UPDATE LOOP
    found_any := true;
    UPDATE app.inventory SET on_hand = on_hand - x.quantity, reserved = reserved - x.quantity WHERE variant_id = x.variant_id;
    UPDATE app.stock_reservations SET state = 'consumed' WHERE id = x.id;
    INSERT INTO app.inventory_movements (variant_id, delta_on_hand, delta_reserved, reason, order_id) VALUES (x.variant_id, -x.quantity, -x.quantity, 'order_consumed', p_order);
  END LOOP;
  RETURN found_any;
END $$;

CREATE FUNCTION release_reservations(p_order uuid, p_reason text DEFAULT 'reservation_released') RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE x record; n int := 0;
BEGIN
  FOR x IN SELECT id, variant_id, quantity FROM app.stock_reservations WHERE order_id = p_order AND state = 'active' ORDER BY variant_id FOR UPDATE LOOP
    UPDATE app.inventory SET reserved = reserved - x.quantity WHERE variant_id = x.variant_id;
    UPDATE app.stock_reservations SET state = 'released' WHERE id = x.id;
    INSERT INTO app.inventory_movements (variant_id, delta_reserved, reason, order_id) VALUES (x.variant_id, -x.quantity, p_reason, p_order);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- sold stock back on the shelf (cancelled COD order, refund with restock)
CREATE FUNCTION restock(p_order uuid, p_staff uuid, p_reason text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE x record; n int := 0;
BEGIN
  FOR x IN SELECT variant_id, -sum(delta_on_hand)::int AS qty FROM app.inventory_movements
            WHERE order_id = p_order AND reason IN ('order_consumed', 'order_cancelled', 'return') GROUP BY variant_id HAVING -sum(delta_on_hand) > 0 ORDER BY variant_id LOOP
    UPDATE app.inventory SET on_hand = on_hand + x.qty WHERE variant_id = x.variant_id;
    INSERT INTO app.inventory_movements (variant_id, delta_on_hand, reason, order_id, staff_id) VALUES (x.variant_id, x.qty, p_reason, p_order, p_staff);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- late payment after the hold expired: take the stock again if it is still there
CREATE FUNCTION retake_stock(p_order uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE x record;
BEGIN
  PERFORM 1 FROM app.inventory WHERE variant_id IN (SELECT variant_id FROM app.order_items WHERE order_id = p_order) ORDER BY variant_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM app.order_items oi JOIN app.inventory i ON i.variant_id = oi.variant_id WHERE oi.order_id = p_order AND i.on_hand - i.reserved < oi.quantity) THEN RETURN false; END IF;
  FOR x IN SELECT variant_id, quantity FROM app.order_items WHERE order_id = p_order AND variant_id IS NOT NULL ORDER BY variant_id LOOP
    UPDATE app.inventory SET on_hand = on_hand - x.quantity WHERE variant_id = x.variant_id;
    INSERT INTO app.inventory_movements (variant_id, delta_on_hand, reason, order_id, note) VALUES (x.variant_id, -x.quantity, 'order_consumed', p_order, 'late payment');
  END LOOP;
  RETURN true;
END $$;

CREATE FUNCTION mark_sold(p_order uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE app.products SET sold_count = sold_count + x.q
    FROM (SELECT product_id, sum(quantity)::int q FROM app.order_items WHERE order_id = p_order AND product_id IS NOT NULL GROUP BY product_id) x
   WHERE app.products.id = x.product_id
$$;

-- every minute (pg_cron): unpaid orders whose hold ran out give their stock back
CREATE FUNCTION release_expired_reservations() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o record; n int := 0;
BEGIN
  FOR o IN SELECT ord.id, ord.status FROM app.orders ord
            WHERE ord.id IN (SELECT DISTINCT order_id FROM app.stock_reservations WHERE state = 'active' AND expires_at <= now())
            ORDER BY ord.id LIMIT 200 FOR UPDATE OF ord SKIP LOCKED LOOP
    IF app.release_reservations(o.id) > 0 THEN n := n + 1; END IF;
    IF o.status IN ('pending_payment', 'awaiting_bank_transfer') THEN
      UPDATE app.orders SET status = 'expired', payment_status = CASE WHEN payment_status IN ('pending', 'unpaid') THEN 'cancelled' ELSE payment_status END WHERE id = o.id;
      UPDATE app.payments SET status = 'cancelled' WHERE order_id = o.id AND status IN ('initiated', 'pending', 'awaiting_receipt');
      PERFORM app.history(o.id, o.status, 'expired', 'system', 'payment not received in time; stock released');
    END IF;
  END LOOP;
  RETURN n;
END $$;
SELECT cron.schedule('release-expired-reservations', '* * * * *', 'SELECT app.release_expired_reservations()');
SELECT cron.schedule('prune-rate-limits', '17 * * * *', $$DELETE FROM app.rate_limits WHERE window_start < now() - interval '1 day'$$);

-- ---------- order view for the buyer ----------
CREATE FUNCTION order_view(p_order uuid, p_full boolean) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'number', o.order_number, 'placedAt', o.placed_at, 'status', o.status, 'paymentStatus', o.payment_status, 'paymentMethod', o.payment_method,
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.product_slug, 'name', i.product_name, 'variant', i.variant_label, 'qty', i.quantity,
               'price', app.rs(i.unit_price_cents), 'lineTotal', app.rs(i.line_total_cents), 'origin', i.origin_code) ORDER BY i.product_name)
               FROM app.order_items i WHERE i.order_id = o.id), '[]'::jsonb),
    'subtotal', app.rs(o.subtotal_cents), 'discount', app.rs(o.discount_cents), 'shipping', app.rs(o.shipping_cents), 'total', app.rs(o.total_cents),
    'timeline', coalesce((SELECT jsonb_agg(jsonb_build_object('status', h.to_status, 'at', h.created_at) ORDER BY h.created_at, h.id) FROM app.order_status_history h WHERE h.order_id = o.id), '[]'::jsonb),
    'shipments', coalesce((SELECT jsonb_agg(jsonb_build_object('carrier', s.carrier, 'trackingNumber', s.tracking_number, 'status', s.status, 'shippedAt', s.shipped_at, 'deliveredAt', s.delivered_at) ORDER BY s.created_at)
               FROM app.shipments s WHERE s.order_id = o.id), '[]'::jsonb),
    'bankInstructions', CASE WHEN o.payment_method = 'bank_transfer' AND o.status = 'awaiting_bank_transfer'
                             THEN (SELECT instructions FROM app.payment_settings WHERE method = 'bank_transfer') END,
    'customer', CASE WHEN p_full THEN jsonb_build_object('name', o.ship_name, 'phone', o.ship_phone, 'email', o.ship_email, 'address', o.ship_line1, 'city', o.ship_city, 'district', d.name)
                     ELSE jsonb_build_object('name', split_part(o.ship_name, ' ', 1)) END)
  FROM app.orders o JOIN app.districts d ON d.code = o.ship_district WHERE o.id = p_order
$$;

-- ===========================================================================
-- place_order — called ONLY by the `checkout` Edge Function (service role).
-- p_customer_id comes from the verified Supabase Auth token, never from the body.
-- ===========================================================================
CREATE FUNCTION public.place_order(p_input jsonb, p_customer_id uuid DEFAULT NULL, p_idempotency_key text DEFAULT NULL, p_request_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c jsonb := p_input -> 'customer'; k text;
  v_name text; v_phone text; v_email text; v_addr text; v_city text; v_note text; v_district text; v_pay text; v_coupon text; v_expected numeric;
  v_existing record; v_pay_row record; q jsonb; v_status text; v_pay_status text; v_number text; v_order uuid; v_token text := app.random_token(24);
  v_line jsonb; v_items jsonb; v_reserve_minutes int;
BEGIN
  -- ---- validate input (same rules as the OrderInput Zod schema) ----
  IF jsonb_typeof(p_input) <> 'object' OR jsonb_typeof(c) <> 'object' THEN PERFORM app.fail('bad_request', 'Some details are missing.'); END IF;
  FOR k IN SELECT jsonb_object_keys(p_input) LOOP IF k NOT IN ('items', 'customer', 'payment', 'coupon', 'expectedTotal') THEN PERFORM app.fail('bad_request', 'Unknown field: ' || k); END IF; END LOOP;
  FOR k IN SELECT jsonb_object_keys(c) LOOP IF k NOT IN ('name', 'phone', 'email', 'address', 'city', 'district', 'note') THEN PERFORM app.fail('bad_request', 'Unknown field: ' || k); END IF; END LOOP;
  v_name := btrim(coalesce(c ->> 'name', '')); v_addr := btrim(coalesce(c ->> 'address', '')); v_city := btrim(coalesce(c ->> 'city', ''));
  v_email := lower(btrim(coalesce(c ->> 'email', ''))); v_note := btrim(coalesce(c ->> 'note', ''));
  v_phone := regexp_replace(coalesce(c ->> 'phone', ''), '[\s-]', '', 'g');
  IF length(v_name) NOT BETWEEN 2 AND 80 THEN PERFORM app.fail('bad_request', 'Please enter your name.'); END IF;
  IF v_phone !~ '^((\+94|0)?7[0-9]{8}|(\+94|0)[0-9]{9})$' THEN PERFORM app.fail('bad_request', 'Enter a Sri Lankan phone number, e.g. 077 123 4567.'); END IF;
  IF v_email <> '' AND (length(v_email) > 200 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN PERFORM app.fail('bad_request', 'Please enter a valid email address.'); END IF;
  IF length(v_addr) NOT BETWEEN 4 AND 200 THEN PERFORM app.fail('bad_request', 'Please enter your address.'); END IF;
  IF length(v_city) NOT BETWEEN 2 AND 60 THEN PERFORM app.fail('bad_request', 'Please enter your city.'); END IF;
  IF length(v_note) > 500 THEN PERFORM app.fail('bad_request', 'The delivery note is too long.'); END IF;
  SELECT code INTO v_district FROM app.districts WHERE code = c ->> 'district' OR lower(name) = lower(c ->> 'district');
  IF v_district IS NULL THEN PERFORM app.fail('bad_request', 'Please choose your district.'); END IF;
  v_pay := p_input ->> 'payment';
  IF v_pay NOT IN ('payhere', 'cod', 'bank_transfer') OR v_pay IS NULL THEN PERFORM app.fail('bad_request', 'Please choose how you want to pay.'); END IF;
  v_coupon := nullif(btrim(coalesce(p_input ->> 'coupon', '')), '');
  IF p_input ? 'expectedTotal' AND jsonb_typeof(p_input -> 'expectedTotal') = 'number' THEN v_expected := (p_input ->> 'expectedTotal')::numeric; END IF;
  IF p_idempotency_key IS NOT NULL AND p_idempotency_key !~ '^[A-Za-z0-9_-]{16,80}$' THEN p_idempotency_key := NULL; END IF;

  -- ---- same checkout twice (double click / retry) ----
  IF p_idempotency_key IS NOT NULL THEN
    SELECT order_number, customer_id INTO v_existing FROM app.orders WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_existing.customer_id IS DISTINCT FROM p_customer_id THEN PERFORM app.fail('conflict', 'This checkout was already used.'); END IF;
      PERFORM app.fail('duplicate_order', 'This order was already placed.', jsonb_build_object('orderNumber', v_existing.order_number));
    END IF;
  END IF;
  SELECT enabled, instructions INTO v_pay_row FROM app.payment_settings WHERE method = v_pay;
  IF NOT coalesce(v_pay_row.enabled, false) THEN PERFORM app.fail('bad_request', 'This payment method is not available right now.'); END IF;
  IF v_pay = 'payhere' AND NOT (SELECT payhere_configured FROM app.ops_settings WHERE id = 1) THEN PERFORM app.fail('bad_request', 'Card payment is not set up yet. Please choose another payment method.'); END IF;
  IF v_pay = 'payhere' AND v_email = '' THEN PERFORM app.fail('bad_request', 'Please enter your email address for card payments (PayHere sends your receipt there).'); END IF;

  -- ---- price with locked stock rows ----
  q := app.price_cart(p_input -> 'items', v_coupon, true);
  IF jsonb_array_length(q -> 'issues') > 0 THEN PERFORM app.fail('stock_changed', 'Some items in your cart changed. Please check your cart again.', jsonb_build_object('issues', q -> 'issues')); END IF;
  IF v_coupon IS NOT NULL AND q -> 'coupon' = 'null'::jsonb THEN PERFORM app.fail('bad_request', coalesce(q ->> 'couponError', 'This promo code is not valid.')); END IF;
  IF jsonb_array_length(q -> 'lines') = 0 OR (q ->> 'totalCents')::bigint <= 0 THEN PERFORM app.fail('bad_request', 'Your cart is empty.'); END IF;
  IF v_expected IS NOT NULL AND round(v_expected * 100) <> (q ->> 'totalCents')::bigint THEN
    PERFORM app.fail('price_changed', 'Prices changed since you opened checkout. Please review the new total.', jsonb_build_object('total', app.rs((q ->> 'totalCents')::bigint)));
  END IF;

  v_status := CASE v_pay WHEN 'payhere' THEN 'pending_payment' WHEN 'bank_transfer' THEN 'awaiting_bank_transfer' ELSE 'confirmed' END;
  v_pay_status := CASE WHEN v_pay = 'cod' THEN 'cod_pending' ELSE 'pending' END;
  FOR k IN 1..5 LOOP
    v_number := app.new_order_number();
    INSERT INTO app.orders (order_number, customer_id, tracking_token_hash, idempotency_key, ship_name, ship_phone, ship_email, ship_line1, ship_city, ship_district, note,
        subtotal_cents, discount_cents, shipping_cents, total_cents, coupon_id, payment_method, status, payment_status)
      VALUES (v_number, p_customer_id, app.sha256_hex(v_token), p_idempotency_key, v_name, v_phone, nullif(v_email, ''), v_addr, v_city, v_district, v_note,
        (q ->> 'subtotalCents')::bigint, (q ->> 'discountCents')::bigint, (q ->> 'shippingCents')::bigint, (q ->> 'totalCents')::bigint,
        (q #>> '{coupon,id}')::uuid, v_pay, v_status, v_pay_status)
      ON CONFLICT (order_number) DO NOTHING RETURNING id INTO v_order;
    EXIT WHEN v_order IS NOT NULL;
  END LOOP;
  IF v_order IS NULL THEN RAISE EXCEPTION 'could not allocate an order number'; END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(q -> 'lines') LOOP
    INSERT INTO app.order_items (order_id, product_id, variant_id, shop_id, sku, product_slug, product_name, variant_label, origin_code, unit_price_cents, quantity, line_total_cents)
    VALUES (v_order, (v_line ->> 'productId')::uuid, (v_line ->> 'variantId')::uuid, (v_line ->> 'shopId')::uuid, v_line ->> 'sku', v_line ->> 'id', v_line ->> 'name',
            CASE WHEN v_line ->> 'size' <> '' THEN 'Size ' || (v_line ->> 'size') ELSE '' END, v_line ->> 'origin', (v_line ->> 'unitCents')::bigint, (v_line ->> 'qty')::int, (v_line ->> 'lineCents')::bigint);
  END LOOP;
  SELECT jsonb_agg(jsonb_build_object('variantId', x ->> 'variantId', 'qty', (x ->> 'qty')::int)) INTO v_items FROM jsonb_array_elements(q -> 'lines') x;
  IF v_pay = 'cod' THEN
    PERFORM app.take_stock(v_order, v_items);
    PERFORM app.mark_sold(v_order);
  ELSE
    SELECT CASE WHEN v_pay = 'payhere' THEN reservation_minutes ELSE bank_reservation_hours * 60 END INTO v_reserve_minutes FROM app.ops_settings WHERE id = 1;
    PERFORM app.reserve(v_order, v_items, v_reserve_minutes);
  END IF;
  INSERT INTO app.payments (order_id, provider, merchant_order_ref, expected_amount_cents, status)
  VALUES (v_order, v_pay, v_number, (q ->> 'totalCents')::bigint, CASE v_pay WHEN 'payhere' THEN 'initiated' WHEN 'bank_transfer' THEN 'awaiting_receipt' ELSE 'cod_pending' END);
  IF q -> 'coupon' <> 'null'::jsonb THEN INSERT INTO app.coupon_redemptions (coupon_id, order_id, customer_id) VALUES ((q #>> '{coupon,id}')::uuid, v_order, p_customer_id); END IF;
  PERFORM app.history(v_order, NULL, v_status, 'customer', 'order placed (' || v_pay || ')');
  PERFORM set_config('app.actor_label', CASE WHEN p_customer_id IS NULL THEN 'guest' ELSE 'customer' END, true);
  PERFORM set_config('app.request_id', coalesce(p_request_id, ''), true);
  INSERT INTO app.audit_logs (actor_type, actor_id, actor_label, action, entity_type, entity_id, after, request_id)
  VALUES (CASE WHEN p_customer_id IS NULL THEN 'system' ELSE 'customer' END, p_customer_id::text, CASE WHEN p_customer_id IS NULL THEN 'guest' ELSE 'customer' END,
          'order.create', 'order', v_order::text, jsonb_build_object('number', v_number, 'total', (q ->> 'totalCents')::bigint, 'payment', v_pay), p_request_id);
  -- confirmation email and stock snapshot refresh run on the VPS (never blocks checkout)
  IF v_email <> '' THEN PERFORM app.enqueue_job('email.order_placed', jsonb_build_object('order', v_number), 'email.order_placed:' || v_number); END IF;
  PERFORM app.enqueue_job('catalog.snapshot', '{}'::jsonb, 'catalog.snapshot:' || to_char(now(), 'YYYYMMDDHH24MI'));

  RETURN jsonb_build_object('orderNumber', v_number, 'trackingToken', v_token, 'status', v_status, 'paymentStatus', v_pay_status,
    'total', app.rs((q ->> 'totalCents')::bigint), 'totalCents', (q ->> 'totalCents')::bigint, 'amount', app.format_amount((q ->> 'totalCents')::bigint),
    'bankInstructions', CASE WHEN v_pay = 'bank_transfer' THEN v_pay_row.instructions END,
    'customer', jsonb_build_object('name', v_name, 'phone', v_phone, 'email', v_email, 'address', v_addr, 'city', v_city));
END $$;

-- ===========================================================================
-- PayHere notification — called ONLY by the `payhere-notify` Edge Function (service role),
-- which checks md5sig (constant time) and merchant_id with the server-held secret first.
-- Then here: order exists, currency, EXACT amount, de-duplication, valid state transition — in one transaction.
-- ===========================================================================
CREATE FUNCTION public.apply_payhere_notification(p_fields jsonb, p_signature_valid boolean, p_merchant_ok boolean, p_request_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  v_code int; v_payload jsonb; v_dedupe text; ord record; v_amt bigint; v_stock boolean; v_review text := ''; v_new text; v_ps text;
BEGIN
  -- a missing answer is treated as "not valid" (NULL must never pass a security check)
  p_signature_valid := coalesce(p_signature_valid, false);
  p_merchant_ok := coalesce(p_merchant_ok, false);
  BEGIN v_code := (f ->> 'status_code')::int; EXCEPTION WHEN others THEN v_code := NULL; END;
  -- sanitised copy (no secrets; card number only as PayHere masks it)
  SELECT coalesce(jsonb_object_agg(key, left(value, 200)), '{}'::jsonb) INTO v_payload FROM jsonb_each_text(f)
   WHERE key IN ('merchant_id', 'order_id', 'payment_id', 'payhere_amount', 'payhere_currency', 'status_code', 'status_message', 'method', 'card_holder_name', 'card_no', 'recurring', 'custom_1', 'custom_2');
  IF v_payload ? 'card_no' AND (v_payload ->> 'card_no') !~ '^\*+[0-9]{0,4}$' THEN v_payload := jsonb_set(v_payload, '{card_no}', '"****"'); END IF;
  v_dedupe := app.sha256_hex(concat_ws('|', 'payhere', coalesce(f ->> 'payment_id', ''), coalesce(f ->> 'order_id', ''), coalesce(f ->> 'status_code', ''), upper(coalesce(f ->> 'md5sig', ''))));

  -- reject before touching any order (each rejected event gets its own key so it never blocks a later genuine one)
  IF NOT p_signature_valid OR NOT p_merchant_ok OR v_code IS NULL OR v_code NOT IN (2, 0, -1, -2, -3) THEN
    INSERT INTO app.payment_events (provider, dedupe_key, merchant_order_ref, provider_payment_id, status_code, signature_valid, amount_text, currency, payload, result)
    VALUES ('payhere', app.sha256_hex(v_dedupe || '|rejected|' || coalesce(p_request_id, app.random_token(8))), left(f ->> 'order_id', 60), left(f ->> 'payment_id', 60), v_code, p_signature_valid,
            left(f ->> 'payhere_amount', 30), left(f ->> 'payhere_currency', 5), v_payload,
            'rejected:' || CASE WHEN NOT p_signature_valid THEN 'bad_signature' WHEN NOT p_merchant_ok THEN 'wrong_merchant' ELSE 'unknown_status' END);
    INSERT INTO app.audit_logs (actor_type, actor_label, action, entity_type, entity_id, after, request_id)
    VALUES ('payhere', 'payhere notify', 'payment.notify_rejected', 'order', left(f ->> 'order_id', 60),
            jsonb_build_object('reason', CASE WHEN NOT p_signature_valid THEN 'bad_signature' WHEN NOT p_merchant_ok THEN 'wrong_merchant' ELSE 'unknown_status' END), p_request_id);
    RETURN jsonb_build_object('http', 400, 'result', 'rejected:' || CASE WHEN NOT p_signature_valid THEN 'bad_signature' WHEN NOT p_merchant_ok THEN 'wrong_merchant' ELSE 'unknown_status' END);
  END IF;

  SELECT o.id, o.status, o.payment_status, o.total_cents, o.currency, p.id AS payment_id, p.provider_payment_id
    INTO ord FROM app.orders o JOIN app.payments p ON p.order_id = o.id AND p.provider = 'payhere'
   WHERE o.order_number = f ->> 'order_id' FOR UPDATE OF o, p;
  IF NOT FOUND THEN
    INSERT INTO app.payment_events (provider, dedupe_key, merchant_order_ref, provider_payment_id, status_code, signature_valid, amount_text, currency, payload, result)
    VALUES ('payhere', v_dedupe, left(f ->> 'order_id', 60), left(f ->> 'payment_id', 60), v_code, true, left(f ->> 'payhere_amount', 30), left(f ->> 'payhere_currency', 5), v_payload, 'rejected:unknown_order')
    ON CONFLICT (dedupe_key) DO NOTHING;
    RETURN jsonb_build_object('http', 400, 'result', 'rejected:unknown_order');
  END IF;
  -- the order row is locked: two copies of the same notification are handled one after the other
  IF EXISTS (SELECT 1 FROM app.payment_events WHERE dedupe_key = v_dedupe) THEN RETURN jsonb_build_object('http', 200, 'result', 'duplicate'); END IF;
  IF f ->> 'payhere_currency' IS DISTINCT FROM ord.currency::text THEN
    INSERT INTO app.payment_events (payment_id, provider, dedupe_key, merchant_order_ref, provider_payment_id, status_code, signature_valid, amount_text, currency, payload, result)
    VALUES (ord.payment_id, 'payhere', v_dedupe, f ->> 'order_id', left(f ->> 'payment_id', 60), v_code, true, left(f ->> 'payhere_amount', 30), left(f ->> 'payhere_currency', 5), v_payload, 'rejected:wrong_currency');
    RETURN jsonb_build_object('http', 400, 'result', 'rejected:wrong_currency');
  END IF;
  v_amt := app.parse_amount(f ->> 'payhere_amount');
  IF v_amt IS NULL OR v_amt <> ord.total_cents THEN
    INSERT INTO app.payment_events (payment_id, provider, dedupe_key, merchant_order_ref, provider_payment_id, status_code, signature_valid, amount_text, currency, payload, result)
    VALUES (ord.payment_id, 'payhere', v_dedupe, f ->> 'order_id', left(f ->> 'payment_id', 60), v_code, true, left(f ->> 'payhere_amount', 30), left(f ->> 'payhere_currency', 5), v_payload, 'rejected:wrong_amount');
    RETURN jsonb_build_object('http', 400, 'result', 'rejected:wrong_amount');
  END IF;

  -- a second, different successful payment for an order that is already paid
  IF ord.provider_payment_id IS NOT NULL AND f ->> 'payment_id' IS NOT NULL AND ord.provider_payment_id <> f ->> 'payment_id' AND v_code = 2 AND ord.payment_status = 'paid' THEN
    UPDATE app.orders SET needs_review = true, review_reason = 'second successful PayHere payment ' || (f ->> 'payment_id') WHERE id = ord.id;
    v_new := 'review:second_payment';
  ELSIF v_code = 2 THEN
    IF ord.payment_status = 'paid' THEN v_new := 'ignored:already_paid';
    ELSE
      v_stock := app.consume_reservations(ord.id);
      IF NOT v_stock THEN v_stock := app.retake_stock(ord.id);
        IF NOT v_stock THEN v_review := 'paid after reservation expired and stock is no longer available — refund or restock needed'; END IF;
      END IF;
      UPDATE app.payments SET status = 'paid', provider_payment_id = coalesce(f ->> 'payment_id', provider_payment_id), method = v_payload ->> 'method', card_mask = v_payload ->> 'card_no', paid_at = now() WHERE id = ord.payment_id;
      UPDATE app.orders SET payment_status = 'paid', paid_at = now(), status = CASE WHEN v_stock THEN 'confirmed' ELSE status END,
             needs_review = needs_review OR v_review <> '', review_reason = CASE WHEN v_review <> '' THEN v_review ELSE review_reason END WHERE id = ord.id;
      IF v_stock THEN PERFORM app.mark_sold(ord.id); END IF;
      IF v_stock AND ord.status <> 'confirmed' THEN PERFORM app.history(ord.id, ord.status, 'confirmed', 'payhere', 'payment confirmed by PayHere ' || coalesce(f ->> 'payment_id', '')); END IF;
      PERFORM app.enqueue_job('email.payment_received', jsonb_build_object('order', f ->> 'order_id'), 'email.payment_received:' || (f ->> 'order_id'));
      v_new := CASE WHEN v_review <> '' THEN 'applied:paid_needs_review' ELSE 'applied:paid' END;
    END IF;
  ELSIF v_code = 0 THEN
    IF ord.payment_status <> 'pending' THEN v_new := 'ignored:not_pending';
    ELSE UPDATE app.payments SET status = 'pending', provider_payment_id = coalesce(f ->> 'payment_id', provider_payment_id) WHERE id = ord.payment_id; v_new := 'applied:pending'; END IF;
  ELSIF v_code IN (-1, -2) THEN
    -- a late "cancelled/failed" never undoes a confirmed payment
    IF ord.payment_status IN ('paid', 'chargeback', 'refunded') THEN v_new := 'ignored:already_final';
    ELSE
      v_ps := CASE WHEN v_code = -2 THEN 'failed' ELSE 'cancelled' END;
      PERFORM app.release_reservations(ord.id);
      UPDATE app.payments SET status = v_ps, provider_payment_id = coalesce(f ->> 'payment_id', provider_payment_id) WHERE id = ord.payment_id;
      UPDATE app.orders SET payment_status = v_ps, status = 'cancelled', cancelled_at = now() WHERE id = ord.id;
      IF ord.status <> 'cancelled' THEN PERFORM app.history(ord.id, ord.status, 'cancelled', 'payhere', 'payment ' || v_ps); END IF;
      v_new := 'applied:' || v_ps;
    END IF;
  ELSE
    -- chargeback: no automatic restock (goods may be delivered); finance reviews
    UPDATE app.payments SET status = 'chargeback' WHERE id = ord.payment_id;
    UPDATE app.orders SET payment_status = 'chargeback', needs_review = true, review_reason = 'chargeback received from PayHere' WHERE id = ord.id;
    v_new := 'applied:chargeback';
  END IF;
  INSERT INTO app.payment_events (payment_id, provider, dedupe_key, merchant_order_ref, provider_payment_id, status_code, signature_valid, amount_text, currency, payload, result)
  VALUES (ord.payment_id, 'payhere', v_dedupe, f ->> 'order_id', left(f ->> 'payment_id', 60), v_code, true, left(f ->> 'payhere_amount', 30), left(f ->> 'payhere_currency', 5), v_payload, v_new);
  INSERT INTO app.audit_logs (actor_type, actor_label, action, entity_type, entity_id, after, request_id)
  VALUES ('payhere', 'payhere notify', 'payment.' || split_part(v_new, ':', 2), 'order', ord.id::text, jsonb_build_object('payment_id', f ->> 'payment_id', 'result', v_new), p_request_id);
  RETURN jsonb_build_object('http', 200, 'result', v_new);
END $$;

-- ===========================================================================
-- Order tracking — ONLY through the `track-order` Edge Function (rate limited).
-- Private token = full details; order number + matching phone = status only (no address).
-- ===========================================================================
CREATE FUNCTION public.track_order(p_number text, p_token text DEFAULT NULL, p_phone text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE o record; v_num text := upper(btrim(coalesce(p_number, '')));
  digits text;
BEGIN
  IF v_num !~ '^SC-[0-9]{6}-[A-Z0-9]{6}$' THEN RETURN NULL; END IF;
  SELECT id, tracking_token_hash, ship_phone INTO o FROM app.orders WHERE order_number = v_num;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_token IS NOT NULL AND length(p_token) BETWEEN 10 AND 100 AND app.sha256_hex(p_token) = o.tracking_token_hash THEN RETURN app.order_view(o.id, true); END IF;
  digits := regexp_replace(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '^94', '0');
  IF length(digits) >= 9 AND digits = regexp_replace(regexp_replace(o.ship_phone, '\D', '', 'g'), '^94', '0') THEN RETURN app.order_view(o.id, false); END IF;
  RETURN NULL;
END $$;

-- signed-in customers: their own orders only
CREATE FUNCTION public.my_orders() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(app.order_view(o.id, true) ORDER BY o.placed_at DESC), '[]'::jsonb)
    FROM (SELECT id, placed_at FROM app.orders WHERE customer_id = auth.uid() AND auth.uid() IS NOT NULL ORDER BY placed_at DESC LIMIT 50) o
$$;
CREATE FUNCTION public.my_order(p_number text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.order_view(o.id, true) FROM app.orders o WHERE o.order_number = upper(btrim(p_number)) AND o.customer_id = auth.uid() AND auth.uid() IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.place_order(jsonb, uuid, text, text), public.apply_payhere_notification(jsonb, boolean, boolean, text), public.track_order(text, text, text),
  public.my_orders(), public.my_order(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_order(jsonb, uuid, text, text), public.apply_payhere_notification(jsonb, boolean, boolean, text), public.track_order(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.my_orders(), public.my_order(text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.hit_rate_limit(text, int, int) TO service_role;
GRANT USAGE ON SCHEMA app TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.has_perm(text), app.current_aal(), app.must_change_password() TO authenticated;
