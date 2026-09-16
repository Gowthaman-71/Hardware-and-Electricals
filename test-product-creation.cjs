#!/usr/bin/env node

const API_URL = 'http://localhost:8787';
const ADMIN_EMAIL = 'owner@murugesan.in';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-before-production';

async function request(path, options = {}) {
  const url = `${API_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => null);
  return { response, data };
}

async function test() {
  console.log('Testing Product Creation...\n');
  
  // Login
  const { response: loginRes, data: loginData } = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  console.log('Login:', loginRes.ok, loginData?.token ? 'Token received' : 'No token');
  
  if (!loginData?.token) {
    console.error('Login failed');
    return;
  }
  
  // Create category
  const testCategory = {
    name: `Test Category ${Date.now()}`,
    slug: `test-cat-${Date.now()}`,
    description: 'Test category',
    status: 'ACTIVE',
  };
  
  const { response: catRes, data: catData } = await request('/api/categories', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginData.token}` },
    body: JSON.stringify(testCategory),
  });
  console.log('Category creation:', catRes.status, catData);
  
  if (!catData?.id) {
    console.error('Category creation failed');
    return;
  }
  
  // Create product
  const testProduct = {
    sku: `TEST-${Date.now()}`,
    name: `Test Product ${Date.now()}`,
    categoryId: catData.id,
    price: 100,
    mrp: 120,
    stock: 50,
    unit: 'Nos',
    description: 'Test product',
    status: 'ACTIVE',
  };
  
  console.log('\nProduct payload:', JSON.stringify(testProduct, null, 2));
  
  const { response: prodRes, data: prodData } = await request('/api/products', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginData.token}` },
    body: JSON.stringify(testProduct),
  });
  console.log('\nProduct creation response:', prodRes.status, prodData);
  
  if (!prodRes.ok) {
    console.error('Product creation failed:', prodData?.error);
  } else {
    console.log('✓ Product created successfully');
  }
}

test().catch(console.error);
