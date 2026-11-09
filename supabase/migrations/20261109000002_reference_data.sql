-- Reference data: districts, permissions, built-in roles, defaults (same as server/migrations/0002_reference_data.sql)
SET search_path = app, extensions;

INSERT INTO districts (code, name, province) VALUES
 ('colombo','Colombo','Western'),('gampaha','Gampaha','Western'),('kalutara','Kalutara','Western'),
 ('kandy','Kandy','Central'),('matale','Matale','Central'),('nuwara-eliya','Nuwara Eliya','Central'),
 ('galle','Galle','Southern'),('matara','Matara','Southern'),('hambantota','Hambantota','Southern'),
 ('jaffna','Jaffna','Northern'),('kilinochchi','Kilinochchi','Northern'),('mannar','Mannar','Northern'),
 ('vavuniya','Vavuniya','Northern'),('mullaitivu','Mullaitivu','Northern'),
 ('batticaloa','Batticaloa','Eastern'),('ampara','Ampara','Eastern'),('trincomalee','Trincomalee','Eastern'),
 ('kurunegala','Kurunegala','North Western'),('puttalam','Puttalam','North Western'),
 ('anuradhapura','Anuradhapura','North Central'),('polonnaruwa','Polonnaruwa','North Central'),
 ('badulla','Badulla','Uva'),('moneragala','Moneragala','Uva'),
 ('ratnapura','Ratnapura','Sabaragamuwa'),('kegalle','Kegalle','Sabaragamuwa');

INSERT INTO permissions (code, description) VALUES
 ('dashboard.view',   'See dashboard numbers and alerts'),
 ('catalog.read',     'See products, categories and collections in the admin'),
 ('catalog.write',    'Create and edit products, variants, images, categories and collections'),
 ('inventory.adjust', 'Change stock levels (recorded in the inventory history)'),
 ('orders.read',      'See orders'),
 ('orders.update',    'Change order and shipment status'),
 ('payments.read',    'See payment details and PayHere events'),
 ('payments.verify',  'Confirm bank transfers and COD collection'),
 ('refunds.create',   'Record refunds and cancellations of paid orders'),
 ('customers.read',   'See customer names, phones, emails and addresses'),
 ('customers.write',  'Edit or disable customer accounts'),
 ('content.write',    'Edit banners, homepage, globe, header/footer, pages and flash sale'),
 ('settings.write',   'Edit shipping fees, payment options and import countries'),
 ('staff.manage',     'Create staff accounts and assign roles'),
 ('audit.read',       'Read the audit log'),
 ('backups.read',     'See backup health');

INSERT INTO roles (code, name, description, shop_scoped) VALUES
 ('owner',        'Owner / Super Admin',  'Everything, including staff and roles', false),
 ('ops_manager',  'Operations Manager',   'Runs the shop day to day; cannot manage staff', false),
 ('catalog_editor','Catalog Editor',      'Products, stock and website content', false),
 ('fulfillment',  'Fulfillment',          'Packs and ships orders', false),
 ('support',      'Customer Support',     'Looks up orders and customers', false),
 ('finance',      'Finance',              'Payments, bank transfers, refunds', false),
 ('shop_staff',   'Department Staff',     'Products and orders of assigned departments only', true);

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p WHERE r.code = 'owner';

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p FROM roles r, unnest(ARRAY[
  'dashboard.view','catalog.read','catalog.write','inventory.adjust','orders.read','orders.update',
  'payments.read','payments.verify','refunds.create','customers.read','customers.write','content.write',
  'settings.write','audit.read','backups.read']) p WHERE r.code = 'ops_manager';

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p FROM roles r, unnest(ARRAY['dashboard.view','catalog.read','catalog.write','inventory.adjust','content.write']) p
WHERE r.code = 'catalog_editor';

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p FROM roles r, unnest(ARRAY['dashboard.view','catalog.read','orders.read','orders.update','customers.read']) p
WHERE r.code = 'fulfillment';

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p FROM roles r, unnest(ARRAY['catalog.read','orders.read','customers.read']) p
WHERE r.code = 'support';

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p FROM roles r, unnest(ARRAY['dashboard.view','orders.read','payments.read','payments.verify','refunds.create','customers.read','audit.read']) p
WHERE r.code = 'finance';

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p FROM roles r, unnest(ARRAY['dashboard.view','catalog.read','catalog.write','inventory.adjust','orders.read']) p
WHERE r.code = 'shop_staff';

INSERT INTO import_countries (code, name, iso2, label, days, enabled, sort_order) VALUES
 ('local','Sri Lanka (Colombo stock)','LK','Ships from Colombo','2–4', true, 0);

INSERT INTO flash_sale_rules (id) VALUES (1);
INSERT INTO globe_settings (id) VALUES (1);
INSERT INTO payment_settings (method, enabled, display_name) VALUES
 ('cod', true, 'Cash on Delivery'),
 ('bank_transfer', true, 'Bank Transfer'),
 ('payhere', false, 'Card / Online payment (PayHere)');
INSERT INTO shipping_rates (code, name, fee_cents, free_over_cents) VALUES ('standard', 'Islandwide delivery', 35000, 1000000);
