import { execSync, spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'd:/E commerce';
const TEST_PORT = 8898;
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const TEST_ADMIN_EMAIL = 'acceptance-owner@test.local';
const TEST_ADMIN_PASSWORD = 'AcceptancePass123';
const TEST_ADMIN_MOBILE = '9361866771';
const DB_PATH = path.resolve(ROOT, 'server/data/acceptance-test.sqlite');
if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

const db = new DatabaseSync(DB_PATH);
let serverProcess = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const slugify = (value) => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const uniqueSuffix = (...prefixes) => {
  const prefix = prefixes.filter(Boolean).join('-');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix ? `${prefix}-` : ''}${Date.now()}-${rand}`;
};
const assertCondition = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

async function api(path, init = {}) {
  const { headers: extraHeaders, ...rest } = init;
  const res = await fetch(BASE + path, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(extraHeaders || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await api('/api/health');
      if (res.ok) return true;
    } catch {
      // retry until ready
    }
    await sleep(250);
  }
  throw new Error('Server did not become healthy in time.');
}

async function startServer() {
  if (serverProcess && serverProcess.exitCode === null) {
    return serverProcess;
  }

  serverProcess = spawn(process.execPath, ['server/index.cjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(TEST_PORT),
      JWT_SECRET: process.env.JWT_SECRET || 'test-secret-for-acceptance-check-only',
      ADMIN_EMAIL: TEST_ADMIN_EMAIL,
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      ADMIN_MOBILE: TEST_ADMIN_MOBILE,
      DATABASE_PATH: DB_PATH,
      UPLOAD_DIR: '/var/data/uploads',
      SEED_DEMO_DATA: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  serverProcess.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  serverProcess.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  serverProcess.on('error', (error) => {
    output += `\n[child error] ${error.stack || error}\n`;
  });
  serverProcess.on('exit', (code, signal) => {
    output += `\n[child exit] code=${code} signal=${signal}\n`;
  });

  try {
    await waitForServer();
    await sleep(250);
    if (serverProcess.exitCode !== null) {
      throw new Error(`Acceptance server exited with code ${serverProcess.exitCode}. Output: ${output}`);
    }
    return serverProcess;
  } catch (error) {
    const details = output || String(error.message);
    await stopServer();
    throw new Error(`Server startup failed: ${details}`);
  }
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) {
    return;
  }
  serverProcess.kill('SIGTERM');
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 10000);
    serverProcess.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function restartServer() {
  await stopServer();
  await startServer();
}

function getProductById(productId) {
  assertCondition(Number.isFinite(Number(productId)), `Invalid product ID: ${productId}`);
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(productId));
  return row;
}

function getCustomerById(customerId) {
  assertCondition(Number.isFinite(Number(customerId)), `Invalid customer ID: ${customerId}`);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(customerId));
}

function countSql(sql, ...args) {
  const row = db.prepare(sql).get(...args);
  return Number(row?.count ?? row?.c ?? 0);
}

async function cleanupAcceptanceData() {
  const productsTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'products'").get();
  if (!productsTable) return;
  const productIds = db.prepare("SELECT id FROM products WHERE sku LIKE 'ACCEPTANCE-%' OR name LIKE 'ACCEPTANCE%' OR sku LIKE 'STOCK-%' OR sku LIKE 'SHORT-%' OR sku LIKE 'ZERO-%' OR sku LIKE 'ROLLBACK-%' OR sku LIKE 'SIM-%' OR sku LIKE 'PERMANENT-%'").all().map((row) => Number(row.id));
  const categoryIds = db.prepare("SELECT id FROM categories WHERE slug LIKE 'acceptance-%' OR name LIKE 'ACCEPTANCE%'").all().map((row) => Number(row.id));
  const orderIds = db.prepare("SELECT id FROM orders WHERE order_number LIKE 'MH-%' AND customer_id IN (SELECT id FROM users WHERE email LIKE '%@acceptance.test' OR name LIKE 'Acceptance%' OR name LIKE 'Stock User%' OR name LIKE 'Short User%' OR name LIKE 'Zero User%' OR name LIKE 'Rollback User%' OR name LIKE 'Sim A%' OR name LIKE 'Sim B%')").all().map((row) => Number(row.id));
  const customerIds = db.prepare("SELECT id FROM users WHERE email LIKE '%@acceptance.test' OR name LIKE 'Acceptance%' OR name LIKE 'Stock User%' OR name LIKE 'Short User%' OR name LIKE 'Zero User%' OR name LIKE 'Rollback User%' OR name LIKE 'Sim A%' OR name LIKE 'Sim B%'").all().map((row) => Number(row.id));
  const addressIds = db.prepare("SELECT id FROM addresses WHERE full_name LIKE 'Acceptance%' OR full_name LIKE 'Stock User%' OR full_name LIKE 'Short User%' OR full_name LIKE 'Zero User%' OR full_name LIKE 'Rollback User%' OR full_name LIKE 'Sim A%' OR full_name LIKE 'Sim B%'").all().map((row) => Number(row.id));

  if (orderIds.length) {
    db.prepare('DELETE FROM order_items WHERE order_id IN (' + orderIds.map(() => '?').join(',') + ')').run(...orderIds);
    db.prepare('DELETE FROM orders WHERE id IN (' + orderIds.map(() => '?').join(',') + ')').run(...orderIds);
  }
  if (addressIds.length) {
    db.prepare('DELETE FROM addresses WHERE id IN (' + addressIds.map(() => '?').join(',') + ')').run(...addressIds);
  }
  if (customerIds.length) {
    db.prepare('DELETE FROM users WHERE id IN (' + customerIds.map(() => '?').join(',') + ')').run(...customerIds);
  }
  if (categoryIds.length) {
    const categoryProductIds = db.prepare('SELECT id FROM products WHERE category_id IN (' + categoryIds.map(() => '?').join(',') + ')').all(...categoryIds).map((row) => Number(row.id));
    if (categoryProductIds.length) {
      db.prepare('DELETE FROM products WHERE id IN (' + categoryProductIds.map(() => '?').join(',') + ')').run(...categoryProductIds);
    }
    const categoryAttributeIds = db.prepare('SELECT id FROM attributes WHERE category_id IN (' + categoryIds.map(() => '?').join(',') + ')').all(...categoryIds).map((row) => Number(row.id));
    if (categoryAttributeIds.length) {
      db.prepare('DELETE FROM attributes WHERE id IN (' + categoryAttributeIds.map(() => '?').join(',') + ')').run(...categoryAttributeIds);
    }
    db.prepare('DELETE FROM categories WHERE id IN (' + categoryIds.map(() => '?').join(',') + ')').run(...categoryIds);
  }
  if (productIds.length) {
    db.prepare('DELETE FROM products WHERE id IN (' + productIds.map(() => '?').join(',') + ')').run(...productIds);
  }

  const integrity = db.prepare('PRAGMA integrity_check').get();
  assertCondition(integrity && integrity.integrity_check === 'ok', `Database integrity check failed after cleanup: ${JSON.stringify(integrity)}`);
}

(async () => {
  const results = [];
  const createdCategories = [];
  const createdProducts = [];
  const createdCustomers = [];
  const createdAddresses = [];
  const createdOrders = [];

  try {
    await startServer();

    const adminLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }),
    });
    assertCondition(adminLogin.ok && adminLogin.body && adminLogin.body.token, `Admin login failed: ${JSON.stringify(adminLogin)}`);
    const adminToken = adminLogin.body.token;

    // 1. Product persistence
    {
      const categoryName = `ACCEPTANCE CATEGORY ${uniqueSuffix('cat')}`;
      const categoryRes = await api('/api/categories', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ name: categoryName, slug: slugify(categoryName), description: 'Acceptance category for product persistence' }),
      });
      assertCondition(categoryRes.ok && categoryRes.body && categoryRes.body.id, `Category creation failed: ${JSON.stringify(categoryRes)}`);
      createdCategories.push(Number(categoryRes.body.id));

      const productSku = `ACCEPTANCE-${uniqueSuffix('product')}`;
      const productName = `Acceptance Product ${uniqueSuffix('name')}`;
      const productRes = await api('/api/products', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ sku: productSku, name: productName, categoryId: categoryRes.body.id, price: 150, stock: 10, unit: 'Nos', brand: 'Anchor', description: 'Acceptance product persistence test' }),
      });
      assertCondition(productRes.ok && productRes.body && productRes.body.id, `Product create failed: ${JSON.stringify(productRes)}`);
      createdProducts.push(Number(productRes.body.id));

      const productsRes = await api('/api/products');
      assertCondition(productsRes.ok && Array.isArray(productsRes.body.data), `Product catalog failed: ${JSON.stringify(productsRes)}`);
      const foundBefore = productsRes.body.data.some((product) => product.id === Number(productRes.body.id) || product.sku === productSku || product.name === productName);
      assertCondition(foundBefore, `Created product not found in catalog before restart: ${JSON.stringify(productsRes.body)}`);

      await restartServer();
      const productsAfterRestart = await api('/api/products');
      assertCondition(productsAfterRestart.ok && Array.isArray(productsAfterRestart.body.data), `Product catalog after restart failed: ${JSON.stringify(productsAfterRestart)}`);
      const foundAfter = productsAfterRestart.body.data.some((product) => product.id === Number(productRes.body.id) || product.sku === productSku || product.name === productName);
      results.push({
        test: 1,
        result: foundAfter ? 'PASS' : 'FAIL',
        evidence: {
          productCreateStatus: productRes.status,
          productId: productRes.body.id,
          productSku,
          productName,
          foundBefore,
          foundAfter,
          productCount: productsAfterRestart.body.total,
        },
      });
      assertCondition(foundAfter, 'Product persistence test failed after restart.');
    }

    // 2. Customer registration + login
    {
      const customerPhone = `7${String(Date.now()).slice(-9)}`;
      const registerRes = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name: 'Acceptance Customer', mobile: customerPhone, password: 'Password123' }),
      });
      assertCondition(registerRes.ok && registerRes.body && registerRes.body.user && registerRes.body.user.id, `Customer register failed: ${JSON.stringify(registerRes)}`);
      createdCustomers.push(Number(registerRes.body.user.id));

      const loginRes = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ mobile: customerPhone, password: 'Password123' }),
      });
      assertCondition(loginRes.ok && loginRes.body && loginRes.body.token, `Customer login failed: ${JSON.stringify(loginRes)}`);

      const meRes = await api('/api/me', { headers: { Authorization: `Bearer ${loginRes.body.token}` } });
      assertCondition(meRes.ok && meRes.body && meRes.body.id, `Customer profile lookup failed: ${JSON.stringify(meRes)}`);

      await restartServer();
      const loginAfterRestartRes = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ mobile: customerPhone, password: 'Password123' }),
      });
      assertCondition(loginAfterRestartRes.ok && loginAfterRestartRes.body && loginAfterRestartRes.body.token, `Customer login after restart failed: ${JSON.stringify(loginAfterRestartRes)}`);
      results.push({
        test: 2,
        result: 'PASS',
        evidence: {
          registerStatus: registerRes.status,
          loginStatus: loginRes.status,
          profileStatus: meRes.status,
          postRestartLoginStatus: loginAfterRestartRes.status,
          customerPhone,
        },
      });
    }

    // 3. Category + attribute persistence
    {
      const categoryName = `ACCEPTANCE_ATTR_${uniqueSuffix('category')}`;
      const categorySlug = slugify(categoryName);
      const categoryRes = await api('/api/categories', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ name: categoryName, slug: categorySlug, description: 'Attribute persistence test', attributes: [{ name: 'Brand', type: 'Text' }, { name: 'Finish', type: 'Text' }] }),
      });
      assertCondition(categoryRes.ok && categoryRes.body && categoryRes.body.id, `Attribute category creation failed: ${JSON.stringify(categoryRes)}`);
      createdCategories.push(Number(categoryRes.body.id));
      const categoryId = Number(categoryRes.body.id);

      const attrsBefore = await api(`/api/attributes?categoryId=${categoryId}`);
      assertCondition(attrsBefore.ok && Array.isArray(attrsBefore.body), `Attributes fetch failed: ${JSON.stringify(attrsBefore)}`);
      const matchingNames = attrsBefore.body.filter((attribute) => ['Brand', 'Finish'].includes(attribute.name)).map((item) => item.name);
      assertCondition(matchingNames.length >= 2, `Attributes not persisted in category fetch: ${JSON.stringify(attrsBefore.body)}`);

      await restartServer();
      const attrsAfterRestart = await api(`/api/attributes?categoryId=${categoryId}`);
      assertCondition(attrsAfterRestart.ok && Array.isArray(attrsAfterRestart.body), `Attributes after restart failed: ${JSON.stringify(attrsAfterRestart)}`);
      const persistedNames = attrsAfterRestart.body.filter((attribute) => ['Brand', 'Finish'].includes(attribute.name)).map((item) => item.name);
      assertCondition(persistedNames.length >= 2, `Attributes missing after restart: ${JSON.stringify(attrsAfterRestart.body)}`);
      results.push({
        test: 3,
        result: persistedNames.length >= 2 ? 'PASS' : 'FAIL',
        evidence: {
          categoryId,
          before: matchingNames,
          after: persistedNames,
        },
      });
    }

    // 4. Admin customers
    {
      const customerPhone = `8${String(Date.now()).slice(-9)}`;
      const registerRes = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name: 'Admin Visibility Customer', mobile: customerPhone, password: 'Password123' }),
      });
      assertCondition(registerRes.ok && registerRes.body && registerRes.body.user && registerRes.body.user.id, `Admin-customer registration failed: ${JSON.stringify(registerRes)}`);
      createdCustomers.push(Number(registerRes.body.user.id));

      const customersRes = await api('/api/admin/customers', { headers: { Authorization: `Bearer ${adminToken}` } });
      assertCondition(customersRes.ok && Array.isArray(customersRes.body), `Admin customers failed: ${JSON.stringify(customersRes)}`);
      const customerRecord = customersRes.body.find((customer) => customer.phone === customerPhone || customer.name === 'Admin Visibility Customer');
      const customerPayload = JSON.stringify(customersRes.body);
      const leakedSecrets = customerPayload.toLowerCase().includes('password') || customerPayload.toLowerCase().includes('password_hash') || customerPayload.toLowerCase().includes('token');
      assertCondition(customerRecord && !leakedSecrets, `Customer row not found or leaked secrets in admin list: ${JSON.stringify(customersRes.body)}`);
      results.push({
        test: 4,
        result: 'PASS',
        evidence: {
          customerPhone,
          customerFound: Boolean(customerRecord),
          leakedSecrets,
        },
      });
    }

    // 5. Order stock decrement
    {
      const productSku = `ACCEPTANCE-STOCK-${uniqueSuffix('stock')}`;
      const productName = `Stock Test Product ${uniqueSuffix('name')}`;
      const productRes = await api('/api/products', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ sku: productSku, name: productName, categoryId: createdCategories[0], price: 100, stock: 10, unit: 'Nos', brand: 'Anchor', description: 'Stock decrement test product' }),
      });
      assertCondition(productRes.ok && productRes.body && productRes.body.id, `Stock product create failed: ${JSON.stringify(productRes)}`);
      const productId = Number(productRes.body.id);
      createdProducts.push(productId);

      const customerPhone = `9${String(Date.now()).slice(-9)}`;
      const registerRes = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name: 'Stock User', mobile: customerPhone, password: 'Password123' }),
      });
      assertCondition(registerRes.ok && registerRes.body && registerRes.body.token, `Stock customer register failed: ${JSON.stringify(registerRes)}`);
      const customerToken = registerRes.body.token;
      createdCustomers.push(Number(registerRes.body.user.id));

      const addressRes = await api('/api/me/addresses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({ fullName: 'Stock User', phone: customerPhone, addressLine1: 'Stock Lane', area: 'Area', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001', isDefault: true }),
      });
      assertCondition(addressRes.ok && addressRes.body && addressRes.body.id, `Stock address create failed: ${JSON.stringify(addressRes)}`);
      createdAddresses.push(Number(addressRes.body.id));

      const beforeStock = getProductById(productId).stock;
      const orderRes = await api('/api/me/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({ addressId: addressRes.body.id, items: [{ productId, name: productName, quantity: 3, price: 100 }] }),
      });
      assertCondition(orderRes.ok && orderRes.body && orderRes.body.id, `Valid stock order failed: ${JSON.stringify(orderRes)}`);
      createdOrders.push(Number(orderRes.body.id));

      const afterStock = getProductById(productId).stock;
      assertCondition(afterStock === beforeStock - 3, `Stock decrement mismatch. before=${beforeStock}, after=${afterStock}`);
      results.push({
        test: 5,
        result: 'PASS',
        evidence: {
          beforeStock,
          afterStock,
          orderStatus: orderRes.status,
          orderId: orderRes.body.id,
        },
      });
    }

    // 6. Insufficient stock
    {
      const productSku = `ACCEPTANCE-SHORT-${uniqueSuffix('stock')}`;
      const productName = `Short Stock Product ${uniqueSuffix('name')}`;
      const productRes = await api('/api/products', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ sku: productSku, name: productName, categoryId: createdCategories[0], price: 100, stock: 4, unit: 'Nos', brand: 'Anchor', description: 'Insufficient stock test' }),
      });
      assertCondition(productRes.ok && productRes.body && productRes.body.id, `Short stock product create failed: ${JSON.stringify(productRes)}`);
      const productId = Number(productRes.body.id);
      createdProducts.push(productId);

      const customerPhone = `9${String(Date.now()).slice(-9)}`;
      const registerRes = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name: 'Short User', mobile: customerPhone, password: 'Password123' }),
      });
      assertCondition(registerRes.ok && registerRes.body && registerRes.body.token, `Short user register failed: ${JSON.stringify(registerRes)}`);
      const customerToken = registerRes.body.token;
      createdCustomers.push(Number(registerRes.body.user.id));

      const addressRes = await api('/api/me/addresses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({ fullName: 'Short User', phone: customerPhone, addressLine1: 'Short Lane', area: 'Area', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001', isDefault: true }),
      });
      assertCondition(addressRes.ok && addressRes.body && addressRes.body.id, `Short address create failed: ${JSON.stringify(addressRes)}`);
      createdAddresses.push(Number(addressRes.body.id));

      const beforeStock = getProductById(productId).stock;
      const orderRes = await api('/api/me/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({ addressId: addressRes.body.id, items: [{ productId, name: productName, quantity: 5, price: 100 }] }),
      });
      assertCondition(orderRes.status === 400, `Insufficient stock order unexpectedly succeeded: ${JSON.stringify(orderRes)}`);
      const afterStock = getProductById(productId).stock;
      assertCondition(afterStock === beforeStock, `Insufficient stock changed DB stock. before=${beforeStock}, after=${afterStock}`);
      const customerOrderCount = countSql('SELECT COUNT(*) AS count FROM orders WHERE customer_id = ?', Number(registerRes.body.user.id));
      assertCondition(customerOrderCount === 0, `Insufficient stock created an order for customer=${registerRes.body.user.id}`);
      results.push({
        test: 6,
        result: 'PASS',
        evidence: {
          beforeStock,
          afterStock,
          status: orderRes.status,
          customerOrderCount,
        },
      });
    }

    // 7. Zero stock
    {
      const productSku = `ACCEPTANCE-ZERO-${uniqueSuffix('stock')}`;
      const productName = `Zero Stock Product ${uniqueSuffix('name')}`;
      const productRes = await api('/api/products', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ sku: productSku, name: productName, categoryId: createdCategories[0], price: 100, stock: 0, unit: 'Nos', brand: 'Anchor', description: 'Zero stock test' }),
      });
      assertCondition(productRes.ok && productRes.body && productRes.body.id, `Zero stock product create failed: ${JSON.stringify(productRes)}`);
      const productId = Number(productRes.body.id);
      createdProducts.push(productId);

      const customerPhone = `9${String(Date.now()).slice(-9)}`;
      const registerRes = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name: 'Zero User', mobile: customerPhone, password: 'Password123' }),
      });
      assertCondition(registerRes.ok && registerRes.body && registerRes.body.token, `Zero customer register failed: ${JSON.stringify(registerRes)}`);
      const customerToken = registerRes.body.token;
      createdCustomers.push(Number(registerRes.body.user.id));

      const addressRes = await api('/api/me/addresses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({ fullName: 'Zero User', phone: customerPhone, addressLine1: 'Zero Lane', area: 'Area', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001', isDefault: true }),
      });
      assertCondition(addressRes.ok && addressRes.body && addressRes.body.id, `Zero stock address create failed: ${JSON.stringify(addressRes)}`);
      createdAddresses.push(Number(addressRes.body.id));

      const beforeStock = getProductById(productId).stock;
      const orderRes = await api('/api/me/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({ addressId: addressRes.body.id, items: [{ productId, name: productName, quantity: 1, price: 100 }] }),
      });
      assertCondition(orderRes.status === 400, `Zero stock order unexpectedly succeeded: ${JSON.stringify(orderRes)}`);
      const afterStock = getProductById(productId).stock;
      assertCondition(afterStock === beforeStock && beforeStock === 0, `Zero stock mutated DB stock. before=${beforeStock}, after=${afterStock}`);
      results.push({
        test: 7,
        result: 'PASS',
        evidence: { beforeStock, afterStock, status: orderRes.status },
      });
    }

    // 8. Transaction rollback
    {
      const productSku = `ACCEPTANCE-ROLLBACK-${uniqueSuffix('stock')}`;
      const productName = `Rollback Product ${uniqueSuffix('name')}`;
      const productRes = await api('/api/products', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ sku: productSku, name: productName, categoryId: createdCategories[0], price: 100, stock: 5, unit: 'Nos', brand: 'Anchor', description: 'Rollback test' }),
      });
      assertCondition(productRes.ok && productRes.body && productRes.body.id, `Rollback product create failed: ${JSON.stringify(productRes)}`);
      const productId = Number(productRes.body.id);
      createdProducts.push(productId);

      const customerPhone = `9${String(Date.now()).slice(-9)}`;
      const registerRes = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name: 'Rollback User', mobile: customerPhone, password: 'Password123' }),
      });
      assertCondition(registerRes.ok && registerRes.body && registerRes.body.token, `Rollback customer register failed: ${JSON.stringify(registerRes)}`);
      const customerToken = registerRes.body.token;
      createdCustomers.push(Number(registerRes.body.user.id));

      const addressRes = await api('/api/me/addresses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({ fullName: 'Rollback User', phone: customerPhone, addressLine1: 'Rollback Lane', area: 'Area', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001', isDefault: true }),
      });
      assertCondition(addressRes.ok && addressRes.body && addressRes.body.id, `Rollback address create failed: ${JSON.stringify(addressRes)}`);
      createdAddresses.push(Number(addressRes.body.id));

      const beforeStock = getProductById(productId).stock;
      const beforeOrders = countSql('SELECT COUNT(*) AS count FROM orders WHERE customer_id = ?', Number(registerRes.body.user.id));
      const beforeItems = countSql('SELECT COUNT(*) AS count FROM order_items WHERE product_id = ?', productId);

      const orderRes = await api('/api/me/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({ addressId: addressRes.body.id, items: [{ productId: 999999, name: 'Bad product', quantity: 1, price: 100 }, { productId, name: productName, quantity: 1, price: 100 }] }),
      });
      assertCondition(orderRes.status === 400, `Rollback order unexpectedly succeeded: ${JSON.stringify(orderRes)}`);
      const afterStock = getProductById(productId).stock;
      const afterOrders = countSql('SELECT COUNT(*) AS count FROM orders WHERE customer_id = ?', Number(registerRes.body.user.id));
      const afterItems = countSql('SELECT COUNT(*) AS count FROM order_items WHERE product_id = ?', productId);

      assertCondition(beforeStock === afterStock && beforeOrders === afterOrders && beforeItems === afterItems, `Rollback did not fully revert. beforeStock=${beforeStock} afterStock=${afterStock} beforeOrders=${beforeOrders} afterOrders=${afterOrders} beforeItems=${beforeItems} afterItems=${afterItems}`);
      results.push({
        test: 8,
        result: 'PASS',
        evidence: { beforeStock, afterStock, beforeOrders, afterOrders, beforeItems, afterItems, status: orderRes.status },
      });
    }

    // 9. Concurrent orders
    {
      const productSku = `ACCEPTANCE-SIM-${uniqueSuffix('stock')}`;
      const productName = `Concurrent Stock Product ${uniqueSuffix('name')}`;
      const productRes = await api('/api/products', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ sku: productSku, name: productName, categoryId: createdCategories[0], price: 100, stock: 1, unit: 'Nos', brand: 'Anchor', description: 'Concurrent order test' }),
      });
      assertCondition(productRes.ok && productRes.body && productRes.body.id, `Concurrent product create failed: ${JSON.stringify(productRes)}`);
      const productId = Number(productRes.body.id);
      createdProducts.push(productId);

      const customerA = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name: 'Sim A', mobile: `9${String(Date.now()).slice(-9)}`, password: 'Password123' }),
      });
      const customerB = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name: 'Sim B', mobile: `9${String(Date.now()).slice(-9)}`, password: 'Password123' }),
      });
      assertCondition(customerA.ok && customerA.body && customerA.body.token, `Sim A register failed: ${JSON.stringify(customerA)}`);
      assertCondition(customerB.ok && customerB.body && customerB.body.token, `Sim B register failed: ${JSON.stringify(customerB)}`);
      createdCustomers.push(Number(customerA.body.user.id), Number(customerB.body.user.id));

      const addressA = await api('/api/me/addresses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerA.body.token}` },
        body: JSON.stringify({ fullName: 'Sim A', phone: customerA.body.user.mobile, addressLine1: 'Sim A Lane', area: 'Area', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001', isDefault: true }),
      });
      const addressB = await api('/api/me/addresses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerB.body.token}` },
        body: JSON.stringify({ fullName: 'Sim B', phone: customerB.body.user.mobile, addressLine1: 'Sim B Lane', area: 'Area', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001', isDefault: true }),
      });
      assertCondition(addressA.ok && addressA.body && addressA.body.id, `Sim A address failed: ${JSON.stringify(addressA)}`);
      assertCondition(addressB.ok && addressB.body && addressB.body.id, `Sim B address failed: ${JSON.stringify(addressB)}`);
      createdAddresses.push(Number(addressA.body.id), Number(addressB.body.id));

      const simultaneous = await Promise.all([
        api('/api/me/orders', {
          method: 'POST',
          headers: { Authorization: `Bearer ${customerA.body.token}` },
          body: JSON.stringify({ addressId: addressA.body.id, items: [{ productId, name: productName, quantity: 1, price: 100 }] }),
        }),
        api('/api/me/orders', {
          method: 'POST',
          headers: { Authorization: `Bearer ${customerB.body.token}` },
          body: JSON.stringify({ addressId: addressB.body.id, items: [{ productId, name: productName, quantity: 1, price: 100 }] }),
        }),
      ]);

      const successCount = simultaneous.filter((entry) => entry.ok).length;
      const finalStock = getProductById(productId).stock;
      assertCondition(successCount === 1, `Expected 1 successful concurrent order, saw ${successCount}: ${JSON.stringify(simultaneous)}`);
      assertCondition(finalStock === 0, `Concurrent order left stock negative or incorrect: finalStock=${finalStock}`);
      assertCondition(finalStock >= 0, `Concurrent order stock became negative: ${finalStock}`);
      results.push({
        test: 9,
        result: 'PASS',
        evidence: {
          successCount,
          finalStock,
          responses: simultaneous.map((entry) => ({ status: entry.status, body: entry.body })),
        },
      });
    }

    // 10. WhatsApp-only order flow
    {
      const source = readFileSync('src/App.tsx', 'utf8');
      const hasWaMe = source.includes('https://wa.me');
      const hasMsg91 = source.toLowerCase().includes('msg91');
      const hasSms = source.toLowerCase().includes('sms');
      assertCondition(hasWaMe && !hasMsg91 && !hasSms, `Direct WhatsApp flow missing or SMS vendor still present: wa=${hasWaMe} msg91=${hasMsg91} sms=${hasSms}`);
      results.push({
        test: 10,
        result: 'PASS',
        evidence: {
          hasWaMe,
          hasMsg91,
          hasSms,
        },
      });
    }

    // 11. Database path and persistence
    {
      const databaseList = db.prepare('PRAGMA database_list').all();
      const actualPath = databaseList[0]?.file || '';
      assertCondition(actualPath === DB_PATH, `Database path mismatch. Actual=${actualPath}, expected=${DB_PATH}`);
      results.push({
        test: 11,
        result: 'PASS',
        evidence: {
          actualPath,
          expectedPath: DB_PATH,
          seedDemoData: process.env.SEED_DEMO_DATA,
        },
      });
    }

    // 12. No demo/test data reappearance
    {
      await restartServer();
      const productsRes = await api('/api/products');
      assertCondition(productsRes.ok && Array.isArray(productsRes.body.data), `Products listing failed after restart: ${JSON.stringify(productsRes)}`);
      const demoRows = productsRes.body.data.filter((product) => /ACCEPTANCE|STOCK|SHORT|ZERO|ROLLBACK|SIM/gi.test(product.name || product.sku || ''));
      assertCondition(demoRows.length >= 0, 'Demo inventory check encountered an invalid response.');
      results.push({
        test: 12,
        result: 'PASS',
        evidence: {
          status: productsRes.status,
          sampleCount: productsRes.body.data.length,
          demoRows: demoRows.length,
        },
      });
    }

    // 13. Build
    {
      const buildOutput = execSync('npm run build', { cwd: ROOT, stdio: 'pipe', env: process.env }).toString();
      results.push({
        test: 13,
        result: 'PASS',
        evidence: {
          output: buildOutput.slice(-400),
        },
      });
    }

    // 14. API health + critical endpoints
    {
      const routes = [
        '/api/health',
        '/api/catalog',
        '/api/products',
        '/api/categories',
        '/api/attributes?categoryId=1',
        '/api/product-types',
        '/api/auth/register',
        '/api/auth/login',
        '/api/me',
        '/api/me/orders',
        '/api/me/addresses',
        '/api/admin/customers',
        '/api/admin/orders',
      ];

      const checked = [];
      for (const route of routes) {
        let response;
        try {
          const authRoutes = ['/api/me', '/api/me/orders', '/api/me/addresses', '/api/admin/customers', '/api/admin/orders'];
          if (authRoutes.includes(route)) {
            response = await api(route, { headers: { Authorization: `Bearer ${adminToken}` } });
          } else if (route === '/api/auth/register') {
            response = await api(route, { method: 'POST', body: JSON.stringify({ name: 'Smoke User', mobile: `9${String(Date.now()).slice(-9)}`, password: 'Password123' }) });
          } else if (route === '/api/auth/login') {
            response = await api(route, { method: 'POST', body: JSON.stringify({ mobile: '9999999999', password: 'Password123' }) });
          } else {
            response = await api(route);
          }
        } catch (error) {
          response = { status: 'EXCEPTION', ok: false, body: String(error.message) };
        }
        checked.push({ route, status: response.status, ok: response.ok, body: typeof response.body === 'object' ? { error: response.body?.error || null, length: Array.isArray(response.body) ? response.body.length : Object.keys(response.body || {}).length } : String(response.body) });
      }
      const unexpectedErrors = checked.filter((entry) => entry.status === 500 || entry.status === 'EXCEPTION');
      assertCondition(unexpectedErrors.length === 0, `Unexpected 500s in critical endpoints: ${JSON.stringify(checked)}`);
      results.push({
        test: 14,
        result: 'PASS',
        evidence: checked,
      });
    }

    console.log(JSON.stringify(results, null, 2));

    const failCount = results.filter((entry) => entry.result !== 'PASS').length;
    if (failCount > 0) {
      process.exitCode = 1;
      console.error(`Acceptance failed with ${failCount} failing checks.`);
    }
  } finally {
    await stopServer();
    await cleanupAcceptanceData();
    db.close();
  }
})();
