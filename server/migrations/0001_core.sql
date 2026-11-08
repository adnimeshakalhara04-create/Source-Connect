-- 0001_core.sql — Source Connect Global core schema
-- Forward-only. Never edit after it has run anywhere; add a new migration instead.
-- Money is stored as bigint minor units (cents of LKR). No floating point totals.

CREATE EXTENSION IF NOT EXISTS citext;

-- updated_at helper ---------------------------------------------------------
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- append-only helper (audit trails must not be edited) -----------------------
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege'; END $$;

-- ===========================================================================
-- Reference data
-- ===========================================================================
CREATE TABLE districts (
  code        text PRIMARY KEY,                 -- e.g. 'colombo'
  name        text NOT NULL UNIQUE,             -- 'Colombo'
  province    text NOT NULL
);

CREATE TABLE import_countries (                 -- "origins" in the legacy UI
  code        text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9-]{1,30}$'),  -- 'china', 'local'
  name        text NOT NULL,
  iso2        char(2),
  label       text NOT NULL,                    -- 'China Direct'
  days        text NOT NULL DEFAULT '',         -- '10–14' as displayed
  enabled     boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  extra       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ===========================================================================
-- Internal departments ("shops") — organisational only, single merchant
-- ===========================================================================
CREATE TABLE shops (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden')),
  sort_order  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER shops_upd BEFORE UPDATE ON shops FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  shop_id     uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  parent_id   uuid REFERENCES categories(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  tagline     text NOT NULL DEFAULT '',
  shape       text NOT NULL DEFAULT 'tshirt',   -- illustration used until a photo exists
  icon_color  text NOT NULL DEFAULT '#0b2a6f' CHECK (icon_color ~* '^#[0-9a-f]{3,8}$'),
  image_url   text,
  sort_order  int  NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX categories_shop_idx ON categories(shop_id);
CREATE TRIGGER categories_upd BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===========================================================================
-- Staff, roles, permissions
-- ===========================================================================
CREATE TABLE staff_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username        citext NOT NULL UNIQUE CHECK (username ~ '^[A-Za-z0-9._-]{3,40}$'),
  email           citext UNIQUE,
  display_name    text NOT NULL,
  password_hash   text NOT NULL,                -- argon2id encoded string
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  must_change_password boolean NOT NULL DEFAULT false,
  failed_logins   int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER staff_users_upd BEFORE UPDATE ON staff_users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE permissions (
  code        text PRIMARY KEY,                 -- 'products.write'
  description text NOT NULL
);
CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,             -- 'owner', 'catalog_editor'
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  shop_scoped boolean NOT NULL DEFAULT false    -- true = only for the shops in staff_shop_access
);
CREATE TABLE role_permissions (
  role_id     uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission  text NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission)
);
CREATE TABLE staff_roles (
  staff_id    uuid NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  PRIMARY KEY (staff_id, role_id)
);
CREATE TABLE staff_shop_access (
  staff_id    uuid NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  shop_id     uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, shop_id)
);
CREATE TABLE staff_sessions (
  id_hash       text PRIMARY KEY,               -- sha256 of the opaque cookie value
  staff_id      uuid NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  csrf_hash     text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  ip            inet,
  user_agent    text
);
CREATE INDEX staff_sessions_staff_idx ON staff_sessions(staff_id);

-- ===========================================================================
-- Catalogue
-- ===========================================================================
CREATE TABLE products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),  -- public id used in #p/<slug>
  shop_id         uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  category_id     uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  brand           text NOT NULL DEFAULT '',
  description     text NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
  origin_code     text NOT NULL REFERENCES import_countries(code) ON DELETE RESTRICT,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived')),
  badge           text NOT NULL DEFAULT '' CHECK (length(badge) <= 30),
  featured        boolean NOT NULL DEFAULT false,
  flash           boolean NOT NULL DEFAULT false,
  price_cents     bigint NOT NULL CHECK (price_cents > 0 AND price_cents <= 1000000000),
  compare_price_cents bigint NOT NULL DEFAULT 0 CHECK (compare_price_cents >= 0),
  visual          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {shape, pattern, color, accent} for the SVG illustration
  rating          numeric(2,1) NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),  -- only from real reviews
  reviews_count   int NOT NULL DEFAULT 0 CHECK (reviews_count >= 0),
  sold_count      int NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  seo_title       text NOT NULL DEFAULT '',
  seo_description text NOT NULL DEFAULT '',
  search          tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(description,''))) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES staff_users(id) ON DELETE SET NULL
);
CREATE INDEX products_category_idx ON products(category_id) WHERE status = 'active';
CREATE INDEX products_shop_idx ON products(shop_id);
CREATE INDEX products_origin_idx ON products(origin_code);
CREATE INDEX products_created_idx ON products(created_at DESC, id);
CREATE INDEX products_search_idx ON products USING gin(search);
CREATE TRIGGER products_upd BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_variants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  sku         text NOT NULL UNIQUE CHECK (sku ~ '^[A-Z0-9][A-Z0-9-]{1,63}$'),
  size        text NOT NULL DEFAULT '',          -- '' = one size
  color       text NOT NULL DEFAULT '',
  option_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_cents bigint CHECK (price_cents IS NULL OR price_cents > 0),  -- NULL = product price
  active      boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, size, color)
);
CREATE INDEX product_variants_product_idx ON product_variants(product_id);
CREATE TRIGGER product_variants_upd BEFORE UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id  uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  object_key  text,                              -- key in the image bucket; NULL for external links
  url         text NOT NULL CHECK (url ~* '^(https?://|/)'),
  alt         text NOT NULL DEFAULT '',
  sort_order  int NOT NULL DEFAULT 0,
  content_type text,
  bytes       int,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_images_product_idx ON product_images(product_id, sort_order);
CREATE FUNCTION product_images_limit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM product_images WHERE product_id = NEW.product_id) >= 8 THEN
    RAISE EXCEPTION 'a product can have at most 8 images' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_images_max8 BEFORE INSERT ON product_images FOR EACH ROW EXECUTE FUNCTION product_images_limit();

CREATE TABLE inventory (
  variant_id    uuid PRIMARY KEY REFERENCES product_variants(id) ON DELETE RESTRICT,
  location      text NOT NULL DEFAULT 'main',
  on_hand       int NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved      int NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  reorder_level int NOT NULL DEFAULT 5 CHECK (reorder_level >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (reserved <= on_hand)
);
CREATE TRIGGER inventory_upd BEFORE UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE inventory_movements (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id    uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  delta_on_hand int NOT NULL DEFAULT 0,
  delta_reserved int NOT NULL DEFAULT 0,
  reason        text NOT NULL CHECK (reason IN ('seed','adjustment','order_reserved','reservation_released','order_consumed','order_cancelled','return','import')),
  order_id      uuid,
  staff_id      uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  note          text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_movements_variant_idx ON inventory_movements(variant_id, created_at DESC);
CREATE TRIGGER inventory_movements_ro BEFORE UPDATE OR DELETE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE collections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '',
  accent      text NOT NULL DEFAULT '#0b2a6f' CHECK (accent ~* '^#[0-9a-f]{3,8}$'),
  image_url   text,
  home_row    boolean NOT NULL DEFAULT false,
  manual_order boolean NOT NULL DEFAULT false,   -- true = collection_products.sort_order decides
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER collections_upd BEFORE UPDATE ON collections FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TABLE collection_products (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order    int NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, product_id)
);
CREATE INDEX collection_products_product_idx ON collection_products(product_id);

CREATE TABLE flash_sale_rules (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),   -- one active rule; history lives in audit_logs
  title       text NOT NULL DEFAULT 'Flash Sale',
  mode        text NOT NULL DEFAULT 'daily' CHECK (mode IN ('daily','until','off')),
  ends_at     timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (mode <> 'until' OR ends_at IS NOT NULL)
);

CREATE TABLE coupons (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        citext NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9_-]{3,30}$'),
  kind        text NOT NULL CHECK (kind IN ('percent','fixed')),
  value       bigint NOT NULL CHECK (value > 0),       -- percent (1-90) or cents
  min_subtotal_cents bigint NOT NULL DEFAULT 0 CHECK (min_subtotal_cents >= 0),
  starts_at   timestamptz,
  ends_at     timestamptz,
  max_redemptions int CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'percent' OR value BETWEEN 1 AND 90)
);

-- ===========================================================================
-- Website content
-- ===========================================================================
CREATE TABLE site_content (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z][a-zA-Z0-9_]{1,40}$'),
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES staff_users(id) ON DELETE SET NULL
);
CREATE TABLE banners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id   text NOT NULL UNIQUE,                    -- 'h1' etc. used by the visual editor
  sort_order  int NOT NULL DEFAULT 0,
  eyebrow     text NOT NULL DEFAULT '',
  title       text NOT NULL DEFAULT '',
  subtitle    text NOT NULL DEFAULT '',
  cta         text NOT NULL DEFAULT '',
  link        text NOT NULL DEFAULT '#' CHECK (link ~ '^(#|/|https://)'),
  color       text NOT NULL DEFAULT '#0b2a6f' CHECK (color ~* '^#[0-9a-f]{3,8}$'),
  shape       text NOT NULL DEFAULT 'tshirt',
  image_url   text,
  active      boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE globe_settings (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cities      text[] NOT NULL DEFAULT '{}',
  stats       jsonb NOT NULL DEFAULT '[]'::jsonb,
  steps       jsonb NOT NULL DEFAULT '[]'::jsonb,
  hero_title  text NOT NULL DEFAULT '',
  hero_subtitle text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shipping_rates (
  code        text PRIMARY KEY,                       -- 'standard'
  name        text NOT NULL,
  fee_cents   bigint NOT NULL CHECK (fee_cents >= 0),
  free_over_cents bigint CHECK (free_over_cents IS NULL OR free_over_cents >= 0),
  active      boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_settings (                       -- never holds secrets (those are server env vars)
  method      text PRIMARY KEY CHECK (method IN ('payhere','cod','bank_transfer')),
  enabled     boolean NOT NULL DEFAULT false,
  display_name text NOT NULL,
  instructions text NOT NULL DEFAULT '',              -- e.g. bank account details shown to customers
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ===========================================================================
-- Customers
-- ===========================================================================
CREATE TABLE customers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext UNIQUE,
  phone             text,
  name              text NOT NULL DEFAULT '',
  email_verified_at timestamptz,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER customers_upd BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX customers_phone_idx ON customers(phone);

CREATE TABLE customer_auth_identities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('password','google')),
  provider_subject text NOT NULL,                     -- email for 'password', Google sub for 'google'
  password_hash   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject),
  CHECK (provider <> 'password' OR password_hash IS NOT NULL)
);
CREATE TABLE customer_tokens (
  token_hash  text PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE customer_sessions (
  id_hash     text PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  csrf_hash   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE INDEX customer_sessions_customer_idx ON customer_sessions(customer_id);
CREATE TABLE customer_addresses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label       text NOT NULL DEFAULT 'Home',
  name        text NOT NULL,
  phone       text NOT NULL,
  line1       text NOT NULL,
  city        text NOT NULL,
  district_code text NOT NULL REFERENCES districts(code),
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customer_addresses_one_default ON customer_addresses(customer_id) WHERE is_default;

CREATE TABLE carts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '60 days'
);
CREATE TABLE cart_items (
  cart_id     uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id  uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity    int NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cart_id, variant_id)
);

-- ===========================================================================
-- Orders, payments, reservations, shipments
-- ===========================================================================
CREATE TABLE orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number      text NOT NULL UNIQUE CHECK (order_number ~ '^SC-[0-9]{6}-[A-Z0-9]{6}$'),
  customer_id       uuid REFERENCES customers(id) ON DELETE RESTRICT,
  tracking_token_hash text NOT NULL,                  -- sha256 of the secret given to the buyer
  idempotency_key   text UNIQUE,
  currency          char(3) NOT NULL DEFAULT 'LKR' CHECK (currency = 'LKR'),
  ship_name         text NOT NULL,
  ship_phone        text NOT NULL,
  ship_email        citext,
  ship_line1        text NOT NULL,
  ship_city         text NOT NULL,
  ship_district     text NOT NULL REFERENCES districts(code),
  note              text NOT NULL DEFAULT '',
  subtotal_cents    bigint NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents    bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  shipping_cents    bigint NOT NULL CHECK (shipping_cents >= 0),
  total_cents       bigint NOT NULL CHECK (total_cents > 0),
  coupon_id         uuid REFERENCES coupons(id) ON DELETE RESTRICT,
  payment_method    text NOT NULL CHECK (payment_method IN ('payhere','cod','bank_transfer')),
  status            text NOT NULL CHECK (status IN ('pending_payment','awaiting_bank_transfer','confirmed','processing','shipped','arrived_lk','delivered','cancelled','expired','refunded')),
  payment_status    text NOT NULL CHECK (payment_status IN ('unpaid','pending','paid','failed','cancelled','chargeback','refunded','partially_refunded','cod_pending','cod_collected')),
  needs_review      boolean NOT NULL DEFAULT false,      -- e.g. paid after the reservation expired, chargeback
  review_reason     text NOT NULL DEFAULT '',
  placed_at         timestamptz NOT NULL DEFAULT now(),
  paid_at           timestamptz,
  cancelled_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (total_cents = subtotal_cents - discount_cents + shipping_cents),
  CHECK (discount_cents <= subtotal_cents)
);
CREATE INDEX orders_customer_idx ON orders(customer_id, placed_at DESC);
CREATE INDEX orders_status_idx ON orders(status, placed_at DESC);
CREATE INDEX orders_payment_status_idx ON orders(payment_status);
CREATE INDEX orders_placed_idx ON orders(placed_at DESC, id);
CREATE INDEX orders_phone_idx ON orders(ship_phone);
CREATE TRIGGER orders_upd BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  product_id        uuid REFERENCES products(id) ON DELETE SET NULL,
  variant_id        uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  shop_id           uuid REFERENCES shops(id) ON DELETE SET NULL,
  sku               text NOT NULL,
  product_slug      text NOT NULL,
  product_name      text NOT NULL,                    -- snapshot at purchase time
  variant_label     text NOT NULL DEFAULT '',
  origin_code       text NOT NULL,
  unit_price_cents  bigint NOT NULL CHECK (unit_price_cents > 0),
  quantity          int NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  line_total_cents  bigint NOT NULL,
  CHECK (line_total_cents = unit_price_cents * quantity)
);
CREATE INDEX order_items_order_idx ON order_items(order_id);
CREATE INDEX order_items_product_idx ON order_items(product_id);
CREATE TRIGGER order_items_ro BEFORE UPDATE OR DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE order_status_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  from_status text,
  to_status   text NOT NULL,
  actor       text NOT NULL,                          -- 'customer', 'system', 'payhere', 'staff:<username>'
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_status_history_order_idx ON order_status_history(order_id, created_at);
CREATE TRIGGER order_status_history_ro BEFORE UPDATE OR DELETE ON order_status_history FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE stock_reservations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  variant_id  uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity    int NOT NULL CHECK (quantity > 0),
  state       text NOT NULL DEFAULT 'active' CHECK (state IN ('active','consumed','released')),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, variant_id)
);
CREATE INDEX stock_reservations_active_idx ON stock_reservations(expires_at) WHERE state = 'active';
CREATE TRIGGER stock_reservations_upd BEFORE UPDATE ON stock_reservations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  provider            text NOT NULL CHECK (provider IN ('payhere','cod','bank_transfer')),
  provider_payment_id text,                           -- PayHere payment_id
  merchant_order_ref  text NOT NULL,                  -- the order_id we sent to PayHere
  expected_amount_cents bigint NOT NULL CHECK (expected_amount_cents > 0),
  currency            char(3) NOT NULL DEFAULT 'LKR',
  status              text NOT NULL CHECK (status IN ('initiated','pending','paid','failed','cancelled','chargeback','refunded','awaiting_receipt','verified','rejected','cod_pending','cod_collected')),
  method              text,                           -- 'VISA', 'MASTER', ... (no card numbers)
  card_mask           text,                           -- PayHere masked card, e.g. ************1292
  reference           text,                           -- bank transfer reference given by customer
  verified_by         uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  verified_at         timestamptz,
  paid_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id)
);
CREATE UNIQUE INDEX payments_one_per_order_provider ON payments(order_id, provider);
CREATE TRIGGER payments_upd BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payment_events (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id          uuid REFERENCES payments(id) ON DELETE RESTRICT,
  provider            text NOT NULL,
  dedupe_key          text NOT NULL UNIQUE,           -- provider + payment_id + status_code + md5sig
  merchant_order_ref  text,
  provider_payment_id text,
  status_code         int,
  signature_valid     boolean NOT NULL,
  amount_text         text,
  currency            text,
  payload             jsonb NOT NULL,                 -- sanitised (no secrets, masked card only)
  result              text NOT NULL,                  -- 'applied', 'duplicate', 'rejected:<reason>', 'ignored:<reason>'
  received_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_events_ref_idx ON payment_events(merchant_order_ref);
CREATE TRIGGER payment_events_ro BEFORE UPDATE OR DELETE ON payment_events FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE refunds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  payment_id  uuid REFERENCES payments(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  reason      text NOT NULL,
  restock     boolean NOT NULL DEFAULT true,
  status      text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','completed')),
  staff_id    uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refunds_order_idx ON refunds(order_id);

CREATE TABLE coupon_redemptions (
  coupon_id   uuid NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  order_id    uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (coupon_id, order_id)
);

CREATE TABLE shipments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  carrier         text NOT NULL DEFAULT '',
  tracking_number text NOT NULL DEFAULT '',
  origin_code     text REFERENCES import_countries(code),
  status          text NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing','shipped_abroad','arrived_lk','out_for_delivery','delivered','returned')),
  shipped_at      timestamptz,
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shipments_order_idx ON shipments(order_id);
CREATE TRIGGER shipments_upd BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TABLE shipment_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE RESTRICT,
  status      text NOT NULL,
  location    text NOT NULL DEFAULT '',
  note        text NOT NULL DEFAULT '',
  staff_id    uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shipment_events_shipment_idx ON shipment_events(shipment_id, occurred_at);

-- ===========================================================================
-- Audit and operations
-- ===========================================================================
CREATE TABLE audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_type  text NOT NULL CHECK (actor_type IN ('staff','customer','system','payhere')),
  actor_id    text,
  actor_label text NOT NULL DEFAULT '',
  action      text NOT NULL,                          -- 'product.update', 'auth.login_failed', ...
  entity_type text,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  ip          inet,
  user_agent  text,
  request_id  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs(created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id);
CREATE TRIGGER audit_logs_ro BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE backup_job_status (                       -- written by infra/backup scripts; NO credentials here
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('full','diff','incr','check','wal_archive','restore_test','image_sync')),
  status      text NOT NULL CHECK (status IN ('ok','failed','running')),
  started_at  timestamptz NOT NULL,
  finished_at timestamptz,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX backup_job_status_kind_idx ON backup_job_status(kind, started_at DESC);
