PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('ADMIN', 'CUSTOMER')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
  image_url TEXT,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_status_order ON categories(status, sort_order);

CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  logo_url TEXT,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_brands_status ON brands(status);

CREATE TABLE IF NOT EXISTS product_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(category_id, name)
);

CREATE TABLE IF NOT EXISTS attributes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0,
  filterable INTEGER NOT NULL DEFAULT 0,
  searchable INTEGER NOT NULL DEFAULT 0,
  options_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(category_id, name)
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  brand_id INTEGER REFERENCES brands(id) ON DELETE RESTRICT,
  product_type_id INTEGER REFERENCES product_types(id) ON DELETE RESTRICT,
  description TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL CHECK (price >= 0),
  mrp REAL NOT NULL CHECK (mrp >= 0),
  discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  unit TEXT NOT NULL DEFAULT 'Nos',
  image_url TEXT,
  image_urls_json TEXT NOT NULL DEFAULT '[]',
  attributes_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_type ON products(product_type_id);
CREATE INDEX IF NOT EXISTS idx_products_status_created ON products(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL,
  total_rows INTEGER NOT NULL DEFAULT 0,
  processed_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
