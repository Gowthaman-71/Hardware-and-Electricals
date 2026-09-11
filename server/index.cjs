const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
for (const envFile of ['.env', '.env.example']) {
  const envPath = path.join(root, envFile);
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
  if (envFile === '.env') break;
}
const port = Number(process.env.PORT || 8787);
const jwtSecret = process.env.JWT_SECRET || 'development-only-change-me';
let databasePath = path.resolve(root, process.env.DATABASE_PATH || 'server/data/catalog.sqlite');
let uploadDirectory = path.resolve(root, process.env.UPLOAD_DIR || 'server/uploads');

// Handle permission issues on Render or other environments
try {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
} catch (err) {
  if (err.code === 'EACCES') {
    // Fallback to project directory if /var/data is not writable
    databasePath = path.resolve(root, '.data/catalog.sqlite');
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  } else {
    throw err;
  }
}

try {
  fs.mkdirSync(uploadDirectory, { recursive: true });
} catch (err) {
  if (err.code === 'EACCES') {
    // Fallback to project directory if /var/data is not writable
    uploadDirectory = path.resolve(root, '.data/uploads');
    fs.mkdirSync(uploadDirectory, { recursive: true });
  } else {
    throw err;
  }
}
const db = new DatabaseSync(databasePath);
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
if (!db.prepare("PRAGMA table_info(users)").all().some((column) => column.name === 'mobile_number')) {
  db.exec('ALTER TABLE users ADD COLUMN mobile_number TEXT');
}
if (db.prepare("PRAGMA table_info(addresses)").all().length && !db.prepare("PRAGMA table_info(addresses)").all().some((column) => column.name === 'gst_number')) {
  db.exec('ALTER TABLE addresses ADD COLUMN gst_number TEXT');
}
if (db.prepare("PRAGMA table_info(orders)").all().length) {
  const orderColumns = new Set(db.prepare('PRAGMA table_info(orders)').all().map((column) => column.name));
  if (!orderColumns.has('order_number')) db.exec('ALTER TABLE orders ADD COLUMN order_number TEXT');
  if (!orderColumns.has('customer_email')) db.exec('ALTER TABLE orders ADD COLUMN customer_email TEXT DEFAULT ""');
  if (!orderColumns.has('customer_phone')) db.exec('ALTER TABLE orders ADD COLUMN customer_phone TEXT DEFAULT ""');
  if (!orderColumns.has('gst_number')) db.exec('ALTER TABLE orders ADD COLUMN gst_number TEXT');
  if (!orderColumns.has('delivery_charge')) db.exec('ALTER TABLE orders ADD COLUMN delivery_charge REAL DEFAULT 0');
  if (!orderColumns.has('payment_method')) db.exec('ALTER TABLE orders ADD COLUMN payment_method TEXT DEFAULT "Cash on Delivery"');
  if (!orderColumns.has('idempotency_key')) db.exec('ALTER TABLE orders ADD COLUMN idempotency_key TEXT');
  if (!orderColumns.has('notification_status')) db.exec('ALTER TABLE orders ADD COLUMN notification_status TEXT DEFAULT "PENDING"');
  if (!orderColumns.has('notification_sent_at')) db.exec('ALTER TABLE orders ADD COLUMN notification_sent_at TEXT');
  if (!orderColumns.has('notification_message_id')) db.exec('ALTER TABLE orders ADD COLUMN notification_message_id TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_mobile_number ON users(mobile_number) WHERE mobile_number IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number) WHERE order_number IS NOT NULL');
const now = () => new Date().toISOString();
const normalizeMobile = (value) => String(value || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
const normalizeWhatsappNumber = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.startsWith('+')) return digits;
  return `+${digits}`;
};
const slugify = (value) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const safeJson = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
const normalizeOrderStatus = (value) => {
  const normalized = String(value || 'PENDING').trim().toUpperCase().replace(/\s+/g, '_');
  const allowed = new Set(['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']);
  return allowed.has(normalized) ? normalized : 'PENDING';
};
const formatOrderStatusLabel = (value) => {
  const labelMap = {
    PENDING: 'Pending',
    CONFIRMED: 'Confirmed',
    PROCESSING: 'Processing',
    SHIPPED: 'Shipped',
    OUT_FOR_DELIVERY: 'Out for Delivery',
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled',
  };
  return labelMap[normalizeOrderStatus(value)] || 'Pending';
};
const ownerWhatsappNumber = normalizeWhatsappNumber(process.env.OWNER_WHATSAPP_NUMBER || '+919361866771');
const msg91AuthKey = process.env.MSG91_AUTH_KEY || '';
const msg91SenderId = process.env.MSG91_SENDER_ID || 'MSGIND';
const msg91BaseUrl = process.env.MSG91_BASE_URL || 'https://api.msg91.com/api/v5/whatsapp/send';
const mapAddress = (row) => ({ id: row.id, customerId: row.customer_id, type: row.type, fullName: row.full_name, phone: row.phone, gstNumber: row.gst_number || null, addressLine1: row.address_line1, addressLine2: row.address_line2, area: row.area, city: row.city, state: row.state, pincode: row.pincode, isDefault: Boolean(row.is_default), createdAt: row.created_at, updatedAt: row.updated_at });
const mapOrder = (row) => {
  const items = safeJson(row.items_json, []);
  return {
    id: row.id,
    orderNumber: row.order_number || `MH-${String(Number(row.id) + 1000)}`,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email || '',
    customerPhone: row.customer_phone,
    gstNumber: row.gst_number || null,
    items,
    subtotal: Number(row.subtotal || 0),
    deliveryCharge: Number(row.delivery_charge || 0),
    total: Number(row.total || 0),
    status: normalizeOrderStatus(row.status),
    paymentMethod: row.payment_method || 'Cash on Delivery',
    paymentStatus: String(row.payment_status || 'PENDING'),
    deliveryAddress: safeJson(row.delivery_address_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    itemCount: Array.isArray(items) ? items.reduce((count, item) => count + Number(item.quantity || 0), 0) : 0,
  };
};
const mapCategory = (row) => ({ ...row, parentId: row.parent_id, image: row.image_url, active: row.status === 'ACTIVE', order: row.sort_order });
const mapBrand = (row) => ({ ...row, logoUrl: row.logo_url, active: row.status === 'ACTIVE' });
const mapProductType = (row) => ({ ...row, categoryId: row.category_id, active: row.status === 'ACTIVE' });
const mapAttribute = (row) => ({ ...row, categoryId: row.category_id, options: safeJson(row.options_json, []), required: Boolean(row.required), filterable: Boolean(row.filterable), searchable: Boolean(row.searchable), active: row.status === 'ACTIVE' });
const mapProduct = (row) => ({ ...row, categoryId: row.category_id, code: row.sku, category: row.category_name, brand: row.brand_name || '', image: row.image_url || '', attributes: safeJson(row.attributes_json, {}), status: row.status === 'ACTIVE' ? 'Active' : 'Inactive' });
const productSelect = `SELECT p.*, c.name category_name, b.name brand_name FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id`;
function seed() {
  const adminEmail = String(process.env.ADMIN_EMAIL || 'owner@murugesan.in').trim().toLowerCase();
  const adminMobile = normalizeMobile(process.env.ADMIN_MOBILE || '9361866771');
  const configuredPassword = process.env.ADMIN_PASSWORD || 'change-this-before-production';
  const hasAdminMobileConflict = !!db.prepare('SELECT id FROM users WHERE mobile_number = ? AND role = ? AND id IS NOT ?').get(adminMobile, 'ADMIN', null);
  let existingAdmin = db.prepare('SELECT id FROM users WHERE email = ? AND role = ?').get(adminEmail, 'ADMIN');
  if (!existingAdmin) {
    existingAdmin = db.prepare("SELECT id FROM users WHERE role = 'ADMIN' ORDER BY id LIMIT 1").get();
    if (existingAdmin) db.prepare("UPDATE users SET email = ?, updated_at = ? WHERE id = ? AND role = 'ADMIN'").run(adminEmail, now(), existingAdmin.id);
  }
  if (!existingAdmin) {
    const timestamp = now();
    db.prepare('INSERT INTO users (name,email,mobile_number,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('Store Owner', adminEmail, adminMobile && !hasAdminMobileConflict ? adminMobile : null, bcrypt.hashSync(configuredPassword, 12), 'ADMIN', 'ACTIVE', timestamp, timestamp);
  } else {
    const existingMobile = db.prepare('SELECT mobile_number FROM users WHERE id = ?').get(existingAdmin.id)?.mobile_number;
    const duplicateMobile = db.prepare('SELECT id FROM users WHERE mobile_number = ? AND id != ?').get(adminMobile, existingAdmin.id);
    const safeAdminMobile = adminMobile && !duplicateMobile ? adminMobile : existingMobile || null;
    db.prepare("UPDATE users SET email = ?, mobile_number = ?, status = 'ACTIVE', updated_at = ? WHERE id = ? AND role = 'ADMIN'").run(adminEmail, safeAdminMobile, now(), existingAdmin.id);
  }
  if (db.prepare('SELECT COUNT(*) count FROM categories').get().count > 0) return;
  const categoryNames = ['Electrical Switches', 'Sockets', 'Wires & Cables', 'Lighting', 'Fan Regulators', 'Electrical Accessories', 'Tools', 'Hardware', 'Plumbing Accessories', 'Other Products'];
  const categoryIds = new Map();
  const categoryInsert = db.prepare('INSERT INTO categories (name,slug,description,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)');
  const timestamp = now();
  for (const [index, name] of categoryNames.entries()) categoryIds.set(name, Number(categoryInsert.run(name, slugify(name), 'Reliable products for everyday work.', index + 1, timestamp, timestamp).lastInsertRowid));
  const brandInsert = db.prepare('INSERT INTO brands (name,slug,created_at,updated_at) VALUES (?,?,?,?)');
  const anchor = Number(brandInsert.run('Anchor', 'anchor', timestamp, timestamp).lastInsertRowid);
  const products = [
    ['1401', '10A Bell Push', 'Electrical Switches', anchor, 95, 120, 42, 'Compact bell push for residential and commercial use.', '10A / Modular / White finish'],
    ['1402', '10A 2 Way Switch', 'Electrical Switches', anchor, 120, 145, 50, 'Durable modular switch for everyday electrical work.', '10A / 2-way / Modular'],
    ['US-10', 'Universal Socket', 'Sockets', null, 250, 290, 24, 'Safe, compact universal socket with a clean finish.', '6A-16A / Universal / Modular'],
    ['FR-05', 'Fan Regulator', 'Fan Regulators', null, 320, 375, 8, 'Smooth speed control for ceiling and wall fans.', '5-step / Silent operation'],
    ['FL-03', 'LED Foot Light', 'Lighting', null, 180, 225, 0, 'Warm, efficient accent light for steps and passages.', '3W / Warm white / LED'],
    ['BH-650-ID', 'Impact Drill 650W', 'Tools', null, 3290, 3999, 6, 'Jobsite-ready impact drill with a 13mm chuck.', '650W / 13mm chuck'],
  ];
  const productInsert = db.prepare('INSERT INTO products (sku,name,slug,category_id,brand_id,description,details,price,mrp,stock,image_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const [sku, name, category, brandId, price, mrp, stock, description, details] of products) productInsert.run(sku, name, `${slugify(name)}-${sku.toLowerCase()}`, categoryIds.get(category), brandId, description, details, price, mrp, stock, null, timestamp, timestamp);
}
seed();
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(uploadDirectory));
const upload = multer({ dest: uploadDirectory, limits: { fileSize: 10 * 1024 * 1024 } });
const mobilePattern = /^[6-9]\d{9}$/;
const gstNumberPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z0-9]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$/;
const normalizeGstNumber = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
const isValidGstNumber = (value) => {
  const normalized = normalizeGstNumber(value);
  return !normalized || gstNumberPattern.test(normalized);
};
const auth = (req, res, next) => { const token = (req.headers.authorization || '').replace(/^Bearer /, ''); try { req.user = jwt.verify(token, jwtSecret); next(); } catch { res.status(401).json({ error: 'Authentication required' }); } };
const admin = (req, res, next) => req.user?.role === 'ADMIN' ? next() : res.status(403).json({ error: 'Admin permission required' });
app.get('/api/health', (_req, res) => res.json({ ok: true, database: 'sqlite' }));
app.post('/api/auth/login', (req, res) => { const mobile = normalizeMobile(req.body.mobile); const password = String(req.body.password || ''); if (!mobilePattern.test(mobile) || !password) return res.status(400).json({ error: 'Invalid mobile number or password.' }); const user = db.prepare("SELECT * FROM users WHERE mobile_number = ? AND status = 'ACTIVE'").get(mobile); if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid mobile number or password.' }); const token = jwt.sign({ id: user.id, role: user.role, email: user.email, mobile: user.mobile_number }, jwtSecret, { expiresIn: '8h' }); res.json({ token, user: { id: user.id, name: user.name, email: user.email, mobile: user.mobile_number, role: user.role } }); });
app.post('/api/auth/register', (req, res) => { const name = String(req.body.name || '').trim(); const mobile = normalizeMobile(req.body.mobile); const password = String(req.body.password || ''); if (!name || !mobilePattern.test(mobile) || password.length < 8) return res.status(400).json({ error: 'Name, valid mobile number and an 8-character password are required' }); try { const email = `${mobile}@mobile.local`; const timestamp = now(); const result = db.prepare('INSERT INTO users (name,email,mobile_number,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(name, email, mobile, bcrypt.hashSync(password, 12), 'CUSTOMER', 'ACTIVE', timestamp, timestamp); const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid); const token = jwt.sign({ id: user.id, role: user.role, email: user.email, mobile: user.mobile_number }, jwtSecret, { expiresIn: '8h' }); res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email, mobile: user.mobile_number, role: user.role } }); } catch (error) { res.status(error.message.includes('UNIQUE') ? 409 : 400).json({ error: error.message.includes('UNIQUE') ? 'That mobile number is already linked to an account' : 'Unable to create customer account' }); } });
app.get('/api/me', auth, (req, res) => { const user = db.prepare('SELECT id,name,email,mobile_number AS mobile FROM users WHERE id = ? AND role = ? AND status = ?').get(req.user.id, 'CUSTOMER', 'ACTIVE'); if (!user) return res.status(404).json({ error: 'Customer account not found' }); res.json({ id: user.id, name: user.name, email: user.email, mobile: user.mobile }); });
app.patch('/api/me', auth, (req, res) => { if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Customer access required' }); const name = String(req.body.name || '').trim(); if (!name) return res.status(400).json({ error: 'Full name is required' }); db.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ? AND role = ?').run(name, now(), req.user.id, 'CUSTOMER'); res.json(db.prepare('SELECT id,name,email,mobile_number AS mobile FROM users WHERE id = ?').get(req.user.id)); });
app.get('/api/me/addresses', auth, (req, res) => { if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Customer access required' }); res.json(db.prepare('SELECT * FROM addresses WHERE customer_id = ? ORDER BY is_default DESC, created_at DESC').all(req.user.id).map(mapAddress)); });
app.post('/api/me/addresses', auth, (req, res) => { if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Customer access required' }); const body = req.body || {}; const fullName = String(body.fullName ?? body.full_name ?? '').trim(); const phone = String(body.phone ?? '').trim(); const addressLine1 = String(body.addressLine1 ?? body.address_line1 ?? '').trim(); const city = String(body.city ?? '').trim(); const state = String(body.state ?? '').trim(); const pincode = String(body.pincode ?? '').trim(); const gstNumber = normalizeGstNumber(body.gstNumber ?? body.gst_number ?? ''); const required = [fullName, phone, addressLine1, city, state, pincode]; if (required.some((field) => !field) || !/^\d{10}$/.test(phone.replace(/\D/g, '')) || !/^\d{6}$/.test(pincode.trim())) return res.status(400).json({ error: 'Please provide valid required address details' }); if (gstNumber && !isValidGstNumber(gstNumber)) return res.status(400).json({ error: 'Please enter a valid GST number.' }); const timestamp = now(); const makeDefault = Boolean(body.isDefault ?? body.is_default) || !db.prepare('SELECT 1 FROM addresses WHERE customer_id = ? LIMIT 1').get(req.user.id); const insert = db.prepare('INSERT INTO addresses (customer_id,type,full_name,phone,gst_number,address_line1,address_line2,area,city,state,pincode,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'); db.exec('BEGIN'); try { if (makeDefault) db.prepare('UPDATE addresses SET is_default = 0 WHERE customer_id = ?').run(req.user.id); const result = insert.run(req.user.id, ['Home', 'Office', 'Other'].includes(body.type ?? body.address_type) ? (body.type ?? body.address_type) : 'Home', fullName, phone, gstNumber || null, addressLine1, String(body.addressLine2 ?? body.address_line2 ?? '').trim(), String(body.area ?? '').trim(), city, state, pincode, makeDefault ? 1 : 0, timestamp, timestamp); db.exec('COMMIT'); res.status(201).json(mapAddress(db.prepare('SELECT * FROM addresses WHERE id = ?').get(result.lastInsertRowid))); } catch (error) { db.exec('ROLLBACK'); res.status(400).json({ error: 'Unable to save address' }); } });
app.patch('/api/me/addresses/:id', auth, (req, res) => { if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Customer access required' }); const body = req.body || {}; const current = db.prepare('SELECT * FROM addresses WHERE id = ? AND customer_id = ?').get(Number(req.params.id), req.user.id); if (!current) return res.status(404).json({ error: 'Address not found' }); const fullName = String(body.fullName ?? body.full_name ?? current.full_name).trim(); const phone = String(body.phone ?? current.phone).trim(); const addressLine1 = String(body.addressLine1 ?? body.address_line1 ?? current.address_line1).trim(); const city = String(body.city ?? current.city).trim(); const state = String(body.state ?? current.state).trim(); const pincode = String(body.pincode ?? current.pincode).trim(); const gstNumber = normalizeGstNumber(body.gstNumber ?? body.gst_number ?? current.gst_number ?? ''); if (gstNumber && !isValidGstNumber(gstNumber)) return res.status(400).json({ error: 'Please enter a valid GST number.' }); const makeDefault = Boolean(body.isDefault ?? body.is_default); if (makeDefault) db.prepare('UPDATE addresses SET is_default = 0 WHERE customer_id = ?').run(req.user.id); db.prepare('UPDATE addresses SET type = ?, full_name = ?, phone = ?, gst_number = ?, address_line1 = ?, address_line2 = ?, area = ?, city = ?, state = ?, pincode = ?, is_default = ?, updated_at = ? WHERE id = ? AND customer_id = ?').run(body.type || current.type, fullName, phone, gstNumber || null, addressLine1, String(body.addressLine2 ?? body.address_line2 ?? current.address_line2).trim(), String(body.area ?? current.area).trim(), city, state, pincode, makeDefault ? 1 : current.is_default, now(), current.id, req.user.id); res.json(mapAddress(db.prepare('SELECT * FROM addresses WHERE id = ?').get(current.id))); });
app.delete('/api/me/addresses/:id', auth, (req, res) => { if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Customer access required' }); const result = db.prepare('DELETE FROM addresses WHERE id = ? AND customer_id = ?').run(Number(req.params.id), req.user.id); if (!result.changes) return res.status(404).json({ error: 'Address not found' }); const remaining = db.prepare('SELECT id FROM addresses WHERE customer_id = ? ORDER BY created_at LIMIT 1').get(req.user.id); if (remaining) db.prepare('UPDATE addresses SET is_default = 1 WHERE id = ? AND NOT EXISTS (SELECT 1 FROM addresses WHERE customer_id = ? AND is_default = 1)').run(remaining.id, req.user.id); res.status(204).end(); });
app.get('/api/me/orders', auth, (req, res) => { if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Customer access required' }); const rows = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC').all(req.user.id).map(mapOrder); res.json(rows); });
app.get('/api/orders/:id', auth, (req, res) => { const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id)); if (!order) return res.status(404).json({ error: 'Order not found' }); const mapped = mapOrder(order); if (req.user.role === 'ADMIN' || Number(req.user.id) === Number(order.customer_id)) return res.json(mapped); return res.status(403).json({ error: 'You do not have access to this order' }); });
app.get('/api/admin/orders', auth, admin, (_req, res) => { const rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all().map(mapOrder); res.json(rows); });
app.patch('/api/admin/orders/:id/status', auth, admin, (req, res) => { const status = normalizeOrderStatus(req.body?.status); const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id)); if (!order) return res.status(404).json({ error: 'Order not found' }); const result = db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), Number(req.params.id)); if (!result.changes) return res.status(400).json({ error: 'Unable to update order status' }); res.json(mapOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id)))); });
const sendOwnerWhatsAppNotification = async (order) => {
  const ownerNumber = ownerWhatsappNumber;
  if (!ownerNumber || !msg91AuthKey) {
    console.warn('WhatsApp notification skipped: OWNER_WHATSAPP_NUMBER and MSG91_AUTH_KEY must be configured.');
    return { ok: false, skipped: true, reason: 'missing configuration' };
  }
  const items = Array.isArray(order.items) ? order.items : [];
  const itemSummary = items.length
    ? items.map((item, index) => `${index + 1}. ${item.productName || item.name || 'Item'} × ${item.quantity} — ${money(item.unitPrice ?? item.price ?? 0)}`).join('\n')
    : 'No items available';
  const message = [
    '🛒 NEW ORDER RECEIVED',
    '',
    'Murugesan Electrical and Hardwares',
    `Order ID: ${order.orderNumber}`,
    `Customer: ${order.customerName || 'Customer'}`,
    `Mobile: ${order.customerPhone || 'Not available'}`,
    '',
    'Items:',
    itemSummary,
    '',
    `Total: ${money(order.total)}`,
    `Status: ${formatOrderStatusLabel(order.status || 'PENDING')}`,
    '',
    `Address: ${typeof order.deliveryAddress === 'object' && order.deliveryAddress ? [order.deliveryAddress.addressLine1, order.deliveryAddress.area, order.deliveryAddress.city, order.deliveryAddress.state, order.deliveryAddress.pincode].filter(Boolean).join(', ') : 'Delivery address unavailable'}`,
    '',
    'Please open the owner dashboard to manage this order.',
  ].join('\n');
  const payload = {
    authkey: msg91AuthKey,
    mobiles: ownerNumber.replace(/\D/g, ''),
    message,
    sender: msg91SenderId,
    route: '4',
    country: '91',
  };
  try {
    const response = await fetch(msg91BaseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let result = {};
    try { result = JSON.parse(text); } catch { result = { raw: text }; }
    if (!response.ok) {
      console.error('MSG91 WhatsApp notification failed', {
        orderId: order.id,
        status: response.status,
        response: result,
      });
      return { ok: false, skipped: false, reason: 'provider error', response: result };
    }
    console.log('MSG91 WhatsApp notification accepted', {
      orderId: order.id,
      status: response.status,
      response: result,
    });
    return {
      ok: true,
      skipped: false,
      messageId: result?.messageId || result?.message_id || result?.requestId || null,
      response: result,
    };
  } catch (error) {
    console.error('MSG91 WhatsApp notification raised an exception', {
      orderId: order.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, skipped: false, reason: 'network error' };
  }
};
app.post('/api/me/orders', auth, async (req, res) => { if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Customer access required' }); const body = req.body || {}; const address = db.prepare('SELECT * FROM addresses WHERE id = ? AND customer_id = ?').get(Number(body.addressId), req.user.id); const user = db.prepare('SELECT id,name,email,mobile_number FROM users WHERE id = ?').get(req.user.id); if (!address || !user || !Array.isArray(body.items) || !body.items.length) return res.status(400).json({ error: 'A delivery address and cart items are required' }); const gstNumber = normalizeGstNumber(body.gstNumber ?? body.gst_number ?? address.gst_number ?? ''); if (gstNumber && !isValidGstNumber(gstNumber)) return res.status(400).json({ error: 'Please enter a valid GST number.' }); const normalizedItems = body.items.map((item) => ({ productId: Number(item.productId), name: String(item.name || '').trim(), quantity: Number(item.quantity || 0), price: Number(item.price || 0) })).filter((item) => item.productId && item.name && item.quantity > 0 && Number.isFinite(item.price)); if (!normalizedItems.length) return res.status(400).json({ error: 'Order items are invalid' }); const productIds = normalizedItems.map((item) => item.productId);
  const placeholders = productIds.map(() => '?').join(',');
  const catalog = db.prepare(`SELECT * FROM products WHERE id IN (${placeholders})`).all(...productIds);
  const catalogMap = new Map(catalog.map((product) => [product.id, product]));
  const snapshotItems = normalizedItems.map((item) => {
    const product = catalogMap.get(item.productId);
    if (!product) throw new Error(`Product ${item.productId} is unavailable`);
    const quantity = Number(item.quantity || 0);
    if (quantity <= 0) throw new Error(`Invalid quantity for ${product.name}`);
    const finalPrice = Number(product.price || 0);
    return {
      productId: product.id,
      productName: product.name,
      productImage: product.image_url || '',
      quantity,
      unitPrice: finalPrice,
      totalPrice: finalPrice * quantity,
      name: product.name,
      price: finalPrice,
    };
  });
  const subtotal = snapshotItems.reduce((total, item) => total + item.totalPrice, 0);
  const deliveryCharge = 0;
  const total = subtotal + deliveryCharge;
  const timestamp = now();
  const snapshot = mapAddress(address);
  const orderNumber = `MH-${String(Date.now()).slice(-6)}`;
  const idempotencyKey = String(body.idempotencyKey || `${req.user.id}:${orderNumber}:${timestamp}`);
  const existing = db.prepare('SELECT * FROM orders WHERE idempotency_key = ?').get(idempotencyKey);
  if (existing) return res.status(200).json(mapOrder(existing));
  db.exec('BEGIN');
  try {
    const result = db.prepare('INSERT INTO orders (order_number,customer_id,customer_name,customer_email,customer_phone,gst_number,items_json,subtotal,delivery_charge,total,status,payment_method,payment_status,delivery_address_json,idempotency_key,notification_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(orderNumber, req.user.id, user.name, user.email || `${user.mobile_number}@mobile.local`, address.phone, gstNumber || null, JSON.stringify(snapshotItems), subtotal, deliveryCharge, total, 'PENDING', 'Cash on Delivery', 'PENDING', JSON.stringify(snapshot), idempotencyKey, 'PENDING', timestamp, timestamp);
    const orderId = Number(result.lastInsertRowid);
    const orderItemInsert = db.prepare('INSERT INTO order_items (order_id,product_id,product_name,product_image,quantity,unit_price,total_price,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const item of snapshotItems) {
      orderItemInsert.run(orderId, item.productId, item.productName, item.productImage, item.quantity, item.unitPrice, item.totalPrice, timestamp, timestamp);
    }
    db.exec('COMMIT');
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const mappedOrder = mapOrder(order);
    const notification = await sendOwnerWhatsAppNotification(mappedOrder);
    const notificationStatus = notification.ok ? 'SENT' : 'FAILED';
    const messageId = notification.messageId || null;
    const sentAt = notification.ok ? now() : null;
    db.prepare('UPDATE orders SET notification_status = ?, notification_sent_at = ?, notification_message_id = ?, updated_at = ? WHERE id = ?').run(notificationStatus, sentAt, messageId, now(), orderId);
    res.status(201).json(mapOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)));
  } catch (error) {
    db.exec('ROLLBACK');
    if (String(error.message).includes('UNIQUE')) {
      const existingDuplicate = db.prepare('SELECT * FROM orders WHERE idempotency_key = ?').get(idempotencyKey);
      if (existingDuplicate) return res.status(200).json(mapOrder(existingDuplicate));
    }
    res.status(400).json({ error: 'Unable to create order. Please try again.' });
  }
});
app.get('/api/catalog', (_req, res) => { const categories = db.prepare("SELECT * FROM categories WHERE status = 'ACTIVE' ORDER BY sort_order, name").all().map(mapCategory); const products = db.prepare(`${productSelect} WHERE p.status = 'ACTIVE' ORDER BY p.created_at DESC`).all().map(mapProduct); res.json({ categories, products }); });
app.get('/api/categories', (_req, res) => res.json(db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all().map(mapCategory)));
app.post('/api/categories', auth, admin, (req, res) => { const body = req.body || {}; const timestamp = now(); try { const result = db.prepare('INSERT INTO categories (name,slug,parent_id,image_url,description,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(String(body.name).trim(), slugify(body.slug || body.name), body.parentId || null, body.imageUrl || null, body.description || '', body.status || 'ACTIVE', Number(body.sortOrder || 0), timestamp, timestamp); res.status(201).json(mapCategory(db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid))); } catch (error) { res.status(400).json({ error: error.message.includes('UNIQUE') ? 'Category slug already exists' : 'Unable to create category' }); } });
app.patch('/api/categories/:id', auth, admin, (req, res) => { const body = req.body || {}; const timestamp = now(); try { const result = db.prepare('UPDATE categories SET name = COALESCE(?, name), slug = COALESCE(?, slug), parent_id = ?, image_url = ?, description = COALESCE(?, description), status = COALESCE(?, status), sort_order = COALESCE(?, sort_order), updated_at = ? WHERE id = ?').run(body.name == null ? null : String(body.name).trim(), body.slug == null ? null : slugify(body.slug || body.name), body.parentId ?? null, body.imageUrl ?? null, body.description == null ? null : String(body.description), body.status == null ? null : body.status, body.sortOrder == null ? null : Number(body.sortOrder), timestamp, Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Category not found' }); res.json(mapCategory(db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(req.params.id)))); } catch (error) { res.status(400).json({ error: error.message.includes('UNIQUE') ? 'Category slug already exists' : 'Unable to update category' }); } });
app.patch('/api/categories/:id/archive', auth, admin, (req, res) => { const id = Number(req.params.id); const productCount = db.prepare("SELECT COUNT(*) count FROM products WHERE category_id = ? AND status != 'ARCHIVED'").get(id).count; if (productCount > 0) { const result = db.prepare("UPDATE categories SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now(), id); if (!result.changes) return res.status(404).json({ error: 'Category not found' }); return res.json({ archived: true, productCount, message: 'Category archived and removed from the public catalog.' }); } const result = db.prepare('DELETE FROM categories WHERE id = ?').run(id); if (!result.changes) return res.status(404).json({ error: 'Category not found' }); res.json({ deleted: true, message: 'Category deleted because it has no remaining products.' }); });
app.patch('/api/categories/:id/restore', auth, admin, (req, res) => { const result = db.prepare("UPDATE categories SET status = 'ACTIVE', updated_at = ? WHERE id = ?").run(now(), Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Category not found' }); res.json({ restored: true }); });
app.get('/api/brands', (_req, res) => res.json(db.prepare('SELECT * FROM brands ORDER BY name').all().map(mapBrand)));
app.post('/api/brands', auth, admin, (req, res) => { const body = req.body || {}; const timestamp = now(); try { const result = db.prepare('INSERT INTO brands (name,slug,logo_url,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(String(body.name).trim(), slugify(body.slug || body.name), body.logoUrl || null, body.description || '', body.status || 'ACTIVE', timestamp, timestamp); res.status(201).json(mapBrand(db.prepare('SELECT * FROM brands WHERE id = ?').get(result.lastInsertRowid))); } catch (error) { res.status(400).json({ error: error.message.includes('UNIQUE') ? 'Brand slug already exists' : 'Unable to create brand' }); } });
app.patch('/api/brands/:id', auth, admin, (req, res) => { const body = req.body || {}; const timestamp = now(); try { const result = db.prepare('UPDATE brands SET name = COALESCE(?, name), logo_url = COALESCE(?, logo_url), description = COALESCE(?, description), status = COALESCE(?, status), updated_at = ? WHERE id = ?').run(body.name ?? null, body.logoUrl ?? null, body.description ?? null, body.status ?? null, timestamp, Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Brand not found' }); res.json(mapBrand(db.prepare('SELECT * FROM brands WHERE id = ?').get(Number(req.params.id)))); } catch { res.status(400).json({ error: 'Unable to update brand' }); } });
app.patch('/api/brands/:id/archive', auth, admin, (req, res) => { const id = Number(req.params.id); const productCount = db.prepare("SELECT COUNT(*) count FROM products WHERE brand_id = ? AND status != 'ARCHIVED'").get(id).count; if (productCount > 0) { const result = db.prepare("UPDATE brands SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now(), id); if (!result.changes) return res.status(404).json({ error: 'Brand not found' }); return res.json({ archived: true, productCount, message: 'Brand archived and removed from active catalog listings.' }); } const result = db.prepare('DELETE FROM brands WHERE id = ?').run(id); if (!result.changes) return res.status(404).json({ error: 'Brand not found' }); res.json({ deleted: true, message: 'Brand deleted because it has no remaining products.' }); });
app.patch('/api/brands/:id/restore', auth, admin, (req, res) => { const result = db.prepare("UPDATE brands SET status = 'ACTIVE', updated_at = ? WHERE id = ?").run(now(), Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Brand not found' }); res.json({ restored: true }); });
app.get('/api/product-types', (_req, res) => { const categoryId = Number(req.query.categoryId || 0); const query = categoryId ? 'SELECT * FROM product_types WHERE category_id = ? ORDER BY sort_order, name' : 'SELECT * FROM product_types ORDER BY category_id, sort_order, name'; const rows = categoryId ? db.prepare(query).all(categoryId) : db.prepare(query).all(); res.json(rows.map(mapProductType)); });
app.post('/api/product-types', auth, admin, (req, res) => { const body = req.body || {}; const timestamp = now(); try { const result = db.prepare('INSERT INTO product_types (category_id,name,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(Number(body.categoryId), String(body.name).trim(), body.status || 'ACTIVE', Number(body.sortOrder || 0), timestamp, timestamp); res.status(201).json(mapProductType(db.prepare('SELECT * FROM product_types WHERE id = ?').get(result.lastInsertRowid))); } catch (error) { res.status(400).json({ error: error.message.includes('UNIQUE') ? 'A product type with that name already exists in this category' : 'Unable to create product type' }); } });
app.patch('/api/product-types/:id/archive', auth, admin, (req, res) => { const id = Number(req.params.id); const productCount = db.prepare("SELECT COUNT(*) count FROM products WHERE product_type_id = ? AND status != 'ARCHIVED'").get(id).count; if (productCount > 0) { const result = db.prepare("UPDATE product_types SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now(), id); if (!result.changes) return res.status(404).json({ error: 'Product type not found' }); return res.json({ archived: true, productCount, message: 'Product type archived and removed from active category workflows.' }); } const result = db.prepare('DELETE FROM product_types WHERE id = ?').run(id); if (!result.changes) return res.status(404).json({ error: 'Product type not found' }); res.json({ deleted: true, message: 'Product type deleted because it has no remaining products.' }); });
app.patch('/api/product-types/:id/restore', auth, admin, (req, res) => { const result = db.prepare("UPDATE product_types SET status = 'ACTIVE', updated_at = ? WHERE id = ?").run(now(), Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Product type not found' }); res.json({ restored: true }); });
app.get('/api/attributes', (_req, res) => { const categoryId = Number(req.query.categoryId || 0); const query = categoryId ? 'SELECT * FROM attributes WHERE category_id = ? ORDER BY sort_order, name' : 'SELECT * FROM attributes ORDER BY category_id, sort_order, name'; const rows = categoryId ? db.prepare(query).all(categoryId) : db.prepare(query).all(); res.json(rows.map(mapAttribute)); });
app.post('/api/attributes', auth, admin, (req, res) => { const body = req.body || {}; const timestamp = now(); try { const result = db.prepare('INSERT INTO attributes (category_id,name,type,required,filterable,searchable,options_json,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(Number(body.categoryId), String(body.name).trim(), String(body.type || 'Text'), Number(Boolean(body.required)), Number(Boolean(body.filterable)), Number(Boolean(body.searchable)), JSON.stringify(Array.isArray(body.options) ? body.options : []), body.status || 'ACTIVE', Number(body.sortOrder || 0), timestamp, timestamp); res.status(201).json(mapAttribute(db.prepare('SELECT * FROM attributes WHERE id = ?').get(result.lastInsertRowid))); } catch (error) { res.status(400).json({ error: error.message.includes('UNIQUE') ? 'An attribute with that name already exists in this category' : 'Unable to create attribute' }); } });
app.patch('/api/attributes/:id/archive', auth, admin, (req, res) => { const id = Number(req.params.id); const productCount = db.prepare("SELECT COUNT(*) count FROM products WHERE attributes_json LIKE ? AND status != 'ARCHIVED'").get(`%"${id}"%`).count; if (productCount > 0) { const result = db.prepare("UPDATE attributes SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now(), id); if (!result.changes) return res.status(404).json({ error: 'Attribute not found' }); return res.json({ archived: true, productCount, message: 'Attribute archived and preserved on existing products.' }); } const result = db.prepare('DELETE FROM attributes WHERE id = ?').run(id); if (!result.changes) return res.status(404).json({ error: 'Attribute not found' }); res.json({ deleted: true, message: 'Attribute deleted because it is not used by any products.' }); });
app.patch('/api/attributes/:id/restore', auth, admin, (req, res) => { const result = db.prepare("UPDATE attributes SET status = 'ACTIVE', updated_at = ? WHERE id = ?").run(now(), Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Attribute not found' }); res.json({ restored: true }); });
app.post('/api/migration/legacy', auth, admin, (req, res) => { const categories = Array.isArray(req.body?.categories) ? req.body.categories : []; const products = Array.isArray(req.body?.products) ? req.body.products : []; const timestamp = now(); try { db.exec('BEGIN'); const categoryInsert = db.prepare('INSERT OR IGNORE INTO categories (name,slug,description,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)'); for (const [index, category] of categories.entries()) categoryInsert.run(String(category.name || '').trim(), slugify(category.slug || category.name || `legacy-${index}`), category.description || '', Number(category.order || index + 1), timestamp, timestamp); const categoryId = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE'); const brandInsert = db.prepare('INSERT OR IGNORE INTO brands (name,slug,created_at,updated_at) VALUES (?,?,?,?)'); const brandId = db.prepare('SELECT id FROM brands WHERE name = ? COLLATE NOCASE'); const productInsert = db.prepare('INSERT OR IGNORE INTO products (sku,name,slug,category_id,brand_id,description,details,price,mrp,stock,unit,image_url,attributes_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'); for (const product of products) { const categoryRow = categoryId.get(String(product.category || 'Other Products')); if (!categoryRow) continue; const brandName = String(product.brand || '').trim(); if (brandName) brandInsert.run(brandName, slugify(brandName), timestamp, timestamp); const brandRow = brandName ? brandId.get(brandName) : null; const sku = String(product.code || product.sku || '').trim(); if (!sku) continue; productInsert.run(sku, String(product.name || sku), slugify(`${product.name || sku}-${sku}`), categoryRow.id, brandRow?.id || null, product.description || '', product.details || '', Number(product.price || 0), Number(product.mrp || product.price || 0), Number(product.stock || 0), product.unit || 'Nos', product.image || null, JSON.stringify(product.attributes || {}), timestamp, timestamp); } db.exec('COMMIT'); res.json({ migrated: { categories: categories.length, products: products.length } }); } catch (error) { db.exec('ROLLBACK'); res.status(400).json({ error: 'Migration failed', detail: error.message }); } });
app.get('/api/products', (req, res) => { const page = Math.max(1, Number(req.query.page || 1)); const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50))); const search = String(req.query.search || '').trim(); const params = []; const filters = ["p.status = 'ACTIVE'"]; if (search) { filters.push('(p.name LIKE ? OR p.sku LIKE ? OR c.name LIKE ? OR b.name LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); } if (req.query.categoryId) { filters.push('p.category_id = ?'); params.push(Number(req.query.categoryId)); } const where = ` WHERE ${filters.join(' AND ')}`; const total = db.prepare(`SELECT COUNT(*) count FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id${where}`).get(...params).count; const rows = db.prepare(`${productSelect}${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit).map(mapProduct); res.json({ data: rows, page, limit, total, pages: Math.ceil(total / limit) }); });
app.post('/api/products', auth, admin, (req, res) => { const body = req.body || {}; const sku = String(body.sku || '').trim(); const name = String(body.name || '').trim(); const categoryId = Number(body.categoryId); const price = Number(body.price); const stock = Number(body.stock ?? 0); if (!sku || !name || !categoryId || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0) return res.status(400).json({ error: 'SKU, product name, category, valid price and stock are required' }); const timestamp = now(); try { const brandId = body.brandId || db.prepare('SELECT id FROM brands WHERE name = ? COLLATE NOCASE').get(String(body.brand || '').trim())?.id || null; const result = db.prepare('INSERT INTO products (sku,name,slug,category_id,brand_id,product_type_id,description,details,price,mrp,discount,stock,unit,image_url,image_urls_json,attributes_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(sku, name, slugify(`${name}-${sku}`), categoryId, brandId, body.productTypeId || null, body.description || '', body.details || '', price, Number(body.mrp || price), Number(body.discount || 0), stock, body.unit || 'Nos', body.imageUrl || null, JSON.stringify(body.imageUrls || []), JSON.stringify(body.attributes || {}), body.status || 'ACTIVE', timestamp, timestamp); res.status(201).json(mapProduct(db.prepare(`${productSelect} WHERE p.id = ?`).get(result.lastInsertRowid))); } catch (error) { res.status(error.message.includes('UNIQUE') ? 409 : 400).json({ error: error.message.includes('UNIQUE') ? 'SKU already exists' : 'Unable to create product' }); } });
app.patch('/api/products/:id', auth, admin, (req, res) => { const body = req.body || {}; const id = Number(req.params.id); const current = db.prepare('SELECT * FROM products WHERE id = ?').get(id); if (!current) return res.status(404).json({ error: 'Product not found' }); const values = { name: body.name == null ? current.name : String(body.name).trim(), categoryId: body.categoryId == null ? current.category_id : Number(body.categoryId), price: body.price == null ? current.price : Number(body.price), stock: body.stock == null ? current.stock : Number(body.stock) }; if (!values.name || !values.categoryId || !Number.isFinite(values.price) || values.price < 0 || !Number.isInteger(values.stock) || values.stock < 0) return res.status(400).json({ error: 'Invalid product data' }); const timestamp = now(); try { const brandId = body.brandId || db.prepare('SELECT id FROM brands WHERE name = ? COLLATE NOCASE').get(String(body.brand || '').trim())?.id || current.brand_id; db.prepare('UPDATE products SET name = ?, category_id = ?, brand_id = ?, product_type_id = ?, description = ?, details = ?, price = ?, mrp = ?, discount = ?, stock = ?, unit = ?, image_url = ?, image_urls_json = ?, attributes_json = ?, status = ?, updated_at = ? WHERE id = ?').run(values.name, values.categoryId, brandId, body.productTypeId ?? current.product_type_id, body.description ?? current.description, body.details ?? current.details, values.price, body.mrp ?? current.mrp, body.discount ?? current.discount, values.stock, body.unit ?? current.unit, body.imageUrl ?? current.image_url, JSON.stringify(body.imageUrls ?? safeJson(current.image_urls_json, [])), JSON.stringify(body.attributes ?? safeJson(current.attributes_json, {})), body.status ?? current.status, timestamp, id); res.json(mapProduct(db.prepare(`${productSelect} WHERE p.id = ?`).get(id))); } catch { res.status(400).json({ error: 'Unable to update product' }); } });
app.patch('/api/products/:id/archive', auth, admin, (req, res) => { const result = db.prepare("UPDATE products SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now(), Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Product not found' }); res.status(204).end(); });
app.post('/api/images', auth, admin, upload.single('image'), (req, res) => { if (!req.file) return res.status(400).json({ error: 'Image is required' }); const extension = path.extname(req.file.originalname).toLowerCase() || '.bin'; const target = `${req.file.path}${extension}`; fs.renameSync(req.file.path, target); res.status(201).json({ url: `/uploads/${path.basename(target)}` }); });
app.get('/api/admin/stats', auth, admin, (_req, res) => { const count = (sql) => db.prepare(sql).get().count; res.json({ products: count("SELECT COUNT(*) count FROM products WHERE status != 'ARCHIVED'"), categories: count("SELECT COUNT(*) count FROM categories WHERE status != 'ARCHIVED'"), brands: count("SELECT COUNT(*) count FROM brands WHERE status != 'ARCHIVED'"), customers: count("SELECT COUNT(*) count FROM users WHERE role = 'CUSTOMER'") }); });
app.use(express.static(path.join(root, 'dist')));
app.use((req, res, next) => { if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next(); res.sendFile(path.join(root, 'dist', 'index.html')); });
app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: 'Unexpected server error' }); });
app.listen(port, () => console.log(`Catalog API listening on http://localhost:${port}`));
