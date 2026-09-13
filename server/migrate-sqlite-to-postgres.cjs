const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('node:sqlite');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const sqlitePath = process.env.SQLITE_SOURCE_PATH || path.join(root, 'server/data/catalog.sqlite');
const postgresUrl = process.env.DATABASE_URL;

if (!postgresUrl) {
  throw new Error('Production DATABASE_URL is required for SQLite-to-Postgres migration.');
}

if (!fs.existsSync(sqlitePath)) {
  throw new Error(`SQLite source database not found: ${sqlitePath}`);
}

const sqliteDb = new sqlite3.DatabaseSync(sqlitePath);
const pg = new Client({ connectionString: postgresUrl, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false });

function readTable(table) {
  return sqliteDb.prepare(`SELECT * FROM ${table}`).all();
}

function countRows(table) {
  const row = sqliteDb.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
  return Number(row?.count || 0);
}

async function ensureSchema() {
  const schemaSql = `
    CREATE TABLE IF NOT EXISTS users (
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
    );

    CREATE TABLE IF NOT EXISTS addresses (
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
    );

    CREATE TABLE IF NOT EXISTS categories (
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
    );

    CREATE TABLE IF NOT EXISTS brands (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      logo_url TEXT,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS product_types (
      id SERIAL PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(category_id, name)
    );

    CREATE TABLE IF NOT EXISTS attributes (
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
      UNIQUE(category_id, name)
    );

    CREATE TABLE IF NOT EXISTS products (
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
    );

    CREATE TABLE IF NOT EXISTS orders (
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
    );

    CREATE TABLE IF NOT EXISTS order_items (
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
    );

    CREATE TABLE IF NOT EXISTS settings (
      id SERIAL PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS import_jobs (
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
    );

    CREATE INDEX IF NOT EXISTS idx_addresses_customer ON addresses(customer_id, is_default DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id, product_id);
    CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
    CREATE INDEX IF NOT EXISTS idx_categories_status_order ON categories(status, sort_order);
    CREATE INDEX IF NOT EXISTS idx_brands_status ON brands(status);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id);
    CREATE INDEX IF NOT EXISTS idx_products_type ON products(product_type_id);
    CREATE INDEX IF NOT EXISTS idx_products_status_created ON products(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_mobile_number ON users(mobile_number) WHERE mobile_number IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number) WHERE order_number IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
  `;

  await pg.query(schemaSql);
}

async function syncSequences() {
  const tables = ['users', 'addresses', 'categories', 'brands', 'product_types', 'attributes', 'products', 'orders', 'order_items', 'settings', 'import_jobs'];
  for (const tableName of tables) {
    try {
      await pg.query(`SELECT setval(pg_get_serial_sequence('${tableName}', 'id'), COALESCE((SELECT MAX(id) FROM ${tableName}) + 1, 1), false) WHERE EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = '${tableName}' AND column_name = 'id');`);
    } catch (error) {
      console.warn(`[migration] Sequence sync skipped for ${tableName}: ${error.message || error}`);
    }
  }
}

function normalizeText(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function tableIdentity(table, row) {
  switch (table) {
    case 'users': {
      const email = normalizeText(row.email);
      const mobile = normalizePhone(row.mobile_number || row.mobile || '');
      return email ? `email:${email}` : `mobile:${mobile}`;
    }
    case 'categories':
      return `slug:${normalizeText(row.slug || row.name)}`;
    case 'brands':
      return `slug:${normalizeText(row.slug || row.name)}`;
    case 'product_types':
      return `category:${Number(row.category_id || 0)}|name:${normalizeText(row.name)}`;
    case 'attributes':
      return `category:${Number(row.category_id || 0)}|name:${normalizeText(row.name)}`;
    case 'products':
      return `sku:${normalizeText(row.sku || row.code || row.name)}`;
    case 'addresses':
      return `customer:${Number(row.customer_id || 0)}|full:${normalizeText(row.full_name)}|phone:${normalizePhone(row.phone)}|line1:${normalizeText(row.address_line1)}|city:${normalizeText(row.city)}`;
    case 'orders':
      return row.order_number ? `order_number:${normalizeText(row.order_number)}` : `legacy:${Number(row.customer_id || 0)}|${normalizeText(row.customer_name)}|${String(row.created_at || '').trim()}`;
    case 'order_items':
      return `order:${Number(row.order_id || 0)}|product:${Number(row.product_id || 0)}|qty:${Number(row.quantity || 0)}`;
    case 'settings':
      return `key:${normalizeText(row.key)}`;
    case 'import_jobs':
      return `status:${normalizeText(row.status)}|created:${String(row.created_at || '').trim()}`;
    default:
      return `id:${Number(row.id || 0)}`;
  }
}

function buildNormalizedRow(table, row, fallbackId) {
  const normalized = { ...row };

  if (table === 'orders') {
    const fallbackNumber = `MH-${String(fallbackId || normalized.id || Date.now()).padStart(6, '0')}`;
    normalized.order_number = normalized.order_number || fallbackNumber;
    normalized.customer_email = normalized.customer_email ?? '';
    normalized.customer_phone = normalized.customer_phone ?? '';
    normalized.status = normalized.status || 'PENDING';
    normalized.payment_method = normalized.payment_method || 'Cash on Delivery';
    normalized.payment_status = normalized.payment_status || 'PENDING';
    normalized.delivery_address_json = normalized.delivery_address_json || '{}';
    normalized.notification_status = normalized.notification_status || 'PENDING';
  }

  if (table === 'products') {
    normalized.sku = normalized.sku || `GENERATED-${fallbackId || normalized.id || Date.now()}`;
    normalized.slug = normalized.slug || `${String(normalized.name || 'product').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${fallbackId || normalized.id || Date.now()}`;
  }

  return normalized;
}

async function migrate() {
  await pg.connect();
  await ensureSchema();

  const tables = [
    'categories',
    'brands',
    'product_types',
    'attributes',
    'products',
    'users',
    'addresses',
    'orders',
    'order_items',
    'settings',
    'import_jobs',
  ];

  const sqliteCounts = Object.fromEntries(tables.map((table) => [table, countRows(table)]));
  console.log('SQLite counts:', sqliteCounts);

  const rows = {
    categories: readTable('categories'),
    brands: readTable('brands'),
    product_types: readTable('product_types'),
    attributes: readTable('attributes'),
    products: readTable('products'),
    users: readTable('users'),
    addresses: readTable('addresses'),
    orders: readTable('orders'),
    order_items: readTable('order_items'),
    settings: readTable('settings'),
    import_jobs: readTable('import_jobs'),
  };

  await pg.query('BEGIN');
  try {
    for (const table of tables) {
      const sourceRows = rows[table] || [];
      if (!sourceRows.length) continue;

      const targetRows = await pg.query(`SELECT * FROM ${table}`).then((result) => result.rows);
      const targetIdentityMap = new Map();
      for (const row of targetRows) {
        const identity = tableIdentity(table, row);
        if (identity) targetIdentityMap.set(identity, row);
      }

      const usedIds = new Set(targetRows.map((row) => Number(row.id || 0)).filter((id) => Number.isFinite(id) && id > 0));
      let nextAvailableId = Math.max(0, ...targetRows.map((row) => Number(row.id || 0)).filter((id) => Number.isFinite(id) && id > 0)) + 1;

      for (const row of sourceRows) {
        const identity = tableIdentity(table, row);
        if (targetIdentityMap.has(identity)) {
          console.log('[migration] preserving existing target row', { table, identity });
          continue;
        }

        const sourceId = Number(row.id || 0);
        const nextId = sourceId && sourceId > 0 && !usedIds.has(sourceId) && !targetRows.some((targetRow) => Number(targetRow.id || 0) === sourceId) ? sourceId : nextAvailableId;
        usedIds.add(nextId);
        nextAvailableId = Math.max(nextAvailableId, nextId + 1);

        const normalizedRow = buildNormalizedRow(table, row, nextId);
        const rawColumns = Object.keys(normalizedRow).filter((column) => column !== 'id');
        const finalInsertColumns = [...rawColumns, 'id'];
        const insertValues = [...rawColumns.map((key) => normalizedRow[key]), nextId];
        const insertSql = `INSERT INTO ${table} (${finalInsertColumns.join(', ')}) VALUES (${finalInsertColumns.map((_, idx) => `$${idx + 1}`).join(', ')})`;

        await pg.query(insertSql, insertValues);
        console.log('[migration] inserted row', { table, id: nextId, identity });
      }
    }

    await pg.query('COMMIT');
  } catch (error) {
    await pg.query('ROLLBACK');
    throw error;
  }

  const postgresCounts = Object.fromEntries(await Promise.all(tables.map(async (table) => {
    const res = await pg.query(`SELECT COUNT(*) AS count FROM ${table}`);
    return [table, Number(res.rows[0].count || 0)];
  })));

  console.log('PostgreSQL counts:', postgresCounts);
  const mismatches = tables.filter((table) => sqliteCounts[table] !== postgresCounts[table]);
  if (mismatches.length) {
    console.log('[migration] count differences remain:', mismatches.map((table) => ({ table, sqlite: sqliteCounts[table], neon: postgresCounts[table] })));
  }

  console.log('Migration completed successfully.');
}

(async () => {
  try {
    await migrate();
  } catch (error) {
    console.error('SQLite-to-Postgres migration failed:');
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  } finally {
    sqliteDb.close();
    await pg.end();
  }
})();
