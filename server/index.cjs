const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createPgCompatDatabase } = require('./postgresCompat.cjs');

const root = path.resolve(__dirname, '..');
const runtimeEnvPath = path.join(root, '.env');
if (fs.existsSync(runtimeEnvPath)) {
  for (const line of fs.readFileSync(runtimeEnvPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
const port = Number(process.env.PORT || 8787);
const jwtSecret = process.env.JWT_SECRET || (!isProduction ? 'murugesan-local-dev-secret' : null);
if (!jwtSecret) {
  throw new Error('JWT_SECRET is required in production.');
}
const seedDemoDataEnabled = String(process.env.SEED_DEMO_DATA || '').trim().toLowerCase() === 'true';
const productionDatabaseUrl = process.env.DATABASE_URL || null;
const productionUploadDirectory = path.resolve(root, 'server/uploads');
const renderWritableUploadDirectory = '/tmp/uploads';

if (isProduction && !productionDatabaseUrl) {
  throw new Error('Production requires DATABASE_URL to be configured. SQLite is not allowed in production.');
}

let databasePath;
if (isProduction) {
  databasePath = 'postgresql://production-database';
} else {
  const rawDatabasePath = process.env.DATABASE_PATH || 'server/data/catalog.sqlite';
  databasePath = rawDatabasePath.startsWith('/') ? rawDatabasePath : path.resolve(root, rawDatabasePath);
}

let uploadDirectory;
if (isProduction) {
  const configuredUploadDir = process.env.UPLOAD_DIR && process.env.UPLOAD_DIR.trim();
  const isRenderRuntime = process.env.RENDER === 'true';
  const safeRenderUploadDir = configuredUploadDir && !configuredUploadDir.includes('/var/data') ? configuredUploadDir : renderWritableUploadDirectory;
  uploadDirectory = isRenderRuntime ? safeRenderUploadDir : (configuredUploadDir || productionUploadDirectory);
} else {
  const rawUploadDirectory = process.env.UPLOAD_DIR || 'server/uploads';
  uploadDirectory = rawUploadDirectory.startsWith('/') ? rawUploadDirectory : path.resolve(root, rawUploadDirectory);
}

const resolvedDatabasePath = isProduction ? null : path.resolve(databasePath);
const resolvedUploadDirectory = path.resolve(uploadDirectory);

if (!isProduction) {
  try {
    const databaseDir = path.dirname(resolvedDatabasePath);
    fs.mkdirSync(databaseDir, { recursive: true });
  } catch (err) {
    throw new Error(`Unable to create database directory: ${path.dirname(resolvedDatabasePath)} (${err.message})`);
  }
}

try {
  fs.mkdirSync(resolvedUploadDirectory, { recursive: true });
} catch (err) {
  throw new Error(`Unable to create upload directory: ${resolvedUploadDirectory} (${err.message})`);
}

if (isProduction) {
  console.log('[database] Production contract', {
    environment: process.env.NODE_ENV,
    configuredDatabaseUrl: process.env.DATABASE_URL ? '[set]' : '(unset)',
    databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
    uploadDirectory,
    resolvedUploadDirectory,
    contract: 'PASS',
  });
}

const db = isProduction
  ? createPgCompatDatabase({
      connectionString: productionDatabaseUrl,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    })
  : new DatabaseSync(resolvedDatabasePath);

const now = () => new Date().toISOString();
const runProductionSchemaSetup = () => {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      mobile_number TEXT UNIQUE,
      gst_number TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'CUSTOMER',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS addresses (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      type TEXT NOT NULL DEFAULT 'Home',
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      gst_number TEXT,
      address_line1 TEXT NOT NULL,
      address_line2 TEXT NOT NULL DEFAULT '',
      area TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      pincode TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      parent_id INTEGER REFERENCES categories(id),
      image_url TEXT,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS brands (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      logo_url TEXT,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS product_types (
      id SERIAL PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (category_id, name)
    )`,
    `CREATE TABLE IF NOT EXISTS attributes (
      id SERIAL PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      required BOOLEAN NOT NULL DEFAULT FALSE,
      filterable BOOLEAN NOT NULL DEFAULT FALSE,
      searchable BOOLEAN NOT NULL DEFAULT FALSE,
      options_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (category_id, name)
    )`,
    `CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      brand_id INTEGER REFERENCES brands(id),
      product_type_id INTEGER REFERENCES product_types(id),
      description TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '',
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      mrp NUMERIC(12,2) NOT NULL DEFAULT 0,
      discount NUMERIC(12,2) NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'Nos',
      image_url TEXT,
      image_urls_json TEXT NOT NULL DEFAULT '[]',
      attributes_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL DEFAULT '',
      customer_phone TEXT NOT NULL,
      gst_number TEXT,
      items_json TEXT NOT NULL DEFAULT '[]',
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      delivery_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING',
      payment_method TEXT NOT NULL DEFAULT 'Cash on Delivery',
      payment_status TEXT NOT NULL DEFAULT 'PENDING',
      delivery_address_json TEXT NOT NULL,
      notification_status TEXT NOT NULL DEFAULT 'PENDING',
      notification_sent_at TIMESTAMPTZ,
      notification_message_id TEXT,
      idempotency_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      product_image TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS order_status_history (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'PROCESSING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED')),
      changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      note TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS order_notifications (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      type TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel = 'WHATSAPP'),
      message TEXT NOT NULL,
      recipient TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING',
      provider_message_id TEXT,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `ALTER TABLE order_notifications ADD COLUMN IF NOT EXISTS recipient TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE order_notifications ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING'`,
    `ALTER TABLE order_notifications ADD COLUMN IF NOT EXISTS provider_message_id TEXT`,
    `ALTER TABLE order_notifications ADD COLUMN IF NOT EXISTS error_message TEXT`,
    `CREATE TABLE IF NOT EXISTS settings (
      id SERIAL PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS import_jobs (
      id SERIAL PRIMARY KEY,
      status TEXT NOT NULL,
      total_rows INTEGER NOT NULL DEFAULT 0,
      processed_rows INTEGER NOT NULL DEFAULT 0,
      valid_rows INTEGER NOT NULL DEFAULT 0,
      error_rows INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT NOT NULL DEFAULT '[]',
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_addresses_customer ON addresses(customer_id, is_default DESC, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id, product_id)`,
    `CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_order_notifications_order ON order_notifications(order_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_categories_status_order ON categories(status, sort_order)`,
    `CREATE INDEX IF NOT EXISTS idx_brands_status ON brands(status)`,
    `CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)`,
    `CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id)`,
    `CREATE INDEX IF NOT EXISTS idx_products_type ON products(product_type_id)`,
    `CREATE INDEX IF NOT EXISTS idx_products_status_created ON products(status, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_products_name ON products(name)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_mobile_number ON users(mobile_number) WHERE mobile_number IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number) WHERE order_number IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL`
  ];

  for (const statement of statements) {
    db.exec(statement);
  }
};
const syncPostgresSequences = () => {
  if (!isProduction) return;
  const tables = ['users', 'addresses', 'categories', 'brands', 'product_types', 'attributes', 'products', 'orders', 'order_items', 'order_status_history', 'order_notifications', 'settings', 'import_jobs'];
  for (const tableName of tables) {
    try {
      db.exec(`SELECT setval(pg_get_serial_sequence('${tableName}', 'id'), COALESCE((SELECT MAX(id) FROM ${tableName}) + 1, 1), false) WHERE EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = '${tableName}' AND column_name = 'id');`);
    } catch (error) {
      console.warn('[database] Failed to sync sequence for table', tableName, error && error.message ? error.message : error);
    }
  }
};
const normalizePhoneNumber = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length > 10) {
    const stripped = digits.startsWith('91') ? digits.slice(2) : digits;
    return stripped.replace(/^0+/, '').slice(-10);
  }
  return digits.replace(/^0+/, '').slice(-10);
};
const normalizeMobile = normalizePhoneNumber;
const ownerWhatsappNumberRaw = String(process.env.OWNER_WHATSAPP_NUMBER || process.env.WHATSAPP_OWNER_NUMBER || '919361866771').trim();
const normalizeWhatsAppNumber = (value) => {
  if (!value) return '';
  let digits = String(value).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length > 12) return digits.slice(-12);
  if (digits.length >= 10) return `91${digits.slice(-10)}`;
  return digits;
};
const isValidWhatsAppNumber = (value) => {
  const normalized = normalizeWhatsAppNumber(value);
  if (!normalized) return false;
  const digitsOnly = normalized.replace(/\D/g, '');
  if (digitsOnly.length < 12) return false;
  const localPart = digitsOnly.length === 12 ? digitsOnly.slice(2) : digitsOnly.slice(-10);
  return /^[6-9]/.test(localPart);
};
const buildWhatsAppUrl = (phoneNumber, message) => {
  const normalized = normalizeWhatsAppNumber(phoneNumber);
  if (!normalized || !message) return '';
  return `https://wa.me/${normalized}?text=${encodeURIComponent(String(message))}`;
};
const normalizeWhatsappNumber = normalizeWhatsAppNumber;
const slugify = (value) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const safeJson = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
const normalizeStockValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
};
const validOrderStatuses = new Set(['PENDING', 'CONFIRMED', 'REJECTED', 'PROCESSING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']);
const allowedOrderTransitions = {
  PENDING: new Set(['CONFIRMED', 'REJECTED', 'CANCELLED']),
  CONFIRMED: new Set(['PROCESSING', 'CANCELLED']),
  REJECTED: new Set(),
  PROCESSING: new Set(['OUT_FOR_DELIVERY', 'CANCELLED']),
  OUT_FOR_DELIVERY: new Set(['DELIVERED']),
  DELIVERED: new Set(),
  CANCELLED: new Set(),
};
const notificationTypeForStatus = {
  PENDING: 'NEW_ORDER_OWNER',
  CONFIRMED: 'ORDER_CONFIRMED_CUSTOMER',
  REJECTED: 'ORDER_REJECTED',
  PROCESSING: 'ORDER_PROCESSING',
  OUT_FOR_DELIVERY: 'ORDER_OUT_FOR_DELIVERY',
  DELIVERED: 'ORDER_DELIVERED',
  CANCELLED: 'ORDER_CANCELLED',
};
const normalizeOrderStatus = (value) => {
  const normalized = String(value || 'PENDING').trim().toUpperCase().replace(/\s+/g, '_');
  const allowed = new Set(['PENDING', 'CONFIRMED', 'REJECTED', 'PROCESSING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']);
  return allowed.has(normalized) ? normalized : null;
};
const formatOrderStatusLabel = (value) => {
  const labelMap = {
    PENDING: 'Pending',
    CONFIRMED: 'Confirmed',
    REJECTED: 'Rejected',
    PROCESSING: 'Processing',
    OUT_FOR_DELIVERY: 'Out for Delivery',
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled',
  };
  return labelMap[normalizeOrderStatus(value) || 'PENDING'] || 'Pending';
};
const ownerWhatsappNumber = normalizeWhatsAppNumber(ownerWhatsappNumberRaw);
const whatsappConfig = {
  ownerNumber: ownerWhatsappNumber,
};
const businessWhatsappNumber = ownerWhatsappNumber;
const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const formatOrderAddress = (value) => {
  const address = value && typeof value === 'object' ? value : {};
  const parts = [address.addressLine1, address.area, address.city, address.state]
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  const pincode = String(address.pincode || '').trim();
  return pincode ? `${parts.join(', ')}${parts.length ? ' - ' : ''}${pincode}` : parts.join(', ');
};
const buildCustomerOrderConfirmationMessage = (order) => {
  const name = String(order.customer_name || 'Customer').trim() || 'Customer';
  const orderNumber = String(order.order_number || '').trim();
  const total = formatCurrency(order.total);
  const items = safeJson(order.items_json, []);
  const itemsList = items.map((item) => {
    const productName = String(item.productName || item.name || 'Item').trim() || 'Item';
    const quantity = Number(item.quantity || 0);
    return `- ${productName} — Qty: ${quantity}`;
  }).join('\n');
  const address = formatOrderAddress(safeJson(order.delivery_address_json, {}));
  return [
    `Hello ${name},`,
    '',
    'Your order has been confirmed by Murugesan Electrical and Hardwares.',
    '',
    `Order ID: ${orderNumber}`,
    '',
    `Order Total: ${total}`,
    '',
    'Items:',
    itemsList || '- Items not available',
    '',
    'Delivery Address:',
    address || 'Address not provided',
    '',
    'Thank you for shopping with us.',
  ].join('\n');
};
const buildOrderNotificationMessage = (order, status) => {
  if (status === 'CONFIRMED') return buildCustomerOrderConfirmationMessage(order);
  const name = String(order.customer_name || 'Customer').trim() || 'Customer';
  const orderNumber = String(order.order_number || '').trim();
  const total = formatCurrency(order.total);
  const messages = {
    PROCESSING: `Hello ${name},\n\nYour order ${orderNumber} is now being processed.\n\nOrder Total: ${total}\n\nStatus: PROCESSING\n\nThank you for choosing Murugesan Electrical and Hardwares.`,
    OUT_FOR_DELIVERY: `Hello ${name},\n\nYour order ${orderNumber} is out for delivery.\n\nOrder Total: ${total}\n\nStatus: OUT_FOR_DELIVERY\n\nThank you for choosing Murugesan Electrical and Hardwares.`,
    DELIVERED: `Hello ${name},\n\nYour order ${orderNumber} has been delivered successfully.\n\nOrder Total: ${total}\n\nThank you for choosing Murugesan Electrical and Hardwares.`,
    REJECTED: `Hello ${name},\n\nYour order ${orderNumber} has been rejected.\n\nPlease contact Murugesan Electrical and Hardwares if you need assistance.`,
    CANCELLED: `Hello ${name},\n\nYour order ${orderNumber} has been cancelled.\n\nPlease contact Murugesan Electrical and Hardwares if you need assistance.`,
  };
  return messages[status] || '';
};
const buildOwnerOrderNotificationMessage = (order) => {
  const customer = String(order.customer_name || 'Customer').trim() || 'Customer';
  const rawMobile = String(order.customer_phone || '').trim();
  const mobile = normalizePhoneNumber(rawMobile) || rawMobile;
  const orderNumber = String(order.order_number || '').trim();
  const address = formatOrderAddress(safeJson(order.delivery_address_json, {}));
  const items = safeJson(order.items_json, []).map((item) => {
    const name = String(item.productName || item.name || 'Item').trim() || 'Item';
    const quantity = Number(item.quantity || 0);
    const price = formatCurrency(item.unitPrice ?? item.price ?? 0);
    return `- ${name}, Qty: ${quantity}, Price: ${price}`;
  }).join('\n');
  const gst = String(order.gst_number || '').trim();
  return [
    'Hello Murugesan Electrical and Hardwares, I have placed an order.',
    '',
    `Order: ${orderNumber}`,
    `Customer: ${customer}`,
    `Mobile: ${mobile}`,
    ...(gst ? [`GST: ${gst}`] : []),
    '',
    'Delivery address:',
    address || 'Address not provided',
    '',
    'Items:',
    items || '- No items',
    '',
    `Total: ${formatCurrency(order.total)}`,
    '',
    'Please confirm my order.',
  ].join('\n');
};
const whatsappRecipient = (value) => normalizeWhatsAppNumber(value);
async function createOrderNotification({ order, type, recipient, status }) {
  const destination = whatsappRecipient(recipient);
  const timestamp = now();
  const message = type === 'NEW_ORDER_OWNER'
    ? buildOwnerOrderNotificationMessage(order)
    : (buildOrderNotificationMessage(order, status) || `${type} ${order.order_number || ''}`.trim());
  const insert = db.prepare('INSERT INTO order_notifications (order_id,customer_id,type,channel,message,recipient,status,created_at) VALUES (?,?,?,?,?,?,?,?)');
  if (!destination) {
    const result = insert.run(order.id, order.customer_id, type, 'WHATSAPP', message, '', 'PENDING', timestamp);
    db.prepare('UPDATE order_notifications SET error_message = ? WHERE id = ?').run('WhatsApp recipient is missing', result.lastInsertRowid);
    return { notificationId: Number(result.lastInsertRowid), whatsappUrl: '', destination: '' };
  }
  const whatsappUrl = buildWhatsAppUrl(destination, message);
  const result = insert.run(order.id, order.customer_id, type, 'WHATSAPP', message, destination, 'PREPARED', timestamp);
  return { notificationId: Number(result.lastInsertRowid), whatsappUrl, destination };
}

const productSelect = `
  SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.status AS category_status,
    b.name AS brand_name, pt.name AS product_type_name,
    COALESCE(NULLIF(p.image_url, ''), NULL) AS image_url
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id
  LEFT JOIN product_types pt ON pt.id = p.product_type_id
`;

const mapCategory = (row, attributes = []) => row ? {
  id: Number(row.id),
  name: String(row.name || ''),
  slug: String(row.slug || ''),
  parentId: row.parent_id == null ? null : Number(row.parent_id),
  image: row.image_url || '',
  imageUrl: row.image_url || null,
  description: row.description || '',
  status: row.status || 'ACTIVE',
  sortOrder: Number(row.sort_order || 0),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  attributes: Array.isArray(attributes) ? attributes.map(mapAttribute) : [],
} : null;
const mapBrand = (row) => row ? {
  id: Number(row.id),
  name: String(row.name || ''),
  slug: String(row.slug || ''),
  logoUrl: row.logo_url || null,
  description: row.description || '',
  status: row.status || 'ACTIVE',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
} : null;
const mapProductType = (row) => row ? {
  id: Number(row.id),
  categoryId: row.category_id == null ? null : Number(row.category_id),
  name: String(row.name || ''),
  status: row.status || 'ACTIVE',
  sortOrder: Number(row.sort_order || 0),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
} : null;
const mapAttribute = (row) => row ? {
  id: Number(row.id),
  categoryId: row.category_id == null ? null : Number(row.category_id),
  name: String(row.name || ''),
  type: String(row.type || 'Text'),
  required: Boolean(row.required),
  filterable: Boolean(row.filterable),
  searchable: Boolean(row.searchable),
  options: safeJson(row.options_json, []),
  status: row.status || 'ACTIVE',
  sortOrder: Number(row.sort_order || 0),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
} : null;
const mapProduct = (row) => row ? {
  id: Number(row.id),
  sku: String(row.sku || ''),
  code: String(row.sku || ''),
  name: String(row.name || ''),
  category: String(row.category_name || row.category || ''),
  categoryId: row.category_id == null ? null : Number(row.category_id),
  brand: String(row.brand_name || row.brand || ''),
  brandId: row.brand_id == null ? null : Number(row.brand_id),
  productType: String(row.product_type_name || row.product_type || ''),
  productTypeId: row.product_type_id == null ? null : Number(row.product_type_id),
  price: Number(row.price || 0),
  mrp: Number(row.mrp || row.price || 0),
  discount: Number(row.discount || 0),
  stock: Number(row.stock || 0),
  unit: String(row.unit || 'Nos'),
  description: row.description || '',
  details: row.details || '',
  image: row.image_url || '',
  imageUrl: row.image_url || null,
  status: row.status || 'ACTIVE',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  attributes: safeJson(row.attributes_json, {}),
  imageUrls: safeJson(row.image_urls_json, []),
} : null;
const mapAddress = (row) => row ? {
  id: Number(row.id),
  customerId: Number(row.customer_id),
  type: row.type || 'Home',
  fullName: row.full_name || '',
  phone: row.phone || '',
  gstNumber: row.gst_number || null,
  addressLine1: row.address_line1 || '',
  addressLine2: row.address_line2 || '',
  area: row.area || '',
  city: row.city || '',
  state: row.state || '',
  pincode: row.pincode || '',
  isDefault: Boolean(row.is_default),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
} : null;
const mapOrder = (row) => row ? {
  id: Number(row.id),
  orderNumber: row.order_number || `MH-${String(row.id).padStart(6, '0')}`,
  customerId: Number(row.customer_id),
  customerName: row.customer_name || '',
  customerEmail: row.customer_email || '',
  customerPhone: row.customer_phone || '',
  gstNumber: row.gst_number || null,
  items: safeJson(row.items_json, []),
  subtotal: Number(row.subtotal || 0),
  deliveryCharge: Number(row.delivery_charge || 0),
  total: Number(row.total || 0),
  status: row.status || 'PENDING',
  paymentMethod: row.payment_method || 'Cash on Delivery',
  paymentStatus: row.payment_status || 'PENDING',
  deliveryAddress: safeJson(row.delivery_address_json, {}),
  idempotencyKey: row.idempotency_key || null,
  notificationStatus: row.notification_status || 'PENDING',
  statusHistory: db.prepare('SELECT id, status, changed_by AS changedBy, created_at AS createdAt, note FROM order_status_history WHERE order_id = ? ORDER BY created_at, id').all(row.id).map((history) => ({ ...history, status: normalizeOrderStatus(history.status) || 'PENDING' })),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
} : null;

function ensureColumn(tableName, columnName, definitionSql) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
}
function backupDatabaseIfNeeded() {
  if (process.env.BACKUP_DATABASE !== 'true' || !fs.existsSync(databasePath)) return;
  const backupDir = path.join(path.dirname(databasePath), '.backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFiles = fs.readdirSync(backupDir).filter((file) => file.startsWith('catalog-backup-') && file.endsWith('.sqlite')).sort();
  while (backupFiles.length > 4) {
    const stale = path.join(backupDir, backupFiles.shift());
    try { fs.unlinkSync(stale); } catch { /* ignore */ }
  }
  const backupPath = path.join(backupDir, `catalog-backup-${Date.now()}.sqlite`);
  fs.copyFileSync(databasePath, backupPath);
  console.log('[database] Backup created', { backupPath });
}
function applyDatabaseMigrations() {
  if (isProduction) {
    runProductionSchemaSetup();
    return;
  }

  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schemaSql);
  db.exec(`CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key ON settings(key)');
  ensureColumn('users', 'mobile_number', 'mobile_number TEXT');
  ensureColumn('users', 'last_login_at', 'last_login_at TEXT');
  ensureColumn('addresses', 'gst_number', 'gst_number TEXT');
  ensureColumn('order_notifications', 'recipient', 'recipient TEXT NOT NULL DEFAULT ""');
  ensureColumn('order_notifications', 'status', 'status TEXT NOT NULL DEFAULT "PENDING"');
  ensureColumn('order_notifications', 'provider_message_id', 'provider_message_id TEXT');
  ensureColumn('order_notifications', 'error_message', 'error_message TEXT');
  ensureColumn('product_types', 'created_at', 'created_at TEXT NOT NULL DEFAULT "1970-01-01T00:00:00.000Z"');
  ensureColumn('product_types', 'updated_at', 'updated_at TEXT NOT NULL DEFAULT "1970-01-01T00:00:00.000Z"');
  ensureColumn('attributes', 'created_at', 'created_at TEXT NOT NULL DEFAULT "1970-01-01T00:00:00.000Z"');
  ensureColumn('attributes', 'updated_at', 'updated_at TEXT NOT NULL DEFAULT "1970-01-01T00:00:00.000Z"');
  if (db.prepare("PRAGMA table_info(orders)").all().length) {
    ensureColumn('orders', 'order_number', 'order_number TEXT');
    ensureColumn('orders', 'customer_email', 'customer_email TEXT DEFAULT ""');
    ensureColumn('orders', 'customer_phone', 'customer_phone TEXT DEFAULT ""');
    ensureColumn('orders', 'gst_number', 'gst_number TEXT');
    ensureColumn('orders', 'delivery_charge', 'delivery_charge REAL DEFAULT 0');
    ensureColumn('orders', 'payment_method', 'payment_method TEXT DEFAULT "Cash on Delivery"');
    ensureColumn('orders', 'idempotency_key', 'idempotency_key TEXT');
    ensureColumn('orders', 'notification_status', 'notification_status TEXT DEFAULT "PENDING"');
    ensureColumn('orders', 'notification_sent_at', 'notification_sent_at TEXT');
    ensureColumn('orders', 'notification_message_id', 'notification_message_id TEXT');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_mobile_number ON users(mobile_number) WHERE mobile_number IS NOT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number) WHERE order_number IS NOT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL');
}
function migrateOrderStatusData() {
  db.prepare("UPDATE orders SET status = 'OUT_FOR_DELIVERY', updated_at = ? WHERE status = 'SHIPPED'").run(now());
  db.exec(`
    INSERT INTO order_status_history (order_id, status, changed_by, created_at, note)
    SELECT o.id, o.status, NULL, o.created_at, 'Initial order status'
    FROM orders o
    WHERE NOT EXISTS (
      SELECT 1 FROM order_status_history h WHERE h.order_id = o.id
    )
  `);
}
function ensureCoreAdminAccount() {
  const adminEmail = String(process.env.ADMIN_EMAIL || 'owner@murugesan.in').trim().toLowerCase();
  const adminMobile = normalizeMobile(process.env.ADMIN_MOBILE || '9361866771');
  const configuredPassword = process.env.ADMIN_PASSWORD || 'change-this-before-production';
  const existingByEmail = db.prepare("SELECT id, email, mobile_number, role, status FROM users WHERE LOWER(email) = LOWER(?) ORDER BY id LIMIT 1").get(adminEmail) || null;
  if (existingByEmail) return;

  const passwordHash = bcrypt.hashSync(configuredPassword, 12);
  try {
    db.prepare('INSERT INTO users (name,email,mobile_number,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('Store Owner', adminEmail, adminMobile, passwordHash, 'ADMIN', 'ACTIVE', now(), now());
  } catch (insertError) {
    const duplicateKeyMessage = String(insertError && insertError.message || '').toLowerCase();
    const isDuplicateEmail = insertError && insertError.code === '23505' && duplicateKeyMessage.includes('users_email_key');
    const isSqliteDuplicateEmail = duplicateKeyMessage.includes('unique constraint failed: users.email');
    if (!isDuplicateEmail && !isSqliteDuplicateEmail) throw insertError;
  }

  const createdOrRacingAdmin = db.prepare("SELECT id, email, mobile_number, role, status FROM users WHERE LOWER(email) = LOWER(?) ORDER BY id LIMIT 1").get(adminEmail) || null;
  if (!createdOrRacingAdmin) {
    throw new Error('Core admin account was not found after the insert attempt');
  }
}
function seedDemoData() {
  if (isProduction || !seedDemoDataEnabled) return;
  const categoriesCount = db.prepare('SELECT COUNT(*) count FROM categories').get().count;
  if (categoriesCount > 0) return;
  const categoryNames = ['Electrical Switches', 'Sockets', 'Wires & Cables', 'Lighting', 'Fan Regulators', 'Electrical Accessories', 'Tools', 'Hardware', 'Plumbing Accessories', 'Other Products'];
  const categoryIds = new Map();
  const timestamp = now();
  const categoryInsert = db.prepare('INSERT INTO categories (name,slug,description,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)');
  for (const [index, name] of categoryNames.entries()) {
    categoryIds.set(name, Number(categoryInsert.run(name, slugify(name), 'Reliable products for everyday work.', index + 1, timestamp, timestamp).lastInsertRowid));
  }
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
  for (const [sku, name, category, brandId, price, mrp, stock, description, details] of products) {
    productInsert.run(sku, name, `${slugify(name)}-${sku.toLowerCase()}`, categoryIds.get(category), brandId, description, details, price, mrp, stock, null, timestamp, timestamp);
  }
}
backupDatabaseIfNeeded();
applyDatabaseMigrations();
migrateOrderStatusData();
if (isProduction) {
  syncPostgresSequences();
}
ensureCoreAdminAccount();
seedDemoData();
console.log('[database] Connected', { path: isProduction ? 'postgresql://configured-via-DATABASE_URL' : databasePath, resolvedPath: resolvedDatabasePath, environment: process.env.NODE_ENV || 'development', seedDemoData: seedDemoDataEnabled, mode: isProduction ? 'postgresql' : 'sqlite' });

const app = express();
console.log('[database] Configured', { path: isProduction ? 'postgresql://configured-via-DATABASE_URL' : databasePath, resolvedPath: resolvedDatabasePath, uploadDirectory, resolvedUploadDirectory, jwtSecretConfigured: Boolean(jwtSecret), seedDemoData: seedDemoDataEnabled, mode: isProduction ? 'postgresql' : 'sqlite' });
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use((req, _res, next) => {
  if (req.body == null || typeof req.body !== 'object') {
    req.body = {};
  }
  next();
});
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
app.get('/api/health', (_req, res) => res.json({ ok: true, database: isProduction ? 'postgresql' : 'sqlite', environment: process.env.NODE_ENV || 'development', productionDatabaseConfigured: Boolean(productionDatabaseUrl) }));
app.post('/api/auth/login', (req, res) => { const rawIdentifier = String(req.body.mobile ?? req.body.email ?? req.body.username ?? '').trim(); const password = String(req.body.password || ''); const normalizedMobile = normalizeMobile(rawIdentifier); const email = rawIdentifier.includes('@') ? rawIdentifier.toLowerCase() : ''; if ((!mobilePattern.test(normalizedMobile) && !email) || !password) return res.status(400).json({ error: 'Invalid mobile number or password.' }); const user = db.prepare("SELECT * FROM users WHERE status = 'ACTIVE' AND ((mobile_number = ? AND mobile_number IS NOT NULL) OR email = ?) LIMIT 1").get(normalizedMobile || null, email || null); if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid mobile number or password.' }); db.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), user.id); const token = jwt.sign({ id: user.id, role: user.role, email: user.email, mobile: user.mobile_number }, jwtSecret, { expiresIn: '8h' }); res.json({ token, user: { id: user.id, name: user.name, email: user.email, mobile: user.mobile_number, role: user.role } }); });
app.post('/api/auth/register', (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  console.log('[api/auth/register]', {
    method: req.method,
    path: req.path,
    contentType: req.headers['content-type'],
    body: {
      name: body.name ? String(body.name).trim() : undefined,
      mobile: body.mobile ? String(body.mobile).trim() : undefined,
      passwordProvided: Boolean(body.password),
    },
  });
  const name = String(body.name || '').trim();
  const mobile = normalizeMobile(body.mobile);
  const password = String(body.password || '');
  if (!name || !mobilePattern.test(mobile) || password.length < 8) {
    return res.status(400).json({ error: 'Name, valid mobile number and an 8-character password are required' });
  }

  try {
    const existingCustomer = db.prepare("SELECT id FROM users WHERE role = 'CUSTOMER' AND mobile_number = ?").get(mobile);
    if (existingCustomer) {
      return res.status(409).json({ error: 'This mobile number is already registered' });
    }

    const email = `${mobile}@mobile.local`;
    const timestamp = now();
    let result;
    try {
      result = db.prepare('INSERT INTO users (name,email,mobile_number,password_hash,role,status,created_at,updated_at,last_login_at) VALUES (?,?,?,?,?,?,?,?,?)').run(name, email, mobile, bcrypt.hashSync(password, 12), 'CUSTOMER', 'ACTIVE', timestamp, timestamp, timestamp);
    } catch (insertError) {
      if (String(insertError && insertError.message || '').toUpperCase().includes('UNIQUE') || String(insertError && insertError.message || '').toUpperCase().includes('duplicate')) {
        return res.status(409).json({ error: 'That mobile number is already linked to an account' });
      }
      if (isProduction && String(insertError && insertError.message || '').toUpperCase().includes('PRIMARY KEY')) {
        syncPostgresSequences();
        const retryResult = db.prepare('INSERT INTO users (name,email,mobile_number,password_hash,role,status,created_at,updated_at,last_login_at) VALUES (?,?,?,?,?,?,?,?,?)').run(name, email, mobile, bcrypt.hashSync(password, 12), 'CUSTOMER', 'ACTIVE', timestamp, timestamp, timestamp);
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(retryResult.lastInsertRowid);
        const token = jwt.sign({ id: user.id, role: user.role, email: user.email, mobile: user.mobile_number }, jwtSecret, { expiresIn: '8h' });
        return res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email, mobile: user.mobile_number, role: user.role } });
      }
      throw insertError;
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    const token = jwt.sign({ id: user.id, role: user.role, email: user.email, mobile: user.mobile_number }, jwtSecret, { expiresIn: '8h' });
    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email, mobile: user.mobile_number, role: user.role } });
  } catch (error) {
    console.error('[api/auth/register] insert failed', { message: error && error.message, stack: error && error.stack, mobile, email: `${mobile}@mobile.local` });
    const message = String(error && error.message || '');
    const isUnique = /UNIQUE|duplicate/i.test(message);
    res.status(isUnique ? 409 : 400).json({ error: isUnique ? 'That mobile number is already linked to an account' : 'Unable to create customer account' });
  }
});
app.get('/api/me', auth, (req, res) => { const user = db.prepare('SELECT id,name,email,mobile_number AS mobile FROM users WHERE id = ? AND role = ? AND status = ?').get(req.user.id, 'CUSTOMER', 'ACTIVE'); if (!user) return res.status(404).json({ error: 'Customer account not found' }); res.json({ id: user.id, name: user.name, email: user.email, mobile: user.mobile }); });
app.patch('/api/me', auth, (req, res) => { if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Customer access required' }); const name = String(req.body.name || '').trim(); if (!name) return res.status(400).json({ error: 'Full name is required' }); db.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ? AND role = ?').run(name, now(), req.user.id, 'CUSTOMER'); res.json(db.prepare('SELECT id,name,email,mobile_number AS mobile FROM users WHERE id = ?').get(req.user.id)); });
app.get('/api/me/addresses', auth, (req, res) => { if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Customer access required' }); res.json(db.prepare('SELECT * FROM addresses WHERE customer_id = ? ORDER BY is_default DESC, created_at DESC').all(req.user.id).map(mapAddress)); });
app.post('/api/me/addresses', auth, (req, res) => {
  if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Customer access required' });
  const body = req.body || {};
  console.log('[api/me/addresses]', {
    method: req.method,
    path: req.path,
    contentType: req.headers['content-type'],
    body: {
      fullName: body.fullName ?? body.full_name,
      phone: body.phone,
      addressLine1: body.addressLine1 ?? body.address_line1,
      city: body.city,
      state: body.state,
      pincode: body.pincode,
      gstNumber: body.gstNumber ?? body.gst_number,
      isDefault: body.isDefault ?? body.is_default,
    },
  });

  const fullName = String(body.fullName ?? body.full_name ?? '').trim();
  const phone = String(body.phone ?? '').trim();
  const addressLine1 = String(body.addressLine1 ?? body.address_line1 ?? '').trim();
  const city = String(body.city ?? '').trim();
  const state = String(body.state ?? '').trim();
  const pincode = String(body.pincode ?? '').trim();
  const gstNumber = normalizeGstNumber(body.gstNumber ?? body.gst_number ?? '');
  const required = [fullName, phone, addressLine1, city, state, pincode];
  if (required.some((field) => !field) || !/^\d{10}$/.test(phone.replace(/\D/g, '')) || !/^\d{6}$/.test(pincode.trim())) {
    return res.status(400).json({ error: 'Please provide valid required address details' });
  }
  if (gstNumber && !isValidGstNumber(gstNumber)) {
    return res.status(400).json({ error: 'Please enter a valid GST number.' });
  }

  const timestamp = now();
  const makeDefault = Boolean(body.isDefault ?? body.is_default) || !db.prepare('SELECT 1 FROM addresses WHERE customer_id = ? LIMIT 1').get(req.user.id);
  const addressType = ['Home', 'Office', 'Other'].includes(String(body.type ?? body.address_type ?? '').trim()) ? (body.type ?? body.address_type) : 'Home';
  const area = String(body.area ?? body.addressLine2 ?? body.address_line2 ?? '').trim();
  const addressLine2 = String(body.addressLine2 ?? body.address_line2 ?? '').trim();

  try {
    if (makeDefault) {
      db.prepare('UPDATE addresses SET is_default = 0 WHERE customer_id = ?').run(req.user.id);
    }

    const result = db.prepare('INSERT INTO addresses (customer_id,type,full_name,phone,gst_number,address_line1,address_line2,area,city,state,pincode,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      req.user.id,
      addressType,
      fullName,
      phone,
      gstNumber || null,
      addressLine1,
      addressLine2,
      area,
      city,
      state,
      pincode,
      makeDefault ? 1 : 0,
      timestamp,
      timestamp,
    );

    const row = db.prepare('SELECT * FROM addresses WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(mapAddress(row));
  } catch (error) {
    console.error('[api/me/addresses] insert failed', { message: error && error.message, stack: error && error.stack, body, userId: req.user && req.user.id });
    res.status(400).json({ error: 'Unable to save address' });
  }
});
app.patch('/api/me/addresses/:id', auth, (req, res) => { if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Customer access required' }); const body = req.body || {}; const current = db.prepare('SELECT * FROM addresses WHERE id = ? AND customer_id = ?').get(Number(req.params.id), req.user.id); if (!current) return res.status(404).json({ error: 'Address not found' }); const fullName = String(body.fullName ?? body.full_name ?? current.full_name).trim(); const phone = String(body.phone ?? current.phone).trim(); const addressLine1 = String(body.addressLine1 ?? body.address_line1 ?? current.address_line1).trim(); const city = String(body.city ?? current.city).trim(); const state = String(body.state ?? current.state).trim(); const pincode = String(body.pincode ?? current.pincode).trim(); const gstNumber = normalizeGstNumber(body.gstNumber ?? body.gst_number ?? current.gst_number ?? ''); if (gstNumber && !isValidGstNumber(gstNumber)) return res.status(400).json({ error: 'Please enter a valid GST number.' }); const makeDefault = Boolean(body.isDefault ?? body.is_default); if (makeDefault) db.prepare('UPDATE addresses SET is_default = ? WHERE customer_id = ?').run(false, req.user.id); db.prepare('UPDATE addresses SET type = ?, full_name = ?, phone = ?, gst_number = ?, address_line1 = ?, address_line2 = ?, area = ?, city = ?, state = ?, pincode = ?, is_default = ?, updated_at = ? WHERE id = ? AND customer_id = ?').run(body.type || current.type, fullName, phone, gstNumber || null, addressLine1, String(body.addressLine2 ?? body.address_line2 ?? current.address_line2).trim(), String(body.area ?? current.area).trim(), city, state, pincode, makeDefault ? true : Boolean(current.is_default), now(), current.id, req.user.id); res.json(mapAddress(db.prepare('SELECT * FROM addresses WHERE id = ?').get(current.id))); });
app.delete('/api/me/addresses/:id', auth, (req, res) => { if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Customer access required' }); const result = db.prepare('DELETE FROM addresses WHERE id = ? AND customer_id = ?').run(Number(req.params.id), req.user.id); if (!result.changes) return res.status(404).json({ error: 'Address not found' }); const remaining = db.prepare('SELECT id FROM addresses WHERE customer_id = ? ORDER BY created_at LIMIT 1').get(req.user.id); if (remaining) db.prepare('UPDATE addresses SET is_default = 1 WHERE id = ? AND NOT EXISTS (SELECT 1 FROM addresses WHERE customer_id = ? AND is_default = 1)').run(remaining.id, req.user.id); res.status(204).end(); });
app.get('/api/me/orders', auth, (req, res) => { if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Customer access required' }); const rows = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC').all(req.user.id).map(mapOrder); res.json(rows); });
app.get('/api/orders/:id', auth, (req, res) => { const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id)); if (!order) return res.status(404).json({ error: 'Order not found' }); const mapped = mapOrder(order); if (req.user.role === 'ADMIN' || Number(req.user.id) === Number(order.customer_id)) return res.json(mapped); return res.status(403).json({ error: 'You do not have access to this order' }); });
app.get('/api/admin/orders', auth, admin, (_req, res) => { const rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all().map(mapOrder); res.json(rows); });
app.patch('/api/admin/orders/:id/status', auth, admin, async (req, res) => {
  const orderId = Number(req.params.id);
  const requestedStatus = normalizeOrderStatus(req.body?.status);
  if (!Number.isInteger(orderId) || orderId <= 0) return res.status(400).json({ error: 'Invalid order ID' });
  if (!requestedStatus) return res.status(400).json({ error: 'Invalid order status' });

  db.exec('BEGIN IMMEDIATE');
  try {
    const lockClause = isProduction ? ' FOR UPDATE' : '';
    const order = db.prepare(`SELECT * FROM orders WHERE id = ?${lockClause}`).get(orderId);
    if (!order) {
      db.exec('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }
    const currentStatus = normalizeOrderStatus(order.status);
    if (!currentStatus || !allowedOrderTransitions[currentStatus]?.has(requestedStatus)) {
      db.exec('ROLLBACK');
      return res.status(409).json({ error: `Invalid order status transition: ${currentStatus || 'UNKNOWN'} to ${requestedStatus}` });
    }
    const timestamp = now();
    const note = String(req.body?.note || '').trim().slice(0, 500);
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(requestedStatus, timestamp, orderId);
    db.prepare('INSERT INTO order_status_history (order_id,status,changed_by,created_at,note) VALUES (?,?,?,?,?)').run(orderId, requestedStatus, req.user.id, timestamp, note);
    db.exec('COMMIT');
    const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    let notification = null;
    if (requestedStatus === 'CONFIRMED') {
      const customerRecipient = updatedOrder.customer_phone;
      notification = await createOrderNotification({
        order: updatedOrder,
        type: 'ORDER_CONFIRMED_CUSTOMER',
        recipient: customerRecipient,
        status: requestedStatus,
      });
    }
    res.json({ ...mapOrder(updatedOrder), notification: notification ? { whatsappUrl: notification.whatsappUrl || null, prepared: true } : null });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* transaction already closed */ }
    console.error('[api/admin/orders/:id/status]', error && error.stack ? error.stack : error);
    res.status(500).json({ error: 'Unable to update order status' });
  }
});
app.get('/api/orders/:id/status-history', auth, (req, res) => {
  const orderId = Number(req.params.id);
  const order = db.prepare('SELECT customer_id FROM orders WHERE id = ?').get(orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (req.user.role !== 'ADMIN' && Number(req.user.id) !== Number(order.customer_id)) return res.status(403).json({ error: 'You do not have access to this order' });
  res.json(db.prepare('SELECT id, status, changed_by AS changedBy, created_at AS createdAt, note FROM order_status_history WHERE order_id = ? ORDER BY created_at, id').all(orderId).map((row) => ({ ...row, status: normalizeOrderStatus(row.status) || 'PENDING' })));
});
app.post('/api/orders/:id/notify', auth, admin, async (req, res) => {
  const orderId = Number(req.params.id);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const status = normalizeOrderStatus(order.status);
  const notificationType = notificationTypeForStatus[status];
  if (!notificationType) return res.status(400).json({ error: 'WhatsApp notification is not available for this order status' });
  const user = db.prepare('SELECT mobile_number FROM users WHERE id = ? AND role = ?').get(order.customer_id, 'CUSTOMER');
  const ownerNotification = notificationType === 'NEW_ORDER_OWNER';
  const result = await createOrderNotification({
    order,
    type: notificationType,
    recipient: ownerNotification ? ownerWhatsappNumber : (user?.mobile_number || order.customer_phone),
    status,
  });
  if (!result.whatsappUrl) return res.status(502).json({ error: 'Invalid recipient WhatsApp number.', notificationId: result.notificationId });
  res.json({ notificationId: result.notificationId, channel: 'WHATSAPP', whatsappUrl: result.whatsappUrl, prepared: true });
});
app.patch('/api/orders/:orderId/confirm', auth, admin, async (req, res) => {
  const orderId = Number(req.params.orderId);
  if (!orderId) return res.status(400).json({ error: 'Order ID is required' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const currentStatus = normalizeOrderStatus(order.status);
  if (currentStatus === 'CONFIRMED') {
    const customerRaw = String(order.customer_phone || '').trim();
    const customerNormalized = normalizeWhatsAppNumber(customerRaw);
    const customerValid = customerNormalized && isValidWhatsAppNumber(customerRaw);
    const message = buildOrderNotificationMessage(order, 'CONFIRMED');
    const whatsappUrl = customerValid && message ? buildWhatsAppUrl(customerNormalized, message) : '';
    return res.status(200).json({ success: true, alreadyConfirmed: true, message: 'Order already confirmed.', order: mapOrder(order), customerMobile: customerNormalized || order.customer_phone, whatsappUrl });
  }
  if (currentStatus !== 'PENDING') {
    return res.status(409).json({ error: `Cannot confirm order with status "${currentStatus}". Only PENDING orders can be confirmed.` });
  }
  const customerRaw = String(order.customer_phone || '').trim();
  const customerNormalized = normalizeWhatsAppNumber(customerRaw);
  if (!customerNormalized || !isValidWhatsAppNumber(customerRaw)) {
    return res.status(400).json({ error: 'Please enter a valid WhatsApp-enabled mobile number for the customer.' });
  }
  const timestamp = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE orders SET status = ?, updated_at = ?, notification_status = ? WHERE id = ? AND status = ?').run('CONFIRMED', timestamp, 'PREPARED', orderId, 'PENDING');
    db.prepare('INSERT INTO order_status_history (order_id,status,changed_by,created_at,note) VALUES (?,?,?,?,?)').run(orderId, 'CONFIRMED', req.user.id, timestamp, 'Owner confirmed order');
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* noop */ }
    console.error('[api/orders/:orderId/confirm]', error && error.stack ? error.stack : error);
    return res.status(500).json({ error: 'Unable to confirm order' });
  }
  const confirmedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const confirmationResult = await createOrderNotification({
    order: confirmedOrder,
    type: 'ORDER_CONFIRMED_CUSTOMER',
    recipient: customerRaw,
    status: 'CONFIRMED',
  });
  res.json({
    success: true,
    alreadyConfirmed: false,
    order: mapOrder(confirmedOrder),
    customerMobile: customerNormalized,
    whatsappUrl: confirmationResult.whatsappUrl || '',
    notificationId: confirmationResult.notificationId || null,
  });
});
app.get('/api/admin/customers', auth, admin, (_req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.name, u.email, u.mobile_number, u.status, u.created_at, u.last_login_at,
      COUNT(o.id) AS order_count,
      COALESCE(SUM(o.total), 0) AS total_spent
    FROM users u
    LEFT JOIN orders o ON o.customer_id = u.id
    WHERE u.role = 'CUSTOMER'
    GROUP BY u.id, u.name, u.email, u.mobile_number, u.status, u.created_at, u.last_login_at
    ORDER BY u.created_at DESC
  `).all().map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.mobile_number,
    status: row.status,
    createdAt: row.created_at,
    lastLogin: row.last_login_at,
    orderCount: Number(row.order_count || 0),
    totalSpent: Number(row.total_spent || 0),
  }));
  res.json(rows);
});
const handleCreateCustomerOrder = async (req, res) => {
  if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Customer access required' });
  const body = req.body || {};
  const address = db.prepare('SELECT * FROM addresses WHERE id = ? AND customer_id = ?').get(Number(body.addressId), req.user.id);
  const user = db.prepare('SELECT id,name,email,mobile_number FROM users WHERE id = ?').get(req.user.id);
  if (!address || !user || !Array.isArray(body.items) || !body.items.length) return res.status(400).json({ error: 'A delivery address and cart items are required' });
  const customerMobileRaw = String(address.phone || user.mobile_number || body.customerMobile || '').trim();
  if (!customerMobileRaw || !isValidWhatsAppNumber(customerMobileRaw)) {
    return res.status(400).json({ error: 'Please enter a valid WhatsApp-enabled mobile number.' });
  }
  if (!ownerWhatsappNumber || !isValidWhatsAppNumber(ownerWhatsappNumber)) {
    return res.status(500).json({ error: 'Owner WhatsApp number is not configured correctly.' });
  }
  const gstNumber = normalizeGstNumber(body.gstNumber ?? body.gst_number ?? address.gst_number ?? ''); if (gstNumber && !isValidGstNumber(gstNumber)) return res.status(400).json({ error: 'Please enter a valid GST number.' }); const normalizedItems = body.items.map((item) => ({ productId: Number(item.productId), name: String(item.name || '').trim(), quantity: Number(item.quantity), price: Number(item.price || 0) })); if (!normalizedItems.length || normalizedItems.some((item) => !item.productId || !item.name || !Number.isInteger(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.price) || item.price < 0)) {
    return res.status(400).json({ error: 'Order items are invalid' });
  }
  const timestamp = now();
  const idempotencyKey = String(body.idempotencyKey || `${req.user.id}:${Date.now()}:${timestamp}`);
  const existing = db.prepare('SELECT * FROM orders WHERE idempotency_key = ?').get(idempotencyKey);
  if (existing) {
    const existingOwnerMsg = buildOwnerOrderNotificationMessage(existing);
    const existingWhatsappUrl = buildWhatsAppUrl(ownerWhatsappNumber, existingOwnerMsg);
    return res.status(200).json({ success: true, order: mapOrder(existing), whatsappUrl: existingWhatsappUrl });
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const catalogRows = normalizedItems.map((item) => db.prepare('SELECT * FROM products WHERE id = ? AND status = ?').get(item.productId, 'ACTIVE'));
    if (catalogRows.some((product) => !product)) {
      throw new Error('One or more products are unavailable');
    }

    const snapshotItems = normalizedItems.map((item) => {
      const product = db.prepare('SELECT * FROM products WHERE id = ? AND status = ?').get(item.productId, 'ACTIVE');
      if (!product) {
        throw new Error(`Product ${item.productId} is unavailable`);
      }
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error(`Invalid quantity for ${product.name}`);
      }
      if (Number(product.stock || 0) < quantity) {
        throw new Error(`Insufficient stock for ${product.name}. Available: ${product.stock}`);
      }
      const finalPrice = Number(product.price || 0);
      return {
        productId: product.id,
        productName: product.name,
        productImage: product.image_url || '',
        quantity,
        unit: String(product.unit || '').trim(),
        unitPrice: finalPrice,
        totalPrice: finalPrice * quantity,
        name: product.name,
        price: finalPrice,
      };
    });

    const subtotal = snapshotItems.reduce((total, item) => total + item.totalPrice, 0);
    const deliveryCharge = 0;
    const total = subtotal + deliveryCharge;
    const snapshot = { ...mapAddress(address), gstNumber: gstNumber || mapAddress(address).gstNumber || null };
    const orderNumber = `MH-${String(Date.now()).slice(-6)}`;

    const result = db.prepare('INSERT INTO orders (order_number,customer_id,customer_name,customer_email,customer_phone,gst_number,items_json,subtotal,delivery_charge,total,status,payment_method,payment_status,delivery_address_json,idempotency_key,notification_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(orderNumber, req.user.id, user.name, user.email || `${user.mobile_number}@mobile.local`, address.phone, gstNumber || null, JSON.stringify(snapshotItems), subtotal, deliveryCharge, total, 'PENDING', 'Cash on Delivery', 'PENDING', JSON.stringify(snapshot), idempotencyKey, 'PENDING', timestamp, timestamp);
    const orderId = Number(result.lastInsertRowid);
    const orderItemInsert = db.prepare('INSERT INTO order_items (order_id,product_id,product_name,product_image,quantity,unit_price,total_price,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const item of snapshotItems) {
      orderItemInsert.run(orderId, item.productId, item.productName, item.productImage, item.quantity, item.unitPrice, item.totalPrice, timestamp, timestamp);
    }
    db.prepare('INSERT INTO order_status_history (order_id,status,changed_by,created_at,note) VALUES (?,?,?,?,?)').run(orderId, 'PENDING', req.user.id, timestamp, 'Order placed');

    for (const item of snapshotItems) {
      const stockResult = db.prepare('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ? AND stock >= ?').run(item.quantity, now(), item.productId, item.quantity);
      if (!stockResult.changes) {
        throw new Error(`Insufficient stock for ${item.productName}`);
      }
    }

    db.exec('COMMIT');
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const ownerMsg = buildOwnerOrderNotificationMessage(order);
    const ownerNotification = await createOrderNotification({
      order,
      type: 'NEW_ORDER_OWNER',
      recipient: ownerWhatsappNumber,
      status: 'PENDING',
    });
    if (ownerNotification.notificationId) {
      db.prepare('UPDATE orders SET notification_status = ? WHERE id = ?').run('PREPARED', orderId);
    }
    const whatsappUrl = ownerNotification.whatsappUrl || buildWhatsAppUrl(ownerWhatsappNumber, ownerMsg);
    res.status(201).json({ success: true, order: mapOrder(order), whatsappUrl });
  } catch (error) {
    db.exec('ROLLBACK');
    if (String(error.message).includes('UNIQUE')) {
      const existingDuplicate = db.prepare('SELECT * FROM orders WHERE idempotency_key = ?').get(idempotencyKey);
      if (existingDuplicate) {
        const existingOwnerMsg = buildOwnerOrderNotificationMessage(existingDuplicate);
        const existingWhatsappUrl = buildWhatsAppUrl(ownerWhatsappNumber, existingOwnerMsg);
        return res.status(200).json({ success: true, order: mapOrder(existingDuplicate), whatsappUrl: existingWhatsappUrl });
      }
    }
    const message = String(error.message || 'Unable to create order. Please try again.');
    res.status(400).json({ error: message.includes('Insufficient stock') || message.includes('unavailable') || message.includes('Invalid quantity') ? message : 'Unable to create order. Please try again.' });
  }
};
app.post('/api/orders', auth, handleCreateCustomerOrder);
app.post('/api/me/orders', auth, handleCreateCustomerOrder);
app.get('/api/catalog', (_req, res) => { const categories = db.prepare("SELECT * FROM categories WHERE status = 'ACTIVE' ORDER BY sort_order, name").all().map(mapCategory); const products = db.prepare(`${productSelect} WHERE p.status = 'ACTIVE' ORDER BY p.created_at DESC`).all().map(mapProduct); res.json({ categories, products }); });
app.get('/api/categories', (_req, res) => {
  const rows = db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all();
  const categories = rows.map((row) => {
    const attributes = db.prepare('SELECT * FROM attributes WHERE category_id = ? ORDER BY sort_order, name').all(row.id);
    return mapCategory(row, attributes);
  });
  res.json(categories);
});
function upsertCategoryAttributes(categoryId, attributes) {
  if (!Array.isArray(attributes)) return;
  const attributeRows = attributes
    .map((attribute) => ({
      id: attribute?.id != null ? Number(attribute.id) : null,
      name: String(attribute?.name || '').trim(),
      type: String(attribute?.type || 'Text'),
      values: Array.isArray(attribute?.values) ? attribute.values.map((value) => String(value).trim()).filter(Boolean) : [],
    }))
    .filter((attribute) => attribute.name);

  const allowedType = new Set(['Dropdown', 'Multi-select', 'Text', 'Number', 'Number Range', 'Boolean / Yes-No', 'Color', 'Image', 'Radio Button']);
  const existing = db.prepare('SELECT id, name FROM attributes WHERE category_id = ?').all(categoryId);
  const existingByName = new Map(existing.map((row) => [String(row.name).trim().toLowerCase(), row]));
  const nextIds = new Set();

  for (const attribute of attributeRows) {
    const normalizedType = allowedType.has(attribute.type) ? attribute.type : 'Text';
    const key = attribute.name.trim().toLowerCase();
    const current = existingByName.get(key);
    const valuesJson = JSON.stringify(attribute.values);
    if (current) {
      db.prepare('UPDATE attributes SET name = ?, type = ?, options_json = ?, updated_at = ? WHERE id = ? AND category_id = ?').run(attribute.name, normalizedType, valuesJson, now(), current.id, categoryId);
      nextIds.add(Number(current.id));
    } else {
      const result = db.prepare('INSERT INTO attributes (category_id, name, type, required, filterable, searchable, options_json, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, 0, 0, ?, ?, 0, ?, ?)').run(categoryId, attribute.name, normalizedType, valuesJson, 'ACTIVE', now(), now());
      nextIds.add(Number(result.lastInsertRowid));
    }
  }

  const staleIds = existing.filter((row) => !nextIds.has(Number(row.id))).map((row) => Number(row.id));
  if (staleIds.length) {
    const placeholders = staleIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM attributes WHERE id IN (${placeholders})`).run(...staleIds);
  }
}
app.post('/api/categories', auth, admin, (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  console.log('[api/categories POST]', {
    method: req.method,
    path: req.path,
    contentType: req.headers['content-type'],
    body: {
      name: body.name ? String(body.name).trim() : undefined,
      slug: body.slug ? String(body.slug).trim() : undefined,
      description: body.description ? String(body.description).trim() : undefined,
    },
  });
  const timestamp = now();
  const name = String(body.name || '').trim();
  const providedSlug = String(body.slug || name || '').trim();
  const slugValue = providedSlug ? slugify(providedSlug) : '';
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  if (!slugValue) return res.status(400).json({ error: 'Category slug is required' });
  db.exec('BEGIN');
  try {
    const duplicate = db.prepare('SELECT id FROM categories WHERE slug = ? COLLATE NOCASE').get(slugValue);
    if (duplicate) {
      db.exec('ROLLBACK');
      return res.status(409).json({ error: 'Category slug already exists' });
    }
    const result = db.prepare('INSERT INTO categories (name,slug,parent_id,image_url,description,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(name, slugValue, body.parentId || null, body.imageUrl || null, body.description || '', body.status || 'ACTIVE', Number(body.sortOrder || 0), timestamp, timestamp);
    upsertCategoryAttributes(result.lastInsertRowid, body.attributes);
    const storedAttributes = db.prepare('SELECT * FROM attributes WHERE category_id = ? ORDER BY sort_order, name').all(result.lastInsertRowid);
    const category = mapCategory(db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid), storedAttributes);
    db.exec('COMMIT');
    res.status(201).json(category);
  } catch (error) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: error.message.includes('UNIQUE') ? 'Category slug already exists' : 'Unable to create category' });
  }
});
app.patch('/api/categories/:id', auth, admin, (req, res) => {
  const body = req.body || {};
  const id = Number(req.params.id);
  const timestamp = now();
  const current = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Category not found' });
  const name = body.name == null ? current.name : String(body.name).trim();
  const providedSlug = body.slug == null ? current.slug : String(body.slug || body.name || '').trim();
  const slugValue = providedSlug ? slugify(providedSlug) : current.slug;
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  db.exec('BEGIN');
  try {
    const duplicate = db.prepare('SELECT id FROM categories WHERE slug = ? COLLATE NOCASE AND id != ?').get(slugValue, id);
    if (duplicate) {
      db.exec('ROLLBACK');
      return res.status(409).json({ error: 'Category slug already exists' });
    }
    const imageValue = body.imageUrl == null ? current.image_url : body.imageUrl || current.image_url;
    const result = db.prepare('UPDATE categories SET name = ?, slug = ?, parent_id = ?, image_url = ?, description = ?, status = ?, sort_order = ?, updated_at = ? WHERE id = ?').run(name, slugValue, body.parentId ?? current.parent_id, imageValue, body.description == null ? current.description : String(body.description), body.status == null ? current.status : body.status, body.sortOrder == null ? current.sort_order : Number(body.sortOrder), timestamp, id);
    if (!result.changes) {
      db.exec('ROLLBACK');
      return res.status(404).json({ error: 'Category not found' });
    }
    upsertCategoryAttributes(id, body.attributes);
    db.exec('COMMIT');
    res.json(mapCategory(db.prepare('SELECT * FROM categories WHERE id = ?').get(id)));
  } catch (error) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: error.message.includes('UNIQUE') ? 'Category slug already exists' : 'Unable to update category' });
  }
});
app.patch('/api/categories/:id/archive', auth, admin, (req, res) => { const id = Number(req.params.id); const productCount = db.prepare("SELECT COUNT(*) count FROM products WHERE category_id = ? AND status != 'ARCHIVED'").get(id).count; if (productCount > 0) { const result = db.prepare("UPDATE categories SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now(), id); if (!result.changes) return res.status(404).json({ error: 'Category not found' }); return res.json({ archived: true, productCount, message: 'Category archived and removed from the public catalog.' }); } const result = db.prepare('DELETE FROM categories WHERE id = ?').run(id); if (!result.changes) return res.status(404).json({ error: 'Category not found' }); res.json({ deleted: true, message: 'Category deleted because it has no remaining products.' }); });
app.patch('/api/categories/:id/restore', auth, admin, (req, res) => { const result = db.prepare("UPDATE categories SET status = 'ACTIVE', updated_at = ? WHERE id = ?").run(now(), Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Category not found' }); res.json({ restored: true }); });
app.get('/api/brands', (_req, res) => res.json(db.prepare('SELECT * FROM brands ORDER BY name').all().map(mapBrand)));
app.post('/api/brands', auth, admin, (req, res) => { const body = req.body || {}; const timestamp = now(); try { const result = db.prepare('INSERT INTO brands (name,slug,logo_url,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(String(body.name).trim(), slugify(body.slug || body.name), body.logoUrl || null, body.description || '', body.status || 'ACTIVE', timestamp, timestamp); res.status(201).json(mapBrand(db.prepare('SELECT * FROM brands WHERE id = ?').get(result.lastInsertRowid))); } catch (error) { res.status(400).json({ error: error.message.includes('UNIQUE') ? 'Brand slug already exists' : 'Unable to create brand' }); } });
app.patch('/api/brands/:id', auth, admin, (req, res) => { const body = req.body || {}; const timestamp = now(); try { const result = db.prepare('UPDATE brands SET name = COALESCE(?, name), logo_url = COALESCE(?, logo_url), description = COALESCE(?, description), status = COALESCE(?, status), updated_at = ? WHERE id = ?').run(body.name ?? null, body.logoUrl ?? null, body.description ?? null, body.status ?? null, timestamp, Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Brand not found' }); res.json(mapBrand(db.prepare('SELECT * FROM brands WHERE id = ?').get(Number(req.params.id)))); } catch { res.status(400).json({ error: 'Unable to update brand' }); } });
app.patch('/api/brands/:id/archive', auth, admin, (req, res) => { const id = Number(req.params.id); const productCount = db.prepare("SELECT COUNT(*) count FROM products WHERE brand_id = ? AND status != 'ARCHIVED'").get(id).count; if (productCount > 0) { const result = db.prepare("UPDATE brands SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now(), id); if (!result.changes) return res.status(404).json({ error: 'Brand not found' }); return res.json({ archived: true, productCount, message: 'Brand archived and removed from active catalog listings.' }); } const result = db.prepare('DELETE FROM brands WHERE id = ?').run(id); if (!result.changes) return res.status(404).json({ error: 'Brand not found' }); res.json({ deleted: true, message: 'Brand deleted because it has no remaining products.' }); });
app.patch('/api/brands/:id/restore', auth, admin, (req, res) => { const result = db.prepare("UPDATE brands SET status = 'ACTIVE', updated_at = ? WHERE id = ?").run(now(), Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Brand not found' }); res.json({ restored: true }); });
app.get('/api/product-types', (req, res) => { const categoryId = Number(req.query.categoryId || 0); const query = categoryId ? 'SELECT * FROM product_types WHERE category_id = ? ORDER BY sort_order, name' : 'SELECT * FROM product_types ORDER BY category_id, sort_order, name'; const rows = categoryId ? db.prepare(query).all(categoryId) : db.prepare(query).all(); res.json(rows.map(mapProductType)); });
app.post('/api/product-types', auth, admin, (req, res) => { const body = req.body || {}; const timestamp = now(); try { const result = db.prepare('INSERT INTO product_types (category_id,name,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(Number(body.categoryId), String(body.name).trim(), body.status || 'ACTIVE', Number(body.sortOrder || 0), timestamp, timestamp); res.status(201).json(mapProductType(db.prepare('SELECT * FROM product_types WHERE id = ?').get(result.lastInsertRowid))); } catch (error) { res.status(400).json({ error: error.message.includes('UNIQUE') ? 'A product type with that name already exists in this category' : 'Unable to create product type' }); } });
app.patch('/api/product-types/:id/archive', auth, admin, (req, res) => { const id = Number(req.params.id); const productCount = db.prepare("SELECT COUNT(*) count FROM products WHERE product_type_id = ? AND status != 'ARCHIVED'").get(id).count; if (productCount > 0) { const result = db.prepare("UPDATE product_types SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now(), id); if (!result.changes) return res.status(404).json({ error: 'Product type not found' }); return res.json({ archived: true, productCount, message: 'Product type archived and removed from active category workflows.' }); } const result = db.prepare('DELETE FROM product_types WHERE id = ?').run(id); if (!result.changes) return res.status(404).json({ error: 'Product type not found' }); res.json({ deleted: true, message: 'Product type deleted because it has no remaining products.' }); });
app.patch('/api/product-types/:id/restore', auth, admin, (req, res) => { const result = db.prepare("UPDATE product_types SET status = 'ACTIVE', updated_at = ? WHERE id = ?").run(now(), Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Product type not found' }); res.json({ restored: true }); });
app.get('/api/attributes', (req, res) => { const categoryId = Number(req.query.categoryId || 0); const query = categoryId ? 'SELECT * FROM attributes WHERE category_id = ? ORDER BY sort_order, name' : 'SELECT * FROM attributes ORDER BY category_id, sort_order, name'; const rows = categoryId ? db.prepare(query).all(categoryId) : db.prepare(query).all(); res.json(rows.map(mapAttribute)); });
app.post('/api/attributes', auth, admin, (req, res) => { const body = req.body || {}; const timestamp = now(); try { const result = db.prepare('INSERT INTO attributes (category_id,name,type,required,filterable,searchable,options_json,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(Number(body.categoryId), String(body.name).trim(), String(body.type || 'Text'), Number(Boolean(body.required)), Number(Boolean(body.filterable)), Number(Boolean(body.searchable)), JSON.stringify(Array.isArray(body.options) ? body.options : []), body.status || 'ACTIVE', Number(body.sortOrder || 0), timestamp, timestamp); res.status(201).json(mapAttribute(db.prepare('SELECT * FROM attributes WHERE id = ?').get(result.lastInsertRowid))); } catch (error) { res.status(400).json({ error: error.message.includes('UNIQUE') ? 'An attribute with that name already exists in this category' : 'Unable to create attribute' }); } });
app.patch('/api/attributes/:id/archive', auth, admin, (req, res) => { const id = Number(req.params.id); const productCount = db.prepare("SELECT COUNT(*) count FROM products WHERE attributes_json LIKE ? AND status != 'ARCHIVED'").get(`%"${id}"%`).count; if (productCount > 0) { const result = db.prepare("UPDATE attributes SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now(), id); if (!result.changes) return res.status(404).json({ error: 'Attribute not found' }); return res.json({ archived: true, productCount, message: 'Attribute archived and preserved on existing products.' }); } const result = db.prepare('DELETE FROM attributes WHERE id = ?').run(id); if (!result.changes) return res.status(404).json({ error: 'Attribute not found' }); res.json({ deleted: true, message: 'Attribute deleted because it is not used by any products.' }); });
app.patch('/api/attributes/:id/restore', auth, admin, (req, res) => { const result = db.prepare("UPDATE attributes SET status = 'ACTIVE', updated_at = ? WHERE id = ?").run(now(), Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Attribute not found' }); res.json({ restored: true }); });
app.post('/api/migration/legacy', auth, admin, (req, res) => { const categories = Array.isArray(req.body?.categories) ? req.body.categories : []; const products = Array.isArray(req.body?.products) ? req.body.products : []; const timestamp = now(); try { db.exec('BEGIN'); const categoryInsert = db.prepare('INSERT OR IGNORE INTO categories (name,slug,description,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)'); for (const [index, category] of categories.entries()) categoryInsert.run(String(category.name || '').trim(), slugify(category.slug || category.name || `legacy-${index}`), category.description || '', Number(category.order || index + 1), timestamp, timestamp); const categoryId = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE'); const brandInsert = db.prepare('INSERT OR IGNORE INTO brands (name,slug,created_at,updated_at) VALUES (?,?,?,?)'); const brandId = db.prepare('SELECT id FROM brands WHERE name = ? COLLATE NOCASE'); const productInsert = db.prepare('INSERT OR IGNORE INTO products (sku,name,slug,category_id,brand_id,description,details,price,mrp,stock,unit,image_url,attributes_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'); for (const product of products) { const categoryRow = categoryId.get(String(product.category || 'Other Products')); if (!categoryRow) continue; const brandName = String(product.brand || '').trim(); if (brandName) brandInsert.run(brandName, slugify(brandName), timestamp, timestamp); const brandRow = brandName ? brandId.get(brandName) : null; const sku = String(product.code || product.sku || '').trim(); if (!sku) continue; productInsert.run(sku, String(product.name || sku), slugify(`${product.name || sku}-${sku}`), categoryRow.id, brandRow?.id || null, product.description || '', product.details || '', Number(product.price || 0), Number(product.mrp || product.price || 0), Number(product.stock || 0), product.unit || 'Nos', product.image || null, JSON.stringify(product.attributes || {}), timestamp, timestamp); } db.exec('COMMIT'); res.json({ migrated: { categories: categories.length, products: products.length } }); } catch (error) { db.exec('ROLLBACK'); res.status(400).json({ error: 'Migration failed', detail: error.message }); } });
app.get('/api/products', (req, res) => { const page = Math.max(1, Number(req.query.page || 1)); const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50))); const search = String(req.query.search || '').trim(); const params = []; const filters = ["p.status = 'ACTIVE'"]; if (search) { filters.push('(p.name LIKE ? OR p.sku LIKE ? OR c.name LIKE ? OR b.name LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); } if (req.query.categoryId) { filters.push('p.category_id = ?'); params.push(Number(req.query.categoryId)); } const where = ` WHERE ${filters.join(' AND ')}`; const total = db.prepare(`SELECT COUNT(*) count FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id${where}`).get(...params).count; const rows = db.prepare(`${productSelect}${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit).map(mapProduct); res.json({ data: rows, page, limit, total, pages: Math.ceil(total / limit) }); });
app.post('/api/products/bulk-import', auth, admin, (req, res) => {
  const rows = Array.isArray(req.body?.products) ? req.body.products : [];
  const duplicateMode = req.body?.duplicateMode === 'update' ? 'update' : 'skip';
  if (!rows.length) return res.status(400).json({ error: 'At least one product is required' });
  const results = [];
  const validRows = [];
  const seenSkus = new Set();
  for (const entry of rows) {
    const row = Number(entry?.row || 0);
    const product = entry?.product && typeof entry.product === 'object' ? entry.product : entry;
    const sku = String(product?.sku || product?.code || '').trim();
    const name = String(product?.name || '').trim();
    const categoryId = Number(product?.categoryId);
    const priceText = String(product?.price ?? '').trim();
    const stockText = String(product?.stock ?? '').trim();
    const price = Number(priceText);
    const stock = Number(stockText);
    const errors = [];
    const normalizedSku = sku.toLowerCase();
    if (!sku) errors.push('Missing SKU');
    if (seenSkus.has(normalizedSku)) errors.push('Duplicate SKU in this file');
    if (sku) seenSkus.add(normalizedSku);
    if (!name) errors.push('Missing product name');
    if (!Number.isInteger(categoryId) || categoryId <= 0) errors.push('Invalid category');
    if (!priceText || !Number.isFinite(price) || price < 0) errors.push('Invalid price');
    if (!stockText || !Number.isInteger(stock) || stock < 0) errors.push('Invalid stock');
    const discount = Number(product?.discount ?? 0);
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) errors.push('Invalid discount');
    const status = String(product?.status || 'ACTIVE').toUpperCase();
    if (!['ACTIVE', 'INACTIVE', 'ARCHIVED'].includes(status)) errors.push('Invalid status');
    const category = Number.isInteger(categoryId) ? db.prepare("SELECT id FROM categories WHERE id = ? AND status != 'ARCHIVED'").get(categoryId) : null;
    if (!category) errors.push('Category not found');
    if (errors.length) {
      results.push({ row, sku, status: 'failed', reason: errors.join('; ') });
      continue;
    }
    validRows.push({ row, sku, name, categoryId, price, stock, discount, status, product });
  }
  try {
    db.exec('BEGIN IMMEDIATE');
    const timestamp = now();
    const findProduct = db.prepare('SELECT * FROM products WHERE LOWER(sku) = LOWER(?) LIMIT 1');
    const insertProduct = db.prepare('INSERT INTO products (sku,name,slug,category_id,brand_id,product_type_id,description,details,price,mrp,discount,stock,unit,image_url,image_urls_json,attributes_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const updateProduct = db.prepare('UPDATE products SET name = ?, category_id = ?, brand_id = ?, product_type_id = ?, description = ?, details = ?, price = ?, mrp = ?, discount = ?, stock = ?, unit = ?, image_url = ?, image_urls_json = ?, attributes_json = ?, status = ?, updated_at = ? WHERE id = ?');
    for (const item of validRows) {
      const existing = findProduct.get(item.sku);
      if (existing && duplicateMode === 'skip') {
        results.push({ row: item.row, sku: item.sku, status: 'skipped', reason: 'SKU already exists' });
        continue;
      }
      const product = item.product;
      const brandName = String(product.brand || '').trim();
      const brand = brandName ? db.prepare('SELECT id FROM brands WHERE LOWER(name) = LOWER(?) LIMIT 1').get(brandName) : null;
      const productTypeName = String(product.productType || product.details || '').trim();
      let resolvedBrand = brand;
      if (brandName && !resolvedBrand) {
        try {
          const brandResult = db.prepare('INSERT INTO brands (name,slug,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(brandName, slugify(brandName), '', 'ACTIVE', timestamp, timestamp);
          resolvedBrand = db.prepare('SELECT id FROM brands WHERE id = ?').get(brandResult.lastInsertRowid);
        } catch (error) {
          if (!String(error?.message || '').match(/UNIQUE|duplicate/i)) throw error;
          resolvedBrand = db.prepare('SELECT id FROM brands WHERE LOWER(name) = LOWER(?) LIMIT 1').get(brandName);
        }
      }
      let resolvedProductType = productTypeName ? db.prepare('SELECT id FROM product_types WHERE category_id = ? AND LOWER(name) = LOWER(?) LIMIT 1').get(item.categoryId, productTypeName) : null;
      if (productTypeName && !resolvedProductType) {
        try {
          const typeResult = db.prepare('INSERT INTO product_types (category_id,name,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(item.categoryId, productTypeName, 'ACTIVE', 0, timestamp, timestamp);
          resolvedProductType = db.prepare('SELECT id FROM product_types WHERE id = ?').get(typeResult.lastInsertRowid);
        } catch (error) {
          if (!String(error?.message || '').match(/UNIQUE|duplicate/i)) throw error;
          resolvedProductType = db.prepare('SELECT id FROM product_types WHERE category_id = ? AND LOWER(name) = LOWER(?) LIMIT 1').get(item.categoryId, productTypeName);
        }
      }
      const values = [item.name, item.categoryId, resolvedBrand?.id || null, resolvedProductType?.id || null, String(product.description || ''), String(product.details || ''), item.price, Number(product.mrp || item.price), item.discount, item.stock, String(product.unit || 'Nos'), product.imageUrl || product.image || null, JSON.stringify(Array.isArray(product.imageUrls) ? product.imageUrls : []), JSON.stringify(product.attributes || {}), item.status];
      const insertValues = values.slice(1);
      if (existing) {
        updateProduct.run(...values, timestamp, existing.id);
        results.push({ row: item.row, sku: item.sku, status: 'updated', productId: Number(existing.id) });
      } else {
        insertProduct.run(item.sku, item.name, slugify(`${item.name}-${item.sku}`), ...insertValues, timestamp, timestamp);
        results.push({ row: item.row, sku: item.sku, status: 'imported' });
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* transaction already closed */ }
    console.error('[api/products/bulk-import]', error && error.stack ? error.stack : error);
    return res.status(500).json({ error: 'Unable to persist imported products' });
  }
  const imported = results.filter((result) => result.status === 'imported' || result.status === 'updated').length;
  const skipped = results.filter((result) => result.status === 'skipped').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  res.json({ success: true, total: rows.length, imported, skipped, failed, results });
});
app.post('/api/products', auth, admin, (req, res) => { const body = req.body || {}; const sku = String(body.sku || '').trim(); const name = String(body.name || '').trim(); const categoryId = Number(body.categoryId); const price = Number(body.price); const stock = normalizeStockValue(body.stock); if (!sku || !name || !categoryId || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0) return res.status(400).json({ error: 'SKU, product name, category, valid price and stock are required' }); const timestamp = now(); try { const brandId = body.brandId || db.prepare('SELECT id FROM brands WHERE name = ? COLLATE NOCASE').get(String(body.brand || '').trim())?.id || null; const result = db.prepare('INSERT INTO products (sku,name,slug,category_id,brand_id,product_type_id,description,details,price,mrp,discount,stock,unit,image_url,image_urls_json,attributes_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(sku, name, slugify(`${name}-${sku}`), categoryId, brandId, body.productTypeId || null, body.description || '', body.details || '', price, Number(body.mrp || price), Number(body.discount || 0), stock, body.unit || 'Nos', body.imageUrl || null, JSON.stringify(body.imageUrls || []), JSON.stringify(body.attributes || {}), body.status || 'ACTIVE', timestamp, timestamp); const product = mapProduct(db.prepare(`${productSelect} WHERE p.id = ?`).get(result.lastInsertRowid)); if (!product) return res.status(500).json({ error: 'Product persisted but could not be loaded' }); res.status(201).json(product); } catch (error) { res.status(error.message.includes('UNIQUE') ? 409 : 400).json({ error: error.message.includes('UNIQUE') ? 'SKU already exists' : 'Unable to create product' }); } });
app.patch('/api/products/:id', auth, admin, (req, res) => { const body = req.body || {}; const id = Number(req.params.id); const current = db.prepare('SELECT * FROM products WHERE id = ?').get(id); if (!current) return res.status(404).json({ error: 'Product not found' }); const stockOnly = Object.prototype.hasOwnProperty.call(body, 'stock') && Object.keys(body).every((key) => key === 'stock'); if (stockOnly) { const rawStock = String(body.stock ?? '').trim(); const stock = Number(rawStock); if (!rawStock || !Number.isInteger(stock) || !Number.isFinite(stock) || stock < 0) return res.status(400).json({ error: 'Invalid stock value' }); try { db.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?').run(stock, now(), id); const product = mapProduct(db.prepare(`${productSelect} WHERE p.id = ?`).get(id)); if (!product) return res.status(500).json({ error: 'Product updated but could not be reloaded' }); return res.json(product); } catch { return res.status(400).json({ error: 'Unable to update product stock' }); } } const values = { name: body.name == null ? current.name : String(body.name).trim(), categoryId: body.categoryId == null ? current.category_id : Number(body.categoryId), price: body.price == null ? current.price : Number(body.price), stock: body.stock == null ? current.stock : normalizeStockValue(body.stock) }; if (!values.name || !values.categoryId || !Number.isFinite(values.price) || values.price < 0 || !Number.isInteger(values.stock) || values.stock < 0) return res.status(400).json({ error: 'Invalid product data' }); const timestamp = now(); try { const brandId = body.brandId || db.prepare('SELECT id FROM brands WHERE name = ? COLLATE NOCASE').get(String(body.brand || '').trim())?.id || current.brand_id; db.prepare('UPDATE products SET name = ?, category_id = ?, brand_id = ?, product_type_id = ?, description = ?, details = ?, price = ?, mrp = ?, discount = ?, stock = ?, unit = ?, image_url = ?, image_urls_json = ?, attributes_json = ?, status = ?, updated_at = ? WHERE id = ?').run(values.name, values.categoryId, brandId, body.productTypeId ?? current.product_type_id, body.description ?? current.description, body.details ?? current.details, values.price, body.mrp ?? current.mrp, body.discount ?? current.discount, values.stock, body.unit ?? current.unit, body.imageUrl ?? current.image_url, JSON.stringify(body.imageUrls ?? safeJson(current.image_urls_json, [])), JSON.stringify(body.attributes ?? safeJson(current.attributes_json, {})), body.status ?? current.status, timestamp, id); const product = mapProduct(db.prepare(`${productSelect} WHERE p.id = ?`).get(id)); if (!product) return res.status(500).json({ error: 'Product updated but could not be reloaded' }); res.json(product); } catch { res.status(400).json({ error: 'Unable to update product' }); } });
app.patch('/api/products/:id/archive', auth, admin, (req, res) => { const result = db.prepare("UPDATE products SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now(), Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Product not found' }); res.status(204).end(); });
app.post('/api/images', auth, admin, upload.single('image'), (req, res) => { if (!req.file) return res.status(400).json({ error: 'Image is required' }); const safeName = path.basename(req.file.originalname || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_'); const safePath = path.join(uploadDirectory, `${Date.now()}-${safeName}`); fs.renameSync(req.file.path, safePath); res.status(201).json({ url: `/uploads/${path.basename(safePath)}` }); });
app.get('/api/admin/stats', auth, admin, (_req, res) => { const count = (sql) => db.prepare(sql).get().count; res.json({ products: count("SELECT COUNT(*) count FROM products WHERE status != 'ARCHIVED'"), categories: count("SELECT COUNT(*) count FROM categories WHERE status != 'ARCHIVED'"), brands: count("SELECT COUNT(*) count FROM brands WHERE status != 'ARCHIVED'"), customers: count("SELECT COUNT(*) count FROM users WHERE role = 'CUSTOMER'"), orders: count('SELECT COUNT(*) count FROM orders'), revenue: Number(db.prepare('SELECT COALESCE(SUM(total), 0) total FROM orders').get().total || 0) }); });
app.get('/api/admin/products', auth, admin, (req, res) => { const page = Math.max(1, Number(req.query.page || 1)); const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50))); const rows = db.prepare(`${productSelect} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`).all(limit, (page - 1) * limit).map(mapProduct); const total = db.prepare('SELECT COUNT(*) count FROM products').get().count; res.json({ data: rows, page, limit, total, pages: Math.ceil(total / limit) }); });
app.get('/api/admin/settings', auth, admin, (_req, res) => { const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((item) => [item.key, item.value])); res.json({ businessName: settings.businessName || 'Murugesan Electrical and Hardwares', phone: settings.phone || '9361866771', gstin: settings.gstin || '', address: settings.address || '', logo: settings.logo || '' }); });
app.patch('/api/admin/settings', auth, admin, (req, res) => { const body = req.body || {}; const values = [
    ['businessName', String(body.businessName ?? body.business_name ?? '').trim()],
    ['phone', String(body.phone ?? '').trim()],
    ['gstin', String(body.gstin ?? body.gst_number ?? '').trim()],
    ['address', String(body.address ?? '').trim()],
    ['logo', String(body.logo ?? '').trim()],
  ];
  db.exec('BEGIN');
  try {
    for (const [key, value] of values) {
      if (!key) continue;
      const existing = db.prepare('SELECT id FROM settings WHERE key = ?').get(key);
      if (existing) {
        db.prepare('UPDATE settings SET value = ?, updated_at = ? WHERE id = ?').run(value, now(), existing.id);
      } else {
        db.prepare('INSERT INTO settings (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)').run(key, value, now(), now());
      }
    }
    db.exec('COMMIT');
    res.json({ ok: true, settings: Object.fromEntries(values) });
  } catch (error) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: 'Unable to update settings' });
  }
});
app.use(express.static(path.join(root, 'dist')));
app.use((req, res, next) => { if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next(); res.sendFile(path.join(root, 'dist', 'index.html')); });
app.use((error, _req, res, _next) => {
  console.error('UNEXPECTED_SERVER_ERROR');
  console.error(error && error.stack ? error.stack : error);
  res.status(500).json({ error: 'Unexpected server error' });
});
app.listen(port, () => console.log(`Catalog API listening on http://localhost:${port}`));
