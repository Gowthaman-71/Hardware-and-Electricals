const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { imageSize } = require('image-size');
const { DatabaseSync } = require('node:sqlite');
const { createPgCompatDatabase } = require('./postgresCompat.cjs');
const security = require('./security.cjs');
const { createStorage } = require('./storage.cjs');

// Simple in-memory cache with TTL for static data (categories, brands, product types)
class SimpleCache {
  constructor(ttlSeconds = 300) {
    this.cache = new Map();
    this.ttl = ttlSeconds * 1000;
  }
  
  set(key, value) {
    this.cache.set(key, { value, expires: Date.now() + this.ttl });
  }
  
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }
  
  clear() {
    this.cache.clear();
  }
  
  delete(key) {
    this.cache.delete(key);
  }
}

const staticDataCache = new SimpleCache(300); // 5 minute cache for categories, brands, product types

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

// CDN Configuration for image storage
const cdnBaseUrl = process.env.CDN_BASE_URL || null; // e.g., https://your-bucket.s3.amazonaws.com/uploads/
const useCdn = cdnBaseUrl && cdnBaseUrl.trim() !== '';

// Helper function to convert local file paths to CDN URLs
function getImageUrl(imagePath) {
  if (!imagePath) return null;
  if (useCdn && imagePath.startsWith('/uploads/')) {
    // Convert local path to CDN URL
    const filename = imagePath.replace('/uploads/', '');
    return `${cdnBaseUrl}${filename}`;
  }
  if (useCdn && !imagePath.startsWith('http')) {
    // Assume it's a relative path
    return `${cdnBaseUrl}${imagePath}`;
  }
  // Return original path (local or already absolute URL)
  return imagePath;
}

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
const imageStorage = createStorage({ directory: resolvedUploadDirectory });

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
      product_type_id INTEGER REFERENCES product_types(id) ON DELETE RESTRICT,
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
      stock_restored BOOLEAN NOT NULL DEFAULT FALSE,
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
    `ALTER TABLE attributes ADD COLUMN IF NOT EXISTS product_type_id INTEGER REFERENCES product_types(id) ON DELETE RESTRICT`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_restored BOOLEAN NOT NULL DEFAULT FALSE`,
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
const ownerWhatsappNumberRaw = String(process.env.OWNER_WHATSAPP_NUMBER || process.env.WHATSAPP_OWNER_NUMBER || '').trim();
if (isProduction && !ownerWhatsappNumberRaw) {
  throw new Error('OWNER_WHATSAPP_NUMBER is required in production.');
}
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
const catalogStatuses = new Set(['ACTIVE', 'INACTIVE', 'ARCHIVED']);
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
    const itemTotal = formatCurrency(price.replace(/[₹,]/g, '') * quantity);
    return `- ${name} x${quantity} @ ${price} = ${itemTotal}`;
  }).join('\n');
  const gst = String(order.gst_number || '').trim();
  const subtotal = formatCurrency(order.subtotal || 0);
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
    `Subtotal: ${subtotal}`,
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
    const result = insert.run(order.id, order.customer_id, type, 'WHATSAPP', message, '', 'FAILED', timestamp);
    db.prepare('UPDATE order_notifications SET error_message = ? WHERE id = ?').run('WhatsApp recipient is missing', result.lastInsertRowid);
    return { notificationId: Number(result.lastInsertRowid), whatsappUrl: '', destination: '' };
  }
  const whatsappUrl = buildWhatsAppUrl(destination, message);
  const result = insert.run(order.id, order.customer_id, type, 'WHATSAPP', message, destination, 'NOT_ATTEMPTED', timestamp);
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
  image: getImageUrl(row.image_url) || '',
  imageUrl: getImageUrl(row.image_url) || null,
  description: row.description || '',
  status: row.status || 'ACTIVE',
  sortOrder: Number(row.sort_order || 0),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  attributes: Array.isArray(attributes) ? attributes.map(mapAttribute) : [],
  active: row.status === 'ACTIVE',
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
  code: String(row.sku || ''),
  sku: String(row.sku || ''),
  name: String(row.name || ''),
  slug: String(row.slug || ''),
  category: String(row.category_name || ''),
  categoryId: Number(row.category_id || 0),
  categorySlug: String(row.category_slug || ''),
  brand: String(row.brand_name || ''),
  brandId: row.brand_id == null ? null : Number(row.brand_id),
  productType: String(row.product_type_name || ''),
  productTypeId: row.product_type_id == null ? null : Number(row.product_type_id),
  unit: String(row.unit || 'Nos'),
  price: Number(row.price || 0),
  mrp: Number(row.mrp || row.price || 0),
  discount: Number(row.discount || 0),
  stock: Number(row.stock || 0),
  description: row.description || '',
  details: row.details || '',
  image: getImageUrl(row.image_url) || '',
  imageUrl: getImageUrl(row.image_url) || null,
  status: row.status || 'ACTIVE',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  attributes: safeJson(row.attributes_json, {}),
  imageUrls: safeJson(row.image_urls_json, []).map(img => getImageUrl(img)),
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
  ensureColumn('attributes', 'product_type_id', 'product_type_id INTEGER REFERENCES product_types(id) ON DELETE CASCADE');
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
    ensureColumn('orders', 'stock_restored', 'stock_restored INTEGER DEFAULT 0');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_mobile_number ON users(mobile_number) WHERE mobile_number IS NOT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number) WHERE order_number IS NOT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL');
  
  // Add performance indexes for large catalogs
  db.exec('CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_products_category_status ON products(category_id, status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_products_brand_status ON products(brand_id, status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_products_status_stock ON products(status, stock)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_products_search ON products(name COLLATE NOCASE, sku COLLATE NOCASE)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_categories_status_order ON categories(status, sort_order)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_brands_status ON brands(status)');
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
  
  // Update CHECK constraint to include REJECTED status
  try {
    // Check if we can insert a row with REJECTED status
    const testResult = db.prepare("INSERT INTO orders (order_number,customer_id,customer_name,customer_email,customer_phone,items_json,subtotal,delivery_charge,total,status,payment_method,payment_status,delivery_address_json,created_at,updated_at) VALUES ('TEST-REJECTED-CONSTRAINT',1,'Test','test@test.com','1234567890','[]',0,0,0,'REJECTED','Cash on Delivery','PENDING','{}',datetime('now'),datetime('now'))").run();
    // If successful, delete the test row
    db.prepare("DELETE FROM orders WHERE order_number = 'TEST-REJECTED-CONSTRAINT'").run();
  } catch (error) {
    // If constraint fails, we need to recreate the table
    if (String(error.message).includes('CHECK constraint')) {
      console.log('[Migration] Updating orders table CHECK constraint to include REJECTED status');
      try {
        db.exec(`
          CREATE TABLE IF NOT EXISTS orders_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_number TEXT NOT NULL UNIQUE,
            customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            customer_name TEXT NOT NULL,
            customer_email TEXT NOT NULL DEFAULT '',
            customer_phone TEXT NOT NULL,
            gst_number TEXT,
            items_json TEXT NOT NULL DEFAULT '[]',
            subtotal REAL NOT NULL DEFAULT 0,
            delivery_charge REAL NOT NULL DEFAULT 0,
            total REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'PROCESSING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED')),
            payment_method TEXT NOT NULL DEFAULT 'Cash on Delivery',
            payment_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED')),
            delivery_address_json TEXT NOT NULL,
            notification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (notification_status IN ('PENDING', 'PREPARED', 'SENT', 'FAILED')),
            notification_sent_at TEXT,
            notification_message_id TEXT,
            stock_restored INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `);
        db.exec(`
          INSERT INTO orders_new 
          SELECT * FROM orders
        `);
        db.exec('DROP TABLE orders');
        db.exec('ALTER TABLE orders_new RENAME TO orders');
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number) WHERE order_number IS NOT NULL');
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL');
        db.exec('CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id, created_at DESC)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC)');
        console.log('[Migration] Orders table CHECK constraint updated successfully');
      } catch (migrationError) {
        console.log('[Migration] Orders table constraint update failed:', migrationError.message);
      }
    }
  }
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

// Security: Apply security headers to all responses
app.use(security.securityHeaders);

// Security: CORS configuration with explicit origins
const corsOptions = security.getCorsOptions(isProduction);
app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use((req, _res, next) => {
  if (req.body == null || typeof req.body !== 'object') {
    req.body = {};
  }
  next();
});
app.use(security.apiRateLimit);
app.use((req, _res, next) => {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && /\/api\/(categories|brands|product-types)(\/|$)/.test(req.path)) {
    staticDataCache.clear();
  }
  next();
});
app.use('/uploads', express.static(uploadDirectory));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const mobilePattern = /^[6-9]\d{9}$/;
const gstNumberPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z0-9]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$/;
const normalizeGstNumber = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
const isValidGstNumber = (value) => {
  const normalized = normalizeGstNumber(value);
  return !normalized || gstNumberPattern.test(normalized);
};
const auth = security.createAuthMiddleware(jwtSecret, (userId) => db.prepare('SELECT id, role, status FROM users WHERE id = ?').get(Number(userId)));
const admin = security.requireAdmin;
const customer = security.requireCustomer;
app.get('/api/health', (_req, res) => res.json({ ok: true, database: isProduction ? 'postgresql' : 'sqlite', environment: process.env.NODE_ENV || 'development', productionDatabaseConfigured: Boolean(productionDatabaseUrl) }));

// Security: Rate limit authentication endpoints
app.post('/api/auth/login', security.authRateLimit, (req, res) => { const rawIdentifier = String(req.body.mobile ?? req.body.email ?? req.body.username ?? '').trim(); const password = String(req.body.password || ''); const normalizedMobile = normalizeMobile(rawIdentifier); const email = rawIdentifier.includes('@') ? rawIdentifier.toLowerCase() : ''; if ((!mobilePattern.test(normalizedMobile) && !email) || !password) return res.status(400).json({ error: 'Invalid mobile number or password.' }); const user = db.prepare("SELECT * FROM users WHERE status = 'ACTIVE' AND ((mobile_number = ? AND mobile_number IS NOT NULL) OR email = ?) LIMIT 1").get(normalizedMobile || null, email || null); if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid mobile number or password.' }); db.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), user.id); const token = jwt.sign({ id: user.id, role: user.role, email: user.email, mobile: user.mobile_number }, jwtSecret, { expiresIn: '8h' }); res.json({ token, user: { id: user.id, name: user.name, email: user.email, mobile: user.mobile_number, role: user.role } }); });
// Security: Rate limit registration endpoint
app.post('/api/auth/register', security.registerRateLimit, (req, res) => {
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
    
    // Restore stock when cancelling or rejecting (only if not already restored)
    if ((requestedStatus === 'CANCELLED' || requestedStatus === 'REJECTED') && Number(order.stock_restored) === 0) {
      const items = safeJson(order.items_json, []);
      for (const item of items) {
        const quantity = Number(item.quantity || 0);
        const productId = Number(item.productId || item.product_id || 0);
        if (quantity > 0 && productId > 0) {
          db.prepare('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?').run(quantity, timestamp, productId);
        }
      }
      db.prepare('UPDATE orders SET stock_restored = 1 WHERE id = ?').run(orderId);
    }
    
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
  const idempotencyKey = String(body.idempotencyKey || '').trim();
  if (!idempotencyKey || idempotencyKey.length > 128) {
    return res.status(400).json({ error: 'A unique checkout idempotency key is required' });
  }
  const existing = db.prepare('SELECT * FROM orders WHERE idempotency_key = ? AND customer_id = ?').get(idempotencyKey, req.user.id);
  if (existing) {
    const existingOwnerMsg = buildOwnerOrderNotificationMessage(existing);
    const existingWhatsappUrl = buildWhatsAppUrl(ownerWhatsappNumber, existingOwnerMsg);
    return res.status(200).json({ success: true, order: mapOrder(existing), whatsappUrl: existingWhatsappUrl });
  }

  let transactionCommitted = false;
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
    const orderNumber = `MH-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

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
    transactionCommitted = true;
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const ownerMsg = buildOwnerOrderNotificationMessage(order);
    let ownerNotification;
    try {
      ownerNotification = await createOrderNotification({
        order,
        type: 'NEW_ORDER_OWNER',
        recipient: ownerWhatsappNumber,
        status: 'PENDING',
      });
    } catch (notificationError) {
      console.error('[api/orders] notification preparation failed', notificationError);
      db.prepare('UPDATE orders SET notification_status = ?, updated_at = ? WHERE id = ?').run('FAILED', now(), orderId);
      ownerNotification = { notificationId: null, whatsappUrl: '' };
    }
    if (ownerNotification.notificationId) {
      db.prepare('UPDATE orders SET notification_status = ? WHERE id = ?').run('PREPARED', orderId);
    }
    const whatsappUrl = ownerNotification.whatsappUrl || buildWhatsAppUrl(ownerWhatsappNumber, ownerMsg);
    res.status(201).json({ success: true, order: mapOrder(order), whatsappUrl, notificationId: ownerNotification.notificationId });
  } catch (error) {
    if (!transactionCommitted) {
      try { db.exec('ROLLBACK'); } catch (rollbackError) {
        console.error('[api/orders] rollback failed', rollbackError);
      }
    }
    if (String(error.message).includes('UNIQUE')) {
      const existingDuplicate = db.prepare('SELECT * FROM orders WHERE idempotency_key = ? AND customer_id = ?').get(idempotencyKey, req.user.id);
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

// Update notification status (OPENED, FAILED)
app.patch('/api/notifications/:id/status', auth, (req, res) => {
  const notificationId = Number(req.params.id);
  const { status } = req.body || {};
  
  if (!notificationId) return res.status(400).json({ error: 'Notification ID required' });
  if (!status || !['NOT_ATTEMPTED', 'OPENED', 'FAILED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be NOT_ATTEMPTED, OPENED, or FAILED' });
  }
  
  const notification = db.prepare('SELECT * FROM order_notifications WHERE id = ?').get(notificationId);
  if (!notification) return res.status(404).json({ error: 'Notification not found' });
  
  // Only allow customer to update their own notifications
  if (notification.customer_id !== req.user.id && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  db.prepare('UPDATE order_notifications SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), notificationId);
  
  res.json({ success: true, status });
});
app.get('/api/catalog', (req, res) => { 
  const categories = db.prepare("SELECT * FROM categories WHERE status = 'ACTIVE' ORDER BY sort_order, name").all().map(mapCategory);
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 24)));
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
  
  const filters = ["p.status = 'ACTIVE'"];
  const params = [];
  
  if (categoryId) {
    filters.push('p.category_id = ?');
    params.push(categoryId);
  }
  
  const where = ` WHERE ${filters.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) count FROM products p${where}`).get(...params).count;
  const products = db.prepare(`${productSelect}${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit).map(mapProduct);
  
  res.json({ categories, products, page, limit, total, pages: Math.ceil(total / limit) });
});

// Customer-facing search — used when catalog is large (>200 products) or for accurate results
app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 48)));

  const filters = ["p.status = 'ACTIVE'"];
  const params = [];

  if (q) {
    filters.push(`(
      p.name LIKE ? COLLATE NOCASE
      OR p.sku LIKE ? COLLATE NOCASE
      OR b.name LIKE ? COLLATE NOCASE
      OR c.name LIKE ? COLLATE NOCASE
      OR p.description LIKE ? COLLATE NOCASE
    )`);
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }

  if (categoryId) {
    filters.push('p.category_id = ?');
    params.push(categoryId);
  }

  const where = ` WHERE ${filters.join(' AND ')}`;

  const total = db.prepare(
    `SELECT COUNT(*) count FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN brands b ON b.id = p.brand_id${where}`
  ).get(...params).count;

  const rows = db.prepare(
    `${productSelect}${where} ORDER BY p.name ASC LIMIT ? OFFSET ?`
  ).all(...params, limit, (page - 1) * limit).map(mapProduct);

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit), query: q });
});

// Validate a list of product IDs and return current stock/price — used by checkout
app.post('/api/products/validate', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'ids required' });
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `${productSelect} WHERE p.id IN (${placeholders}) AND p.status = 'ACTIVE'`
  ).all(...ids).map(mapProduct);
  res.json(rows);
});
app.get('/api/categories', (_req, res) => {
  const cacheKey = 'categories:all';
  const cached = staticDataCache.get(cacheKey);
  if (cached) {
    return res.json(cached);
  }
  
  const rows = db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all();
  const categories = rows.map((row) => {
    const attributes = db.prepare('SELECT * FROM attributes WHERE category_id = ? ORDER BY sort_order, name').all(row.id);
    return mapCategory(row, attributes);
  });
  staticDataCache.set(cacheKey, categories);
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
  const existing = db.prepare('SELECT id, name FROM attributes WHERE category_id = ? AND product_type_id IS NULL').all(categoryId);
  const existingByName = new Map(existing.map((row) => [String(row.name).trim().toLowerCase(), row]));
  const nextIds = new Set();

  for (const attribute of attributeRows) {
    const normalizedType = allowedType.has(attribute.type) ? attribute.type : 'Text';
    const key = attribute.name.trim().toLowerCase();
    const current = existingByName.get(key);
    const valuesJson = JSON.stringify(attribute.values);
    if (current) {
      db.prepare('UPDATE attributes SET name = ?, type = ?, options_json = ?, updated_at = ? WHERE id = ? AND category_id = ? AND product_type_id IS NULL').run(attribute.name, normalizedType, valuesJson, now(), current.id, categoryId);
      nextIds.add(Number(current.id));
    } else {
      const result = db.prepare('INSERT INTO attributes (category_id, product_type_id, name, type, required, filterable, searchable, options_json, status, sort_order, created_at, updated_at) VALUES (?, NULL, ?, ?, 0, 0, 0, ?, ?, 0, ?, ?)').run(categoryId, attribute.name, normalizedType, valuesJson, 'ACTIVE', now(), now());
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
  if (!catalogStatuses.has(body.status || 'ACTIVE')) return res.status(400).json({ error: 'Invalid category status' });
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
  if (body.status != null && !catalogStatuses.has(body.status)) return res.status(400).json({ error: 'Invalid category status' });
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
app.patch('/api/categories/:id/archive', auth, admin, (req, res) => { 
  const id = Number(req.params.id); 
  const reassignToCategoryId = req.body?.reassignToCategoryId ? Number(req.body.reassignToCategoryId) : null;
  
  const productCount = db.prepare('SELECT COUNT(*) count FROM products WHERE category_id = ?').get(id).count;
  
  if (productCount > 0) {
    // If reassignment category provided, move products
    if (reassignToCategoryId) {
      const targetCategory = db.prepare("SELECT id, status FROM categories WHERE id = ?").get(reassignToCategoryId);
      
      if (!targetCategory) {
        return res.status(400).json({ error: 'Target category not found' });
      }
      
      if (targetCategory.status === 'ARCHIVED') {
        return res.status(400).json({ error: 'Cannot reassign to archived category' });
      }
      
      if (targetCategory.id === id) {
        return res.status(400).json({ error: 'Cannot reassign to same category' });
      }

      const incompatibleTypes = db.prepare('SELECT COUNT(*) count FROM products p WHERE p.category_id = ? AND p.product_type_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM product_types pt WHERE pt.id = p.product_type_id AND pt.category_id = ?)').get(id, reassignToCategoryId).count;
      if (Number(incompatibleTypes) > 0) {
        return res.status(409).json({ error: 'Products with category-specific product types must be reassigned to valid product types first' });
      }
      
      db.exec('BEGIN IMMEDIATE');
      try {
        // Move all products to new category
        db.prepare('UPDATE products SET category_id = ?, updated_at = ? WHERE category_id = ?').run(
          reassignToCategoryId,
          now(),
          id
        );
        
        // Archive the category
        db.prepare("UPDATE categories SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now(), id);
        
        db.exec('COMMIT');
        
        return res.json({ 
          archived: true, 
          productCount, 
          reassigned: true,
          targetCategoryId: reassignToCategoryId,
          message: `Category archived. ${productCount} product${productCount === 1 ? '' : 's'} moved to new category.` 
        });
      } catch (error) {
        db.exec('ROLLBACK');
        console.error('[api/categories/:id/archive]', error);
        return res.status(500).json({ error: 'Unable to reassign products and archive category' });
      }
    }
    
    // No reassignment - just archive (products remain)
    const result = db.prepare("UPDATE categories SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now(), id); 
    if (!result.changes) return res.status(404).json({ error: 'Category not found' }); 
    return res.json({ 
      archived: true, 
      productCount, 
      reassigned: false,
      message: 'Category archived and removed from the public catalog.' 
    }); 
  } 
  
  // No products - safe to delete
  const result = db.prepare('DELETE FROM categories WHERE id = ?').run(id); 
  if (!result.changes) return res.status(404).json({ error: 'Category not found' }); 
  res.json({ deleted: true, message: 'Category deleted because it has no remaining products.' }); 
});
app.patch('/api/categories/:id/restore', auth, admin, (req, res) => { const result = db.prepare("UPDATE categories SET status = 'ACTIVE', updated_at = ? WHERE id = ?").run(now(), Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Category not found' }); res.json({ restored: true }); });
app.get('/api/brands', (_req, res) => {
  const search = String(_req.query.search || '').trim();
  const includeArchived = String(_req.query.includeArchived || 'false') === 'true';
  
  // Only cache when no search and no archived filter
  if (!search && !includeArchived) {
    const cacheKey = 'brands:active';
    const cached = staticDataCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }
  }
  
  let query = 'SELECT b.*, COUNT(DISTINCT p.id) as product_count FROM brands b LEFT JOIN products p ON p.brand_id = b.id AND p.status != ? GROUP BY b.id';
  const params = ['ARCHIVED'];
  
  if (!includeArchived) {
    query += " HAVING b.status != ?";
    params.push('ARCHIVED');
  }
  
  if (search) {
    query = query.replace('GROUP BY', 'WHERE LOWER(b.name) LIKE ? GROUP BY');
    params.splice(1, 0, `%${search.toLowerCase()}%`);
  }
  
  query += ' ORDER BY b.name';
  
  const brands = db.prepare(query).all(...params).map(row => ({
    ...mapBrand(row),
    productCount: Number(row.product_count || 0)
  }));
  
  // Cache only when no search and no archived filter
  if (!search && !includeArchived) {
    staticDataCache.set('brands:active', brands);
  }
  
  res.json(brands);
});
app.post('/api/brands', auth, admin, (req, res) => { const body = req.body || {}; const timestamp = now(); if (!catalogStatuses.has(body.status || 'ACTIVE')) return res.status(400).json({ error: 'Invalid brand status' }); try { const result = db.prepare('INSERT INTO brands (name,slug,logo_url,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(String(body.name).trim(), slugify(body.slug || body.name), body.logoUrl || null, body.description || '', body.status || 'ACTIVE', timestamp, timestamp); res.status(201).json(mapBrand(db.prepare('SELECT * FROM brands WHERE id = ?').get(result.lastInsertRowid))); } catch (error) { res.status(400).json({ error: error.message.includes('UNIQUE') ? 'Brand slug already exists' : 'Unable to create brand' }); } });
app.patch('/api/brands/:id', auth, admin, (req, res) => { const body = req.body || {}; const timestamp = now(); if (body.status != null && !catalogStatuses.has(body.status)) return res.status(400).json({ error: 'Invalid brand status' }); try { const result = db.prepare('UPDATE brands SET name = COALESCE(?, name), logo_url = COALESCE(?, logo_url), description = COALESCE(?, description), status = COALESCE(?, status), updated_at = ? WHERE id = ?').run(body.name ?? null, body.logoUrl ?? null, body.description ?? null, body.status ?? null, timestamp, Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Brand not found' }); res.json(mapBrand(db.prepare('SELECT * FROM brands WHERE id = ?').get(Number(req.params.id)))); } catch { res.status(400).json({ error: 'Unable to update brand' }); } });
app.patch('/api/brands/:id/archive', auth, admin, (req, res) => { const id = Number(req.params.id); const productCount = db.prepare("SELECT COUNT(*) count FROM products WHERE brand_id = ? AND status != 'ARCHIVED'").get(id).count; if (productCount > 0) { const result = db.prepare("UPDATE brands SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now(), id); if (!result.changes) return res.status(404).json({ error: 'Brand not found' }); return res.json({ archived: true, productCount, message: 'Brand archived and removed from active catalog listings.' }); } const result = db.prepare('DELETE FROM brands WHERE id = ?').run(id); if (!result.changes) return res.status(404).json({ error: 'Brand not found' }); res.json({ deleted: true, message: 'Brand deleted because it has no remaining products.' }); });
app.patch('/api/brands/:id/restore', auth, admin, (req, res) => { const result = db.prepare("UPDATE brands SET status = 'ACTIVE', updated_at = ? WHERE id = ?").run(now(), Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Brand not found' }); res.json({ restored: true }); });
app.get('/api/product-types', (req, res) => { 
  const categoryId = Number(req.query.categoryId || 0); 
  const includeArchived = String(req.query.includeArchived || 'false') === 'true';
  
  // Only cache when no category filter and no archived filter
  if (!categoryId && !includeArchived) {
    const cacheKey = 'product-types:all';
    const cached = staticDataCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }
  }
  
  let query = categoryId 
    ? 'SELECT pt.*, COUNT(DISTINCT p.id) as product_count FROM product_types pt LEFT JOIN products p ON p.product_type_id = pt.id AND p.status != ? WHERE pt.category_id = ?' 
    : 'SELECT pt.*, COUNT(DISTINCT p.id) as product_count FROM product_types pt LEFT JOIN products p ON p.product_type_id = pt.id AND p.status != ?';
  
  const params = ['ARCHIVED'];
  if (categoryId) params.push(categoryId);
  
  query += ' GROUP BY pt.id';
  
  if (!includeArchived) {
    query += " HAVING pt.status != 'ARCHIVED'";
  }
  
  query += ' ORDER BY pt.category_id, pt.sort_order, pt.name';
  
  const rows = db.prepare(query).all(...params).map(row => ({
    ...mapProductType(row),
    productCount: Number(row.product_count || 0)
  }));
  
  // Cache only when no category filter and no archived filter
  if (!categoryId && !includeArchived) {
    staticDataCache.set('product-types:all', rows);
  }
  
  res.json(rows); 
});
app.post('/api/product-types', auth, admin, (req, res) => { 
  const body = req.body || {}; 
  const timestamp = now(); 
  const categoryId = Number(body.categoryId);
  const name = String(body.name || '').trim();
  
  if (!categoryId || !name) {
    return res.status(400).json({ error: 'Category ID and name are required' });
  }
  
  // Validate category exists
  const category = db.prepare('SELECT id, status FROM categories WHERE id = ?').get(categoryId);
  if (!category) {
    return res.status(400).json({ error: 'Category not found' });
  }
  if (category.status !== 'ACTIVE') {
    return res.status(400).json({ error: 'Cannot add product types to an inactive category' });
  }
  
  try { 
    const result = db.prepare('INSERT INTO product_types (category_id,name,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(
      categoryId, name, body.status || 'ACTIVE', Number(body.sortOrder || 0), timestamp, timestamp
    ); 
    res.status(201).json(mapProductType(db.prepare('SELECT * FROM product_types WHERE id = ?').get(result.lastInsertRowid))); 
  } catch (error) { 
    res.status(error.message.includes('UNIQUE') ? 409 : 400).json({ error: error.message.includes('UNIQUE') ? 'A product type with that name already exists in this category' : 'Unable to create product type' }); 
  } 
});
app.patch('/api/product-types/:id/archive', auth, admin, (req, res) => { const id = Number(req.params.id); const productCount = db.prepare("SELECT COUNT(*) count FROM products WHERE product_type_id = ? AND status != 'ARCHIVED'").get(id).count; if (productCount > 0) { const result = db.prepare("UPDATE product_types SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now(), id); if (!result.changes) return res.status(404).json({ error: 'Product type not found' }); return res.json({ archived: true, productCount, message: 'Product type archived and removed from active category workflows.' }); } const result = db.prepare('DELETE FROM product_types WHERE id = ?').run(id); if (!result.changes) return res.status(404).json({ error: 'Product type not found' }); res.json({ deleted: true, message: 'Product type deleted because it has no remaining products.' }); });
app.patch('/api/product-types/:id/restore', auth, admin, (req, res) => { const result = db.prepare("UPDATE product_types SET status = 'ACTIVE', updated_at = ? WHERE id = ?").run(now(), Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Product type not found' }); res.json({ restored: true }); });
app.get('/api/attributes', (req, res) => { 
  const categoryId = Number(req.query.categoryId || 0);
  const productTypeId = Number(req.query.productTypeId || 0);
  let query = 'SELECT * FROM attributes WHERE 1=1';
  const params = [];
  
  if (categoryId) {
    query += ' AND category_id = ?';
    params.push(categoryId);
  }
  
  if (productTypeId) {
    query += ' AND product_type_id = ?';
    params.push(productTypeId);
  }
  
  query += ' ORDER BY category_id, product_type_id, sort_order, name';
  const rows = params.length ? db.prepare(query).all(...params) : db.prepare(query).all();
  res.json(rows.map(mapAttribute)); 
});
app.post('/api/attributes', auth, admin, (req, res) => { 
  const body = req.body || {}; 
  const timestamp = now(); 
  const categoryId = Number(body.categoryId);
  const productTypeId = body.productTypeId ? Number(body.productTypeId) : null;
  
  if (!categoryId) {
    return res.status(400).json({ error: 'Category ID is required' });
  }
  
  if (productTypeId) {
    const productType = db.prepare('SELECT id, category_id FROM product_types WHERE id = ?').get(productTypeId);
    if (!productType) {
      return res.status(400).json({ error: 'Product type not found' });
    }
    if (productType.category_id !== categoryId) {
      return res.status(400).json({ error: 'Product type does not belong to the specified category' });
    }
  }
  
  try { 
    const result = db.prepare('INSERT INTO attributes (category_id,product_type_id,name,type,required,filterable,searchable,options_json,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
      categoryId, 
      productTypeId, 
      String(body.name).trim(), 
      String(body.type || 'Text'), 
      Number(Boolean(body.required)), 
      Number(Boolean(body.filterable)), 
      Number(Boolean(body.searchable)), 
      JSON.stringify(Array.isArray(body.options) ? body.options : []), 
      body.status || 'ACTIVE', 
      Number(body.sortOrder || 0), 
      timestamp, 
      timestamp
    ); 
    res.status(201).json(mapAttribute(db.prepare('SELECT * FROM attributes WHERE id = ?').get(result.lastInsertRowid))); 
  } catch (error) { 
    res.status(400).json({ error: error.message.includes('UNIQUE') ? 'An attribute with that name already exists in this context' : 'Unable to create attribute' }); 
  } 
});
app.patch('/api/attributes/:id', auth, admin, (req, res) => {
  const body = req.body || {};
  const id = Number(req.params.id);
  const timestamp = now();
  const current = db.prepare('SELECT * FROM attributes WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Attribute not found' });
  
  const categoryId = body.categoryId !== undefined ? Number(body.categoryId) : current.category_id;
  const productTypeId = body.productTypeId !== undefined ? (body.productTypeId ? Number(body.productTypeId) : null) : current.product_type_id;
  
  if (productTypeId) {
    const productType = db.prepare('SELECT id, category_id FROM product_types WHERE id = ?').get(productTypeId);
    if (!productType) {
      return res.status(400).json({ error: 'Product type not found' });
    }
    if (productType.category_id !== categoryId) {
      return res.status(400).json({ error: 'Product type does not belong to the specified category' });
    }
  }
  
  try {
    const result = db.prepare('UPDATE attributes SET category_id = ?, product_type_id = ?, name = ?, type = ?, required = ?, filterable = ?, searchable = ?, options_json = ?, status = ?, sort_order = ?, updated_at = ? WHERE id = ?').run(
      categoryId,
      productTypeId,
      String(body.name || current.name).trim(),
      String(body.type || current.type),
      Number(body.required !== undefined ? body.required : current.required),
      Number(body.filterable !== undefined ? body.filterable : current.filterable),
      Number(body.searchable !== undefined ? body.searchable : current.searchable),
      JSON.stringify(Array.isArray(body.options) ? body.options : safeJson(current.options_json, [])),
      body.status !== undefined ? body.status : current.status,
      Number(body.sortOrder !== undefined ? body.sortOrder : current.sort_order),
      timestamp,
      id
    );
    if (!result.changes) return res.status(404).json({ error: 'Attribute not found' });
    res.json(mapAttribute(db.prepare('SELECT * FROM attributes WHERE id = ?').get(id)));
  } catch (error) {
    res.status(400).json({ error: error.message.includes('UNIQUE') ? 'An attribute with that name already exists in this context' : 'Unable to update attribute' });
  }
});
app.patch('/api/attributes/:id/archive', auth, admin, (req, res) => { const id = Number(req.params.id); const productCount = db.prepare("SELECT COUNT(*) count FROM products WHERE attributes_json LIKE ? AND status != 'ARCHIVED'").get(`%"${id}"%`).count; if (productCount > 0) { const result = db.prepare("UPDATE attributes SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now(), id); if (!result.changes) return res.status(404).json({ error: 'Attribute not found' }); return res.json({ archived: true, productCount, message: 'Attribute archived and preserved on existing products.' }); } const result = db.prepare('DELETE FROM attributes WHERE id = ?').run(id); if (!result.changes) return res.status(404).json({ error: 'Attribute not found' }); res.json({ deleted: true, message: 'Attribute deleted because it is not used by any products.' }); });
app.patch('/api/attributes/:id/restore', auth, admin, (req, res) => { const result = db.prepare("UPDATE attributes SET status = 'ACTIVE', updated_at = ? WHERE id = ?").run(now(), Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Attribute not found' }); res.json({ restored: true }); });
app.post('/api/migration/legacy', auth, admin, (req, res) => { const categories = Array.isArray(req.body?.categories) ? req.body.categories : []; const products = Array.isArray(req.body?.products) ? req.body.products : []; const timestamp = now(); try { db.exec('BEGIN'); const categoryInsert = db.prepare('INSERT OR IGNORE INTO categories (name,slug,description,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)'); for (const [index, category] of categories.entries()) categoryInsert.run(String(category.name || '').trim(), slugify(category.slug || category.name || `legacy-${index}`), category.description || '', Number(category.order || index + 1), timestamp, timestamp); const categoryId = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE'); const brandInsert = db.prepare('INSERT OR IGNORE INTO brands (name,slug,created_at,updated_at) VALUES (?,?,?,?)'); const brandId = db.prepare('SELECT id FROM brands WHERE name = ? COLLATE NOCASE'); const productInsert = db.prepare('INSERT OR IGNORE INTO products (sku,name,slug,category_id,brand_id,description,details,price,mrp,stock,unit,image_url,attributes_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'); for (const product of products) { const categoryRow = categoryId.get(String(product.category || 'Other Products')); if (!categoryRow) continue; const brandName = String(product.brand || '').trim(); if (brandName) brandInsert.run(brandName, slugify(brandName), timestamp, timestamp); const brandRow = brandName ? brandId.get(brandName) : null; const sku = String(product.code || product.sku || '').trim(); if (!sku) continue; productInsert.run(sku, String(product.name || sku), slugify(`${product.name || sku}-${sku}`), categoryRow.id, brandRow?.id || null, product.description || '', product.details || '', Number(product.price || 0), Number(product.mrp || product.price || 0), Number(product.stock || 0), product.unit || 'Nos', product.image || null, JSON.stringify(product.attributes || {}), timestamp, timestamp); } db.exec('COMMIT'); res.json({ migrated: { categories: categories.length, products: products.length } }); } catch (error) { db.exec('ROLLBACK'); res.status(400).json({ error: 'Migration failed', detail: error.message }); } });
app.get('/api/products', (req, res) => { 
  // Note: Products and stock are NEVER cached to ensure real-time inventory accuracy
  const page = Math.max(1, Number(req.query.page || 1)); 
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50))); 
  const search = String(req.query.search || '').trim(); 
  const sortBy = ['name', 'price', 'stock', 'created_at'].includes(String(req.query.sortBy)) ? req.query.sortBy : 'created_at';
  const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';
  const params = []; 
  const filters = ["p.status != 'ARCHIVED'"]; 
  
  if (search) { 
    filters.push('(p.name LIKE ? OR p.sku LIKE ? OR c.name LIKE ? OR b.name LIKE ? OR p.description LIKE ?)'); 
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); 
  } 
  
  if (req.query.categoryId) { 
    filters.push('p.category_id = ?'); 
    params.push(Number(req.query.categoryId)); 
  }
  
  if (req.query.brandId) {
    filters.push('p.brand_id = ?');
    params.push(Number(req.query.brandId));
  }
  
  if (req.query.status) {
    if (req.query.status === 'ACTIVE') {
      filters.push("p.status = 'ACTIVE'");
    } else if (req.query.status === 'INACTIVE') {
      filters.push("p.status = 'INACTIVE'");
    } else if (req.query.status === 'OUT_OF_STOCK') {
      filters.push("p.stock = 0");
    } else if (req.query.status === 'LOW_STOCK') {
      filters.push("p.stock > 0 AND p.stock < 10");
    }
  }
  
  if (req.query.minPrice) {
    filters.push('p.price >= ?');
    params.push(Number(req.query.minPrice));
  }
  
  if (req.query.maxPrice) {
    filters.push('p.price <= ?');
    params.push(Number(req.query.maxPrice));
  }
  
  const where = ` WHERE ${filters.join(' AND ')}`; 
  const total = db.prepare(`SELECT COUNT(*) count FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id${where}`).get(...params).count; 
  const orderBy = sortBy === 'created_at' ? 'p.created_at' : sortBy === 'name' ? 'p.name' : sortBy === 'price' ? 'p.price' : 'p.stock';
  const rows = db.prepare(`${productSelect}${where} ORDER BY ${orderBy} ${sortOrder} LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit).map(mapProduct); 
  res.json({ data: rows, page, limit, total, pages: Math.ceil(total / limit) }); 
});
// Background job for bulk import - creates job and returns immediately
app.post('/api/products/bulk-import-job', auth, admin, (req, res) => {
  const rows = Array.isArray(req.body?.products) ? req.body.products : [];
  const duplicateMode = req.body?.duplicateMode === 'update' ? 'update' : 'skip';
  if (!rows.length) return res.status(400).json({ error: 'At least one product is required' });
  
  const timestamp = now();
  const result = db.prepare(
    'INSERT INTO import_jobs (status, total_rows, processed_rows, valid_rows, error_rows, errors_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('PENDING', rows.length, 0, 0, 0, '[]', req.user.id, timestamp, timestamp);
  
  const jobId = result.lastInsertRowid;
  
  // Process in background (non-blocking)
  processBulkImportJob(jobId, rows, duplicateMode, req.user.id).catch(error => {
    console.error('[Bulk Import Job] Error:', error);
  });
  
  res.status(202).json({ jobId, status: 'PENDING', message: 'Import job started' });
});

// Get job status and progress
app.get('/api/products/bulk-import-job/:id', auth, admin, (req, res) => {
  const jobId = Number(req.params.id);
  const job = db.prepare('SELECT * FROM import_jobs WHERE id = ?').get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  
  const errors = job.errors_json ? JSON.parse(job.errors_json) : [];
  
  res.json({
    id: job.id,
    status: job.status,
    totalRows: job.total_rows,
    processedRows: job.processed_rows,
    validRows: job.valid_rows,
    errorRows: job.error_rows,
    errors: errors.slice(0, 50), // Return first 50 errors
    hasMoreErrors: errors.length > 50,
    createdAt: job.created_at,
    updatedAt: job.updated_at
  });
});

// List import jobs
app.get('/api/products/bulk-import-jobs', auth, admin, (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
  const jobs = db.prepare('SELECT * FROM import_jobs ORDER BY created_at DESC LIMIT ?').all(limit).map(job => ({
    id: job.id,
    status: job.status,
    totalRows: job.total_rows,
    processedRows: job.processed_rows,
    validRows: job.valid_rows,
    errorRows: job.error_rows,
    createdAt: job.created_at,
    updatedAt: job.updated_at
  }));
  res.json(jobs);
});

// Background job processor function
async function processBulkImportJob(jobId, rows, duplicateMode, userId) {
  const timestamp = now();
  
  try {
    // Update job status to PROCESSING
    db.prepare('UPDATE import_jobs SET status = ?, updated_at = ? WHERE id = ?').run('PROCESSING', timestamp, jobId);
    
    // ── STAGE 1: load reference data ────────────────────────────────────────────
    const existingCategories = db.prepare("SELECT id, name, status FROM categories WHERE status != 'ARCHIVED'").all();
    const existingBrands     = db.prepare("SELECT id, name, status FROM brands WHERE status != 'ARCHIVED'").all();
    const existingTypes      = db.prepare("SELECT id, name, category_id, status FROM product_types WHERE status != 'ARCHIVED'").all();

    const normalizeName = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
    
    const categoryMap = new Map();
    for (const c of existingCategories) categoryMap.set(normalizeName(c.name), { id: c.id, name: c.name });

    const brandMap = new Map();
    for (const b of existingBrands) brandMap.set(normalizeName(b.name), { id: b.id, name: b.name });

    const typeKey = (catId, typeName) => `${catId}::${normalizeName(typeName)}`;
    const typeMap = new Map();
    for (const t of existingTypes) typeMap.set(typeKey(t.category_id, t.name), { id: t.id, name: t.name });

    const existingSkus = new Set(
      db.prepare('SELECT LOWER(sku) sku FROM products').all().map(r => r.sku)
    );

    // ── STAGE 2: validate every row ─────────────────────────────────────────────
    const results = [];
    const valid   = [];
    const seenSkus = new Set();
    const errors = [];

    for (const entry of rows) {
      const rowNum  = Number(entry?.row || 0);
      const raw     = entry?.product && typeof entry.product === 'object' ? entry.product : entry;
      const rowErrors = [];

      const sku      = String(raw?.sku || raw?.code || '').trim();
      const name     = String(raw?.name || '').trim();
      const catName  = String(raw?.category || '').trim();
      const brandName = String(raw?.brand || '').trim();
      const typeName  = String(raw?.productType || '').trim();
      const priceRaw  = String(raw?.price ?? '').trim();
      const mrpRaw    = String(raw?.mrp ?? priceRaw).trim();
      const stockRaw  = String(raw?.stock ?? '').trim();
      const discountRaw = String(raw?.discount ?? '0').trim();
      const status   = String(raw?.status || 'ACTIVE').toUpperCase();
      const unit     = String(raw?.unit || 'Nos').trim();

      const price    = Number(priceRaw);
      const mrp      = Number(mrpRaw) || price;
      const stock    = Number(stockRaw);
      const discount = Number(discountRaw);

      // Validation
      if (!sku) rowErrors.push('SKU is required');
      else if (!/^[A-Z0-9_-]+$/i.test(sku)) rowErrors.push('SKU must use only letters, numbers, dashes or underscores');
      else if (seenSkus.has(sku.toLowerCase())) rowErrors.push('Duplicate SKU in this file');

      if (!name) rowErrors.push('Product name is required');
      if (!catName) rowErrors.push('Category is required');

      if (!priceRaw || !Number.isFinite(price) || price < 0)
        rowErrors.push('Price must be a valid number ≥ 0');
      if (!stockRaw || !Number.isInteger(stock) || stock < 0)
        rowErrors.push('Stock must be a whole number ≥ 0');
      if (!Number.isFinite(discount) || discount < 0 || discount > 100)
        rowErrors.push('Discount must be 0–100');
      if (mrp > 0 && mrp < price)
        rowErrors.push('MRP cannot be less than price');
      if (!['ACTIVE', 'INACTIVE'].includes(status))
        rowErrors.push('Status must be ACTIVE or INACTIVE');

      const categoryInfo = catName ? categoryMap.get(normalizeName(catName)) : null;
      if (catName && !categoryInfo)
        rowErrors.push(`Category "${catName}" not found`);

      const brandInfo = brandName ? brandMap.get(normalizeName(brandName)) : null;

      let typeInfo = null;
      if (typeName && categoryInfo) {
        typeInfo = typeMap.get(typeKey(categoryInfo.id, typeName)) || null;
      }

      if (sku) seenSkus.add(sku.toLowerCase());

      if (rowErrors.length) {
        errors.push({ row: rowNum, sku, reason: rowErrors.join('; ') });
        continue;
      }

      valid.push({
        row: rowNum, sku, name, catName, brandName, typeName, unit,
        price, mrp, stock, discount, status,
        categoryInfo, brandInfo, typeInfo,
        imageUrl: raw?.imageUrl || raw?.image || null,
        description: raw?.description || '',
        details: raw?.details || ''
      });
    }

    // Update progress after validation
    db.prepare('UPDATE import_jobs SET processed_rows = ?, valid_rows = ?, error_rows = ?, errors_json = ?, updated_at = ? WHERE id = ?')
      .run(rows.length, valid.length, errors.length, JSON.stringify(errors), now(), jobId);

    // ── STAGE 3: insert/update products ───────────────────────────────────────────
    db.exec('BEGIN IMMEDIATE');
    
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const item of valid) {
      const isExisting = existingSkus.has(item.sku.toLowerCase());
      
      if (isExisting && duplicateMode === 'skip') {
        skipped++;
        continue;
      }

      const slug = slugify(`${item.name}-${item.sku}`);
      
      // Auto-create brand if needed
      let brandId = item.brandInfo?.id;
      if (item.brandName && !brandId) {
        const brandSlug = slugify(item.brandName);
        try {
          const brandResult = db.prepare(
            'INSERT INTO brands (name, slug, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
          ).run(item.brandName, brandSlug, 'ACTIVE', timestamp, timestamp);
          brandId = brandResult.lastInsertRowid;
          brandMap.set(normalizeName(item.brandName), { id: brandId, name: item.brandName });
        } catch (e) {
          // Brand might already exist, fetch it
          const existingBrand = db.prepare('SELECT id FROM brands WHERE slug = ?').get(brandSlug);
          if (existingBrand) brandId = existingBrand.id;
        }
      }

      // Auto-create product type if needed
      let typeId = item.typeInfo?.id;
      if (item.typeName && item.categoryInfo && !typeId) {
        try {
          const typeResult = db.prepare(
            'INSERT INTO product_types (category_id, name, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(item.categoryInfo.id, item.typeName, 'ACTIVE', 0, timestamp, timestamp);
          typeId = typeResult.lastInsertRowid;
        } catch (e) {
          const existingType = db.prepare('SELECT id FROM product_types WHERE category_id = ? AND name = ?').get(item.categoryInfo.id, item.typeName);
          if (existingType) typeId = existingType.id;
        }
      }

      if (isExisting && duplicateMode === 'update') {
        db.prepare(
          `UPDATE products SET name = ?, slug = ?, category_id = ?, brand_id = ?, product_type_id = ?, 
           description = ?, details = ?, price = ?, mrp = ?, discount = ?, stock = ?, unit = ?, 
           status = ?, updated_at = ? WHERE sku = ?`
        ).run(item.name, slug, item.categoryInfo.id, brandId, typeId, item.description, item.details,
          item.price, item.mrp, item.discount, item.stock, item.unit, item.status, timestamp, item.sku);
        updated++;
      } else {
        db.prepare(
          `INSERT INTO products (sku, name, slug, category_id, brand_id, product_type_id, description, details, 
           price, mrp, discount, stock, unit, status, created_at, updated_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(item.sku, item.name, slug, item.categoryInfo.id, brandId, typeId, item.description, item.details,
          item.price, item.mrp, item.discount, item.stock, item.unit, item.status, timestamp, timestamp);
        imported++;
      }
    }

    db.exec('COMMIT');
    
    // Clear cache after successful import
    staticDataCache.clear();
    
    // Mark job as completed
    db.prepare('UPDATE import_jobs SET status = ?, updated_at = ? WHERE id = ?').run('COMPLETED', now(), jobId);
    
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* already closed */ }
    console.error('[Bulk Import Job] Error:', error?.stack || error);
    
    // Mark job as failed
    db.prepare('UPDATE import_jobs SET status = ?, errors_json = ?, updated_at = ? WHERE id = ?')
      .run('FAILED', JSON.stringify([{ reason: error.message || 'Unknown error' }]), now(), jobId);
  }
}

// Keep the synchronous endpoint for small imports (< 100 products)
app.post('/api/products/bulk-import', auth, admin, (req, res) => {
  const rows = Array.isArray(req.body?.products) ? req.body.products : [];
  const duplicateMode = req.body?.duplicateMode === 'update' ? 'update' : 'skip';
  if (!rows.length) return res.status(400).json({ error: 'At least one product is required' });
  if (rows.length > 100) return res.status(400).json({ error: 'Maximum 100 products for synchronous import. Use /api/products/bulk-import-job for larger imports.' });

  const normalizeName = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const timestamp = now();

  // ── STAGE 1: load reference data ────────────────────────────────────────────
  const existingCategories = db.prepare("SELECT id, name, status FROM categories WHERE status != 'ARCHIVED'").all();
  const existingBrands     = db.prepare("SELECT id, name, status FROM brands WHERE status != 'ARCHIVED'").all();
  const existingTypes      = db.prepare("SELECT id, name, category_id, status FROM product_types WHERE status != 'ARCHIVED'").all();

  const categoryMap = new Map(); // normalized-name → { id, name }
  for (const c of existingCategories) categoryMap.set(normalizeName(c.name), { id: c.id, name: c.name });

  const brandMap = new Map();    // normalized-name → { id, name }
  for (const b of existingBrands) brandMap.set(normalizeName(b.name), { id: b.id, name: b.name });

  const typeKey = (catId, typeName) => `${catId}::${normalizeName(typeName)}`;
  const typeMap = new Map();     // "categoryId::normalized-name" → { id, name }
  for (const t of existingTypes) typeMap.set(typeKey(t.category_id, t.name), { id: t.id, name: t.name });

  const existingSkus = new Set(
    db.prepare('SELECT LOWER(sku) sku FROM products').all().map(r => r.sku)
  );

  // ── STAGE 2: validate every row ─────────────────────────────────────────────
  const results = [];
  const valid   = [];
  const seenSkus = new Set();   // within-file duplicates

  for (const entry of rows) {
    const rowNum  = Number(entry?.row || 0);
    const raw     = entry?.product && typeof entry.product === 'object' ? entry.product : entry;
    const errors  = [];

    const sku      = String(raw?.sku || raw?.code || '').trim();
    const name     = String(raw?.name || '').trim();
    const catName  = String(raw?.category || '').trim();
    const brandName = String(raw?.brand || '').trim();
    const typeName  = String(raw?.productType || '').trim();
    const priceRaw  = String(raw?.price ?? '').trim();
    const mrpRaw    = String(raw?.mrp ?? priceRaw).trim();
    const stockRaw  = String(raw?.stock ?? '').trim();
    const discountRaw = String(raw?.discount ?? '0').trim();
    const status   = String(raw?.status || 'ACTIVE').toUpperCase();
    const unit     = String(raw?.unit || 'Nos').trim();

    const price    = Number(priceRaw);
    const mrp      = Number(mrpRaw) || price;
    const stock    = Number(stockRaw);
    const discount = Number(discountRaw);

    // ── field-level errors ────────────────────────────────────────────────────
    if (!sku)  errors.push('SKU is required');
    else if (!/^[A-Z0-9_-]+$/i.test(sku)) errors.push('SKU must use only letters, numbers, dashes or underscores');
    else if (seenSkus.has(sku.toLowerCase())) errors.push('Duplicate SKU in this file');

    if (!name) errors.push('Product name is required');
    if (!catName) errors.push('Category is required');

    if (!priceRaw || !Number.isFinite(price) || price < 0)
      errors.push('Price must be a valid number ≥ 0');
    if (!stockRaw || !Number.isInteger(stock) || stock < 0)
      errors.push('Stock must be a whole number ≥ 0');
    if (!Number.isFinite(discount) || discount < 0 || discount > 100)
      errors.push('Discount must be 0–100');
    if (mrp > 0 && mrp < price)
      errors.push('MRP cannot be less than price');
    if (!['ACTIVE', 'INACTIVE'].includes(status))
      errors.push('Status must be ACTIVE or INACTIVE');

    // ── reference validation ──────────────────────────────────────────────────
    const categoryInfo = catName ? categoryMap.get(normalizeName(catName)) : null;
    if (catName && !categoryInfo)
      errors.push(`Category "${catName}" not found`);

    const brandInfo = brandName ? brandMap.get(normalizeName(brandName)) : null;
    // Brand not found is not an error — we auto-create it

    let typeInfo = null;
    if (typeName && categoryInfo) {
      typeInfo = typeMap.get(typeKey(categoryInfo.id, typeName)) || null;
      // Not found is not an error — we auto-create it
    }

    if (sku) seenSkus.add(sku.toLowerCase());

    if (errors.length) {
      results.push({ row: rowNum, sku, status: 'failed', reason: errors.join('; ') });
      continue;
    }

    valid.push({
      row: rowNum, sku, name, catName, brandName, typeName, unit,
      price, mrp, stock, discount, status,
      categoryInfo, brandInfo, typeInfo,
      imageUrl:  raw?.imageUrl || raw?.image || null,
      imageUrls: Array.isArray(raw?.imageUrls) ? raw.imageUrls : [],
      description: String(raw?.description || ''),
      details:     String(raw?.details || ''),
      attributes:  raw?.attributes && typeof raw.attributes === 'object' ? raw.attributes : {},
    });
  }

  // ── STAGE 3: prepare statements outside transaction ─────────────────────────
  const stmtInsertBrand   = db.prepare('INSERT INTO brands (name,slug,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?)');
  const stmtInsertType    = db.prepare('INSERT INTO product_types (category_id,name,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)');
  const stmtInsertProduct = db.prepare('INSERT INTO products (sku,name,slug,category_id,brand_id,product_type_id,description,details,price,mrp,discount,stock,unit,image_url,image_urls_json,attributes_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const stmtUpdateProduct = db.prepare('UPDATE products SET name=?,category_id=?,brand_id=?,product_type_id=?,description=?,details=?,price=?,mrp=?,discount=?,stock=?,unit=?,image_url=?,image_urls_json=?,attributes_json=?,status=?,updated_at=? WHERE LOWER(sku)=LOWER(?)');
  const stmtFindProduct   = db.prepare('SELECT id,sku FROM products WHERE LOWER(sku)=LOWER(?) LIMIT 1');
  const stmtFindBrand     = db.prepare('SELECT id FROM brands WHERE LOWER(name)=LOWER(?) LIMIT 1');
  const stmtFindType      = db.prepare('SELECT id FROM product_types WHERE category_id=? AND LOWER(name)=LOWER(?) LIMIT 1');

  // ── STAGE 4: persist in a single transaction ──────────────────────────────
  try {
    db.exec('BEGIN IMMEDIATE');

    for (const item of valid) {
      // Resolve or auto-create brand
      let brandId = item.brandInfo?.id ?? null;
      if (!brandId && item.brandName) {
        const key = normalizeName(item.brandName);
        if (brandMap.has(key)) {
          brandId = brandMap.get(key).id;
        } else {
          const found = stmtFindBrand.get(item.brandName);
          if (found) {
            brandId = found.id;
            brandMap.set(key, { id: brandId, name: item.brandName });
          } else {
            const r = stmtInsertBrand.run(item.brandName, slugify(item.brandName), '', 'ACTIVE', timestamp, timestamp);
            brandId = Number(r.lastInsertRowid);
            brandMap.set(key, { id: brandId, name: item.brandName });
          }
        }
      }

      // Resolve or auto-create product type
      let typeId = item.typeInfo?.id ?? null;
      if (!typeId && item.typeName && item.categoryInfo) {
        const tk = typeKey(item.categoryInfo.id, item.typeName);
        if (typeMap.has(tk)) {
          typeId = typeMap.get(tk).id;
        } else {
          const found = stmtFindType.get(item.categoryInfo.id, item.typeName);
          if (found) {
            typeId = found.id;
            typeMap.set(tk, { id: typeId, name: item.typeName });
          } else {
            const r = stmtInsertType.run(item.categoryInfo.id, item.typeName, 'ACTIVE', 0, timestamp, timestamp);
            typeId = Number(r.lastInsertRowid);
            typeMap.set(tk, { id: typeId, name: item.typeName });
          }
        }
      }

      const existing = existingSkus.has(item.sku.toLowerCase()) ? stmtFindProduct.get(item.sku) : null;

      if (existing) {
        if (duplicateMode === 'skip') {
          results.push({ row: item.row, sku: item.sku, status: 'skipped', reason: 'SKU already exists' });
          continue;
        }
        stmtUpdateProduct.run(
          item.name, item.categoryInfo.id, brandId, typeId,
          item.description, item.details, item.price, item.mrp, item.discount,
          item.stock, item.unit, item.imageUrl,
          JSON.stringify(item.imageUrls), JSON.stringify(item.attributes),
          item.status, timestamp, item.sku
        );
        results.push({ row: item.row, sku: item.sku, status: 'updated' });
      } else {
        stmtInsertProduct.run(
          item.sku, item.name, slugify(`${item.name}-${item.sku}`),
          item.categoryInfo.id, brandId, typeId,
          item.description, item.details, item.price, item.mrp, item.discount,
          item.stock, item.unit, item.imageUrl,
          JSON.stringify(item.imageUrls), JSON.stringify(item.attributes),
          item.status, timestamp, timestamp
        );
        existingSkus.add(item.sku.toLowerCase());
        results.push({ row: item.row, sku: item.sku, status: 'imported' });
      }
    }

    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* already closed */ }
    console.error('[api/products/bulk-import]', error?.stack || error);
    return res.status(500).json({ error: `Import transaction failed: ${error && error.message ? error.message : 'unknown error'}. No products were saved.` });
  }

  const imported = results.filter(r => r.status === 'imported').length;
  const updated  = results.filter(r => r.status === 'updated').length;
  const skipped  = results.filter(r => r.status === 'skipped').length;
  const failed   = results.filter(r => r.status === 'failed').length;

  res.json({
    success: true,
    total: rows.length,
    imported,
    updated,
    skipped,
    failed,
    results,
  });
});
app.post('/api/products', auth, admin, (req, res) => { 
  const body = req.body || {}; 
  const sku = String(body.sku || '').trim(); 
  const name = String(body.name || '').trim(); 
  const categoryId = Number(body.categoryId); 
  const price = Number(body.price); 
  const mrp = Number(body.mrp || body.price || 0);
  const discount = Number(body.discount || 0);
  const stock = normalizeStockValue(body.stock); 
  
  // Validation
  if (!sku || !name || !categoryId || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0) {
    return res.status(400).json({ error: 'SKU, product name, category, valid price and stock are required' }); 
  }
  
  // Validate SKU format (alphanumeric, dash, underscore only)
  if (!/^[A-Z0-9_-]+$/i.test(sku)) {
    return res.status(400).json({ error: 'SKU must contain only letters, numbers, dashes and underscores' });
  }
  
  // Validate MRP
  if (mrp > 0 && mrp < price) {
    return res.status(400).json({ error: 'MRP cannot be less than selling price' });
  }
  
  // Validate discount
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
    return res.status(400).json({ error: 'Discount must be between 0 and 100' });
  }
  
  // Validate category exists and is active
  const category = db.prepare("SELECT id, status FROM categories WHERE id = ?").get(categoryId);
  if (!category) {
    return res.status(400).json({ error: 'Category not found' });
  }
  if (category.status !== 'ACTIVE') {
    return res.status(400).json({ error: 'Cannot add products to an inactive category' });
  }
  
  const timestamp = now(); 
  
  try { 
    // Handle brand - either by ID or by name lookup
    let brandId = body.brandId ? Number(body.brandId) : null;

    if (brandId) {
      const brand = db.prepare('SELECT id, status FROM brands WHERE id = ?').get(brandId);
      if (!brand) return res.status(400).json({ error: 'Brand not found' });
      if (brand.status !== 'ACTIVE') return res.status(400).json({ error: 'Cannot use an inactive brand' });
    }
    
    if (!brandId && body.brand && String(body.brand).trim()) {
      const brandName = String(body.brand).trim();
      const existingBrand = db.prepare('SELECT id, status FROM brands WHERE LOWER(name) = LOWER(?)').get(brandName);
      
      if (existingBrand) {
        if (existingBrand.status === 'ARCHIVED') {
          return res.status(400).json({ error: 'Cannot use archived brand. Please restore it first.' });
        }
        brandId = existingBrand.id;
      } else {
        // Auto-create brand if it doesn't exist
        const brandResult = db.prepare('INSERT INTO brands (name,slug,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(
          brandName,
          slugify(brandName),
          '',
          'ACTIVE',
          timestamp,
          timestamp
        );
        brandId = Number(brandResult.lastInsertRowid);
      }
    }
    
    // Validate product type if provided
    let productTypeId = body.productTypeId ? Number(body.productTypeId) : null;
    if (productTypeId) {
      const productType = db.prepare('SELECT id, category_id, status FROM product_types WHERE id = ?').get(productTypeId);
      if (!productType) {
        return res.status(400).json({ error: 'Product type not found' });
      }
      if (productType.category_id !== categoryId) {
        return res.status(400).json({ error: 'Product type does not belong to selected category' });
      }
      if (productType.status === 'ARCHIVED') {
        return res.status(400).json({ error: 'Cannot use archived product type' });
      }
    }
    
    // Validate image URLs
    const imageUrl = body.imageUrl && String(body.imageUrl).trim() ? body.imageUrl : null;
    const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls.filter(url => url && String(url).trim()) : [];
    
    // Validate attributes against product type and category schema
    const attributes = body.attributes && typeof body.attributes === 'object' ? body.attributes : {};
    
    // Load applicable attributes (category-level + product-type-specific)
    const applicableAttributes = db.prepare(`
      SELECT * FROM attributes 
      WHERE (category_id = ? AND product_type_id IS NULL)
         OR (category_id = ? AND product_type_id = ?)
      ORDER BY sort_order, name
    `).all(categoryId, categoryId, productTypeId);
    
    // Validate required attributes
    for (const attr of applicableAttributes) {
      if (attr.required === 1) {
        const value = attributes[attr.name];
        if (value === undefined || value === null || String(value).trim() === '') {
          return res.status(400).json({ error: `Attribute "${attr.name}" is required` });
        }
      }
    }
    
    const result = db.prepare('INSERT INTO products (sku,name,slug,category_id,brand_id,product_type_id,description,details,price,mrp,discount,stock,unit,image_url,image_urls_json,attributes_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      sku, 
      name, 
      slugify(`${name}-${sku}`), 
      categoryId, 
      brandId, 
      productTypeId, 
      body.description || '', 
      body.details || '', 
      price, 
      mrp, 
      discount, 
      stock, 
      body.unit || 'Nos', 
      imageUrl, 
      JSON.stringify(imageUrls), 
      JSON.stringify(attributes), 
      body.status || 'ACTIVE', 
      timestamp, 
      timestamp
    ); 
    
    const product = mapProduct(db.prepare(`${productSelect} WHERE p.id = ?`).get(result.lastInsertRowid)); 
    if (!product) return res.status(500).json({ error: 'Product persisted but could not be loaded' }); 
    res.status(201).json(product); 
  } catch (error) { 
    console.error('[api/products POST]', error && error.stack ? error.stack : error);
    res.status(error.message.includes('UNIQUE') ? 409 : 400).json({ error: error.message.includes('UNIQUE') ? 'SKU already exists' : 'Unable to create product' }); 
  } 
});
app.patch('/api/products/:id', auth, admin, (req, res) => { 
  const body = req.body || {}; 
  const id = Number(req.params.id); 
  const current = db.prepare('SELECT * FROM products WHERE id = ?').get(id); 
  if (!current) return res.status(404).json({ error: 'Product not found' }); 
  
  const stockOnly = Object.prototype.hasOwnProperty.call(body, 'stock') && Object.keys(body).every((key) => key === 'stock'); 
  
  if (stockOnly) { 
    const rawStock = String(body.stock ?? '').trim(); 
    const stock = Number(rawStock); 
    if (!rawStock || !Number.isInteger(stock) || !Number.isFinite(stock) || stock < 0) {
      return res.status(400).json({ error: 'Invalid stock value' }); 
    }
    try { 
      db.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?').run(stock, now(), id); 
      const product = mapProduct(db.prepare(`${productSelect} WHERE p.id = ?`).get(id)); 
      if (!product) return res.status(500).json({ error: 'Product updated but could not be reloaded' }); 
      return res.json(product); 
    } catch { 
      return res.status(400).json({ error: 'Unable to update product stock' }); 
    } 
  } 
  
  const values = { 
    name: body.name == null ? current.name : String(body.name).trim(), 
    categoryId: body.categoryId == null ? current.category_id : Number(body.categoryId), 
    price: body.price == null ? current.price : Number(body.price),
    mrp: body.mrp == null ? current.mrp : Number(body.mrp),
    discount: body.discount == null ? current.discount : Number(body.discount),
    stock: body.stock == null ? current.stock : normalizeStockValue(body.stock) 
  }; 
  
  // Validation
  if (!values.name || !values.categoryId || !Number.isFinite(values.price) || values.price < 0 || !Number.isInteger(values.stock) || values.stock < 0) {
    return res.status(400).json({ error: 'Invalid product data' }); 
  }
  
  // Validate MRP
  if (values.mrp > 0 && values.mrp < values.price) {
    return res.status(400).json({ error: 'MRP cannot be less than selling price' });
  }
  
  // Validate discount
  if (!Number.isFinite(values.discount) || values.discount < 0 || values.discount > 100) {
    return res.status(400).json({ error: 'Discount must be between 0 and 100' });
  }
  
  // Validate category
  const category = db.prepare("SELECT id, status FROM categories WHERE id = ?").get(values.categoryId);
  if (!category) {
    return res.status(400).json({ error: 'Category not found' });
  }
  if (category.status !== 'ACTIVE') {
    return res.status(400).json({ error: 'Cannot move products to an inactive category' });
  }
  
  const timestamp = now(); 
  
  try { 
    // Handle brand - either by ID or by name lookup
    let brandId = body.brandId !== undefined ? (body.brandId ? Number(body.brandId) : null) : current.brand_id;

    if (brandId) {
      const brand = db.prepare('SELECT id, status FROM brands WHERE id = ?').get(brandId);
      if (!brand) return res.status(400).json({ error: 'Brand not found' });
      if (brand.status !== 'ACTIVE') return res.status(400).json({ error: 'Cannot use an inactive brand' });
    }
    
    if (body.brand !== undefined && String(body.brand).trim()) {
      const brandName = String(body.brand).trim();
      const existingBrand = db.prepare('SELECT id, status FROM brands WHERE LOWER(name) = LOWER(?)').get(brandName);
      
      if (existingBrand) {
        if (existingBrand.status === 'ARCHIVED') {
          return res.status(400).json({ error: 'Cannot use archived brand. Please restore it first.' });
        }
        brandId = existingBrand.id;
      } else {
        // Auto-create brand if it doesn't exist
        const brandResult = db.prepare('INSERT INTO brands (name,slug,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(
          brandName,
          slugify(brandName),
          '',
          'ACTIVE',
          timestamp,
          timestamp
        );
        brandId = Number(brandResult.lastInsertRowid);
      }
    }
    
    // Validate product type if changing
    let productTypeId = body.productTypeId !== undefined ? (body.productTypeId ? Number(body.productTypeId) : null) : current.product_type_id;
    if (productTypeId) {
      const productType = db.prepare('SELECT id, category_id, status FROM product_types WHERE id = ?').get(productTypeId);
      if (!productType) {
        return res.status(400).json({ error: 'Product type not found' });
      }
      if (productType.category_id !== values.categoryId) {
        return res.status(400).json({ error: 'Product type does not belong to selected category' });
      }
      if (productType.status === 'ARCHIVED') {
        return res.status(400).json({ error: 'Cannot use archived product type' });
      }
    }
    
    // Validate attributes against product type and category schema
    const attributes = body.attributes !== undefined ? (typeof body.attributes === 'object' ? body.attributes : {}) : safeJson(current.attributes_json, {});
    
    // Load applicable attributes (category-level + product-type-specific)
    const applicableAttributes = db.prepare(`
      SELECT * FROM attributes 
      WHERE (category_id = ? AND product_type_id IS NULL)
         OR (category_id = ? AND product_type_id = ?)
      ORDER BY sort_order, name
    `).all(values.categoryId, values.categoryId, productTypeId);
    
    // Validate required attributes
    for (const attr of applicableAttributes) {
      if (attr.required === 1) {
        const value = attributes[attr.name];
        if (value === undefined || value === null || String(value).trim() === '') {
          return res.status(400).json({ error: `Attribute "${attr.name}" is required` });
        }
      }
    }
    
    db.prepare('UPDATE products SET name = ?, category_id = ?, brand_id = ?, product_type_id = ?, description = ?, details = ?, price = ?, mrp = ?, discount = ?, stock = ?, unit = ?, image_url = ?, image_urls_json = ?, attributes_json = ?, status = ?, updated_at = ? WHERE id = ?').run(
      values.name, 
      values.categoryId, 
      brandId, 
      productTypeId, 
      body.description ?? current.description, 
      body.details ?? current.details, 
      values.price, 
      values.mrp, 
      values.discount, 
      values.stock, 
      body.unit ?? current.unit, 
      body.imageUrl ?? current.image_url, 
      JSON.stringify(body.imageUrls ?? safeJson(current.image_urls_json, [])), 
      JSON.stringify(body.attributes ?? safeJson(current.attributes_json, {})), 
      body.status ?? current.status, 
      timestamp, 
      id
    ); 
    
    const product = mapProduct(db.prepare(`${productSelect} WHERE p.id = ?`).get(id)); 
    if (!product) return res.status(500).json({ error: 'Product updated but could not be reloaded' }); 
    res.json(product); 
  } catch (error) {
    console.error('[api/products PATCH]', error && error.stack ? error.stack : error);
    res.status(400).json({ error: 'Unable to update product' }); 
  } 
});
app.patch('/api/products/:id/archive', auth, admin, (req, res) => { const result = db.prepare("UPDATE products SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now(), Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Product not found' }); res.status(204).end(); });
const detectImageFormat = (filePath) => {
  const header = fs.readFileSync(filePath).subarray(0, 12);
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'jpeg';
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (header.length >= 6 && ['GIF87a', 'GIF89a'].includes(header.subarray(0, 6).toString('ascii'))) return 'gif';
  if (header.length >= 12 && header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
};
app.post('/api/images', auth, admin, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image is required' }); 
  
  // Validate file type
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedMimeTypes.includes(req.file.mimetype)) {
    // Clean up uploaded file
    return res.status(400).json({ error: 'Only JPEG, PNG, WebP and GIF images are allowed' });
  }
  
  // Validate file size (max 10MB)
  if (req.file.size > 10 * 1024 * 1024) {
    return res.status(400).json({ error: 'Image size must be less than 10MB' });
  }

  const temporaryPath = path.join(resolvedUploadDirectory, `.validate-${crypto.randomUUID()}`);
  fs.writeFileSync(temporaryPath, req.file.buffer);
  const detectedFormat = detectImageFormat(temporaryPath);
  try { fs.unlinkSync(temporaryPath); } catch { /* ignore */ }
  const expectedFormats = { 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  if (!detectedFormat || detectedFormat !== expectedFormats[req.file.mimetype]) {
    return res.status(400).json({ error: 'Uploaded file is not a valid supported image' });
  }
  let dimensions;
  try { dimensions = imageSize(req.file.buffer); } catch {
    return res.status(400).json({ error: 'Uploaded image could not be decoded' });
  }
  if (!dimensions.width || !dimensions.height || dimensions.width > 10000 || dimensions.height > 10000) {
    return res.status(400).json({ error: 'Uploaded image dimensions are invalid or too large' });
  }
  try {
    const stored = await imageStorage.uploadImage({ buffer: req.file.buffer, format: detectedFormat, mimetype: req.file.mimetype });
    res.status(201).json({ 
      url: stored.url,
      filename: stored.key,
      size: req.file.size,
      mimetype: req.file.mimetype
    }); 
  } catch (error) {
    console.error('[api/images POST]', error);
    res.status(500).json({ error: 'Unable to save image' });
  }
});
app.get('/api/admin/stats', auth, admin, (_req, res) => { 
  const count = (sql) => db.prepare(sql).get().count;
  const today = new Date().toISOString().split('T')[0];
  
  // Revenue calculation excluding cancelled/rejected orders
  const totalRevenue = Number(db.prepare('SELECT COALESCE(SUM(total), 0) total FROM orders WHERE status NOT IN (\'CANCELLED\', \'REJECTED\')').get().total || 0);
  const todayRevenue = Number(db.prepare('SELECT COALESCE(SUM(total), 0) total FROM orders WHERE DATE(created_at) = ? AND status NOT IN (\'CANCELLED\', \'REJECTED\')').get(today).total || 0);
  
  // Order counts by status
  const pendingOrders = count("SELECT COUNT(*) count FROM orders WHERE status = 'PENDING'");
  const confirmedOrders = count("SELECT COUNT(*) count FROM orders WHERE status = 'CONFIRMED'");
  const processingOrders = count("SELECT COUNT(*) count FROM orders WHERE status = 'PROCESSING'");
  const deliveredOrders = count("SELECT COUNT(*) count FROM orders WHERE status = 'DELIVERED'");
  const cancelledOrders = count("SELECT COUNT(*) count FROM orders WHERE status = 'CANCELLED'");
  const todayOrders = count("SELECT COUNT(*) count FROM orders WHERE DATE(created_at) = ?");
  
  // Stock counts
  const lowStock = count("SELECT COUNT(*) count FROM products WHERE stock > 0 AND stock < 10 AND status != 'ARCHIVED'");
  const outOfStock = count("SELECT COUNT(*) count FROM products WHERE stock = 0 AND status != 'ARCHIVED'");
  
  res.json({ 
    products: count("SELECT COUNT(*) count FROM products WHERE status != 'ARCHIVED'"), 
    categories: count("SELECT COUNT(*) count FROM categories WHERE status != 'ARCHIVED'"), 
    brands: count("SELECT COUNT(*) count FROM brands WHERE status != 'ARCHIVED'"), 
    customers: count("SELECT COUNT(*) count FROM users WHERE role = 'CUSTOMER'"), 
    orders: count('SELECT COUNT(*) count FROM orders'),
    revenue: totalRevenue,
    todayRevenue,
    todayOrders,
    pendingOrders,
    confirmedOrders,
    processingOrders,
    deliveredOrders,
    cancelledOrders,
    lowStock,
    outOfStock
  }); 
});
app.get('/api/admin/products', auth, admin, (req, res) => { 
  const page = Math.max(1, Number(req.query.page || 1)); 
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const search = String(req.query.search || '').trim();
  const sortBy = ['name', 'price', 'stock', 'created_at'].includes(String(req.query.sortBy)) ? req.query.sortBy : 'created_at';
  const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const filters = ["p.status != 'ARCHIVED'"];
  const params = [];

  if (search) {
    filters.push('(p.name LIKE ? OR p.sku LIKE ? OR COALESCE(b.name,\'\') LIKE ? OR COALESCE(pt.name,\'\') LIKE ? OR p.description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (req.query.categoryId) { filters.push('p.category_id = ?'); params.push(Number(req.query.categoryId)); }
  if (req.query.brandId)    { filters.push('p.brand_id = ?');    params.push(Number(req.query.brandId)); }
  if (req.query.status === 'ACTIVE')     { filters.push("p.status = 'ACTIVE'"); }
  else if (req.query.status === 'INACTIVE') { filters.push("p.status = 'INACTIVE'"); }
  else if (req.query.status === 'OUT_OF_STOCK') { filters.push('p.stock = 0'); }
  else if (req.query.status === 'LOW_STOCK')    { filters.push('p.stock > 0 AND p.stock < 10'); }

  const where = ` WHERE ${filters.join(' AND ')}`;
  const orderBy = sortBy === 'created_at' ? 'p.created_at' : sortBy === 'name' ? 'p.name' : sortBy === 'price' ? 'p.price' : 'p.stock';

  const total = db.prepare(`SELECT COUNT(*) count FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN product_types pt ON pt.id = p.product_type_id${where}`).get(...params).count;
  const rows  = db.prepare(`${productSelect}${where} ORDER BY ${orderBy} ${sortOrder} LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit).map(mapProduct);

  res.json({ data: rows, page, limit, total, pages: Math.ceil(total / limit) }); 
});
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

// Security: Global error handler (must be last)
app.use(security.errorHandler);

const httpServer = app.listen(port, () => console.log(`Catalog API listening on http://localhost:${port}`));
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  httpServer.close(() => {
    try { db.close(); } catch (error) { console.error('[shutdown] database close failed', error.message); }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
