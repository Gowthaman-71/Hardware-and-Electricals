const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const port = 8800 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'murugesan-integration-'));
const dbPath = path.join(tempDir, 'catalog.sqlite');
let server;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(route, options = {}) {
  const response = await fetch(base + route, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await request('/api/health')).status === 200) return; } catch {}
    await sleep(100);
  }
  throw new Error('Integration server did not start');
}
async function register(name, mobile) {
  const result = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, mobile, password: 'Password123' }) });
  assert(result.status === 201, `registration failed: ${JSON.stringify(result.body)}`);
  return result.body.token;
}
async function addAddress(token, name, phone) {
  const result = await request('/api/me/addresses', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fullName: name, phone, addressLine1: '1 Test Street', city: 'Tirupathur', state: 'Tamil Nadu', pincode: '635601', isDefault: true }),
  });
  assert(result.status === 201, `address failed: ${JSON.stringify(result.body)}`);
  return result.body.id;
}
async function placeOrder(token, addressId, productId, key) {
  return request('/api/me/orders', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ addressId, idempotencyKey: key, items: [{ productId, quantity: 1, price: 1, name: 'Test product' }] }),
  });
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await new Promise((resolve) => server.once('exit', resolve));
}

(async () => {
  try {
    server = spawn(process.execPath, ['server/index.cjs'], {
      cwd: root,
      env: { ...process.env, NODE_ENV: 'development', PORT: String(port), DATABASE_PATH: dbPath, UPLOAD_DIR: path.join(tempDir, 'uploads'), JWT_SECRET: 'integration-test-secret', ADMIN_EMAIL: 'owner@test.local', ADMIN_PASSWORD: 'Password123', ADMIN_MOBILE: '9361866771', OWNER_WHATSAPP_NUMBER: '919361866771', ALLOWED_ORIGINS: `http://127.0.0.1:${port}`, RATE_LIMIT_REGISTER_MAX: '20' },
      stdio: 'ignore',
    });
    await waitForServer();

    const adminLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ mobile: '9361866771', password: 'Password123' }) });
    assert(adminLogin.status === 200, 'admin login failed');
    const adminToken = adminLogin.body.token;
    const validImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const imageForm = new FormData();
    imageForm.append('image', new Blob([validImage], { type: 'image/png' }), 'test.png');
    const imageResponse = await fetch(base + '/api/images', { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: imageForm });
    const imageBody = await imageResponse.text();
    assert(imageResponse.status === 201, `image upload failed: ${imageBody}`);
    const uploadedImage = JSON.parse(imageBody);
    assert(uploadedImage.url.startsWith('/uploads/'), 'local image URL was not returned through the storage abstraction');
    const category = await request('/api/categories', { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ name: 'Integration Category', slug: 'integration-category' }) });
    assert(category.status === 201, `category failed: ${JSON.stringify(category.body)}`);
    const product = await request('/api/products', { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ sku: 'INTEGRATION-1', name: 'Integration Product', categoryId: category.body.id, price: 1, mrp: 1, stock: 2 }) });
    assert(product.status === 201, `product failed: ${JSON.stringify(product.body)}`);

    const customerAToken = await register('Integration A', '9361866701');
    const customerBToken = await register('Integration B', '9361866702');
    const addressA = await addAddress(customerAToken, 'Integration A', '9361866701');
    const addressB = await addAddress(customerBToken, 'Integration B', '9361866702');

    const first = await placeOrder(customerAToken, addressA, product.body.id, 'integration-key-a');
    assert(first.status === 201, `first order failed: ${JSON.stringify(first.body)}`);
    const replay = await placeOrder(customerAToken, addressA, product.body.id, 'integration-key-a');
    assert(replay.status === 200 && replay.body.order.id === first.body.order.id, 'idempotency replay created a different order');
    const second = await placeOrder(customerAToken, addressA, product.body.id, 'integration-key-b');
    assert(second.status === 201 && second.body.order.id !== first.body.order.id, 'new checkout did not create a new order');

    const finalStockProduct = await request('/api/products', { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ sku: 'INTEGRATION-FINAL', name: 'Final Stock Product', categoryId: category.body.id, price: 1, mrp: 1, stock: 1 }) });
    assert(finalStockProduct.status === 201, 'final-stock product creation failed');
    const concurrent = await Promise.all([
      placeOrder(customerAToken, addressA, finalStockProduct.body.id, 'integration-concurrent-a'),
      placeOrder(customerBToken, addressB, finalStockProduct.body.id, 'integration-concurrent-b'),
    ]);
    assert(concurrent.filter((result) => result.status === 201).length === 1, `concurrent stock result was not exactly one success: ${JSON.stringify(concurrent)}`);
    assert(concurrent.some((result) => result.status === 400), 'losing concurrent order did not return a clean stock error');

    await stopServer();
    const db = new DatabaseSync(dbPath);
    const storedOrders = db.prepare('SELECT COUNT(*) count FROM orders WHERE order_number LIKE ?').get('MH-%').count;
    const remainingStock = db.prepare('SELECT stock FROM products WHERE sku = ?').get('INTEGRATION-FINAL').stock;
    const itemCount = db.prepare('SELECT COUNT(*) count FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE ?)').get('MH-%').count;
    assert(Number(storedOrders) === 3, `expected three successful orders, found ${storedOrders}`);
    assert(Number(remainingStock) === 0, `final stock was ${remainingStock}`);
    assert(Number(itemCount) === 3, `expected three order items, found ${itemCount}`);
    db.close();
    console.log('Integration order, idempotency, and concurrent-stock tests passed.');
  } finally {
    await stopServer();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
