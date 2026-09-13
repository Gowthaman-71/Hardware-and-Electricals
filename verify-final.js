const base = 'http://localhost:8787';

async function api(path, init = {}) {
  const res = await fetch(base + path, {
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    ...init,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { ok: res.ok, status: res.status, body: json };
}

function uniqueSuffix() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

(async () => {
  const suffix = uniqueSuffix();
  const admin = { email: 'owner@murugesan.in', password: 'change-this-before-production' };
  const customerPhone = '777' + String(Date.now()).slice(-7);
  const customer = { name: 'Final Verify Customer', mobile: customerPhone, password: 'Password123' };
  const adminLogin = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(admin) });
  if (!adminLogin.ok) {
    console.error('ADMIN_LOGIN_FAILED', adminLogin);
    process.exit(1);
  }
  const adminToken = adminLogin.body.token;

  const productSku = `PERM-${suffix}`;
  const productName = `PERMANENT-TEST-${suffix}`;
  const productCreate = await api('/api/products', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      sku: productSku,
      name: productName,
      categoryId: 1,
      price: 240,
      stock: 7,
      unit: 'Nos',
      brand: 'Anchor',
      description: 'Final verification product'
    })
  });
  console.log('PROD_CREATE', productCreate.status, JSON.stringify(productCreate.body));

  const register1 = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(customer) });
  console.log('REGISTER_1', register1.status, JSON.stringify(register1.body));
  const customerToken = register1.body.token;
  const register2 = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(customer) });
  console.log('REGISTER_DUPLICATE', register2.status, JSON.stringify(register2.body));

  const login = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ mobile: customer.mobile, password: customer.password }) });
  console.log('LOGIN_1', login.status, JSON.stringify(login.body));
  const login2 = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ mobile: `+91${customer.mobile}`, password: customer.password }) });
  console.log('LOGIN_2', login2.status, JSON.stringify(login2.body));
  const me = await api('/api/me', { headers: { Authorization: `Bearer ${customerToken}` } });
  console.log('ME', me.status, JSON.stringify(me.body));

  const address = await api('/api/me/addresses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${customerToken}` },
    body: JSON.stringify({
      fullName: customer.name,
      phone: customer.mobile,
      addressLine1: '1 Final Test Street',
      area: 'Test Area',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600001',
      isDefault: true,
    })
  });
  console.log('ADDRESS_CREATE', address.status, JSON.stringify(address.body));
  const addressId = address.body.id;

  const productsBefore = await api('/api/products');
  const createdProduct = productsBefore.body.data.find((p) => p.name === productName) || { id: productCreate.body.id, stock: productCreate.body.stock };
  console.log('PRODUCT_FOUND_BEFORE_ORDER', createdProduct);

  const order = await api('/api/me/orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${customerToken}` },
    body: JSON.stringify({
      addressId,
      gstNumber: '33AAAAA1111A1Z5',
      items: [{ productId: createdProduct.id, name: productName, quantity: 1, price: 240 }],
    })
  });
  console.log('ORDER_CREATE', order.status, JSON.stringify(order.body));

  const productsAfter = await api('/api/products');
  const updatedProduct = productsAfter.body.data.find((p) => p.id === createdProduct.id);
  console.log('PRODUCT_FOUND_AFTER_ORDER', updatedProduct && { id: updatedProduct.id, name: updatedProduct.name, stock: updatedProduct.stock });

  const adminCustomers = await api('/api/admin/customers', { headers: { Authorization: `Bearer ${adminToken}` } });
  console.log('ADMIN_CUSTOMERS', adminCustomers.status, JSON.stringify(adminCustomers.body.slice(-3)));

  const adminOrders = await api('/api/admin/orders', { headers: { Authorization: `Bearer ${adminToken}` } });
  console.log('ADMIN_ORDERS', adminOrders.status, Array.isArray(adminOrders.body) ? adminOrders.body.length : adminOrders.body);

  const category = await api('/api/categories');
  console.log('CATEGORIES_COUNT', category.status, Array.isArray(category.body) ? category.body.length : category.body.length);

  const health = await api('/api/health');
  const catalog = await api('/api/catalog');
  const productsApi = await api('/api/products');
  const settings = await api('/api/admin/settings', { headers: { Authorization: `Bearer ${adminToken}` } });
  console.log('CHECKS', JSON.stringify({ health: health.status, catalog: catalog.status, products: productsApi.status, settings: settings.status }));

  if (![adminLogin.ok, productCreate.ok, register1.ok, register2.ok, login.ok, login2.ok, me.ok, address.ok, order.ok, productsAfter.ok, adminCustomers.ok, adminOrders.ok, settings.ok].every(Boolean)) {
    process.exit(2);
  }
})();
