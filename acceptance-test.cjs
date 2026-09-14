#!/usr/bin/env node

/**
 * Production Acceptance Test Script
 * Tests critical functionality of Murugesan Electrical E-commerce Application
 * 
 * Usage: node acceptance-test.cjs
 * 
 * Environment Variables:
 * - API_URL: Base URL of API server (default: http://localhost:8787)
 * - ADMIN_EMAIL: Admin email for testing (default: owner@murugesan.in)
 * - ADMIN_PASSWORD: Admin password (required)
 */

const API_URL = process.env.API_URL || 'http://localhost:8787';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'owner@murugesan.in';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error('ERROR: ADMIN_PASSWORD environment variable is required');
  console.error('Usage: ADMIN_PASSWORD=your-password node acceptance-test.cjs');
  process.exit(1);
}

let testsPassed = 0;
let testsFailed = 0;
let adminToken = null;
let customerToken = null;
let createdCategoryId = null;
let createdProductId = null;
let createdOrderId = null;

async function request(path, options = {}) {
  const url = `${API_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  
  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  
  return { response, data };
}

function assert(condition, message) {
  if (condition) {
    console.log(`✓ ${message}`);
    testsPassed++;
  } else {
    console.error(`✗ ${message}`);
    testsFailed++;
  }
}

async function test(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try {
    await fn();
  } catch (error) {
    console.error(`✗ Test failed with error: ${error.message}`);
    testsFailed++;
  }
}

// Tests
async function testHealthEndpoint() {
  const { response, data } = await request('/api/health');
  assert(response.ok, 'Health endpoint returns 200');
  assert(data?.ok === true, 'Health endpoint returns ok: true');
  assert(data?.database, 'Health endpoint returns database info');
}

async function testPublicCatalog() {
  const { response, data } = await request('/api/catalog');
  assert(response.ok, 'Public catalog endpoint returns 200');
  assert(Array.isArray(data?.products), 'Catalog returns products array');
  assert(Array.isArray(data?.categories), 'Catalog returns categories array');
}

async function testAdminLogin() {
  const { response, data } = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  assert(response.ok, 'Admin login succeeds with valid credentials');
  assert(data?.token, 'Admin login returns JWT token');
  assert(data?.user?.role === 'ADMIN', 'Admin user has ADMIN role');
  
  if (data?.token) {
    adminToken = data.token;
  }
}

async function testAdminStats() {
  if (!adminToken) {
    console.log('⊘ Skipping (no admin token)');
    return;
  }
  
  const { response, data } = await request('/api/admin/stats', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(response.ok, 'Admin stats endpoint returns 200');
  assert(typeof data?.products === 'number', 'Stats include product count');
  assert(typeof data?.categories === 'number', 'Stats include category count');
  assert(typeof data?.orders === 'number', 'Stats include order count');
}

async function testCategoryCreation() {
  if (!adminToken) {
    console.log('⊘ Skipping (no admin token)');
    return;
  }
  
  const testCategory = {
    name: `Test Category ${Date.now()}`,
    slug: `test-cat-${Date.now()}`,
    description: 'Acceptance test category',
    status: 'ACTIVE',
  };
  
  const { response, data } = await request('/api/categories', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(testCategory),
  });
  
  assert(response.ok || response.status === 201, 'Category creation succeeds');
  assert(data?.id, 'Created category has ID');
  assert(data?.name === testCategory.name, 'Created category has correct name');
  
  if (data?.id) {
    createdCategoryId = data.id;
  }
}

async function testProductCreation() {
  if (!adminToken || !createdCategoryId) {
    console.log('⊘ Skipping (no admin token or category)');
    return;
  }
  
  const testProduct = {
    sku: `TEST-${Date.now()}`,
    name: `Test Product ${Date.now()}`,
    categoryId: createdCategoryId,
    price: 100,
    mrp: 120,
    stock: 50,
    unit: 'Nos',
    description: 'Acceptance test product',
    status: 'ACTIVE',
  };
  
  const { response, data } = await request('/api/products', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(testProduct),
  });
  
  assert(response.ok || response.status === 201, 'Product creation succeeds');
  assert(data?.id, 'Created product has ID');
  assert(data?.sku === testProduct.sku, 'Created product has correct SKU');
  
  if (data?.id) {
    createdProductId = data.id;
  }
}

async function testStockUpdate() {
  if (!adminToken || !createdProductId) {
    console.log('⊘ Skipping (no admin token or product)');
    return;
  }
  
  const newStock = 75;
  const { response, data } = await request(`/api/products/${createdProductId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ stock: newStock }),
  });
  
  assert(response.ok, 'Stock update succeeds');
  assert(data?.stock === newStock, 'Stock value updated correctly');
}

async function testBulkImport() {
  if (!adminToken) {
    console.log('⊘ Skipping (no admin token)');
    return;
  }
  
  const bulkData = {
    products: [
      {
        row: 1,
        product: {
          sku: `BULK-TEST-${Date.now()}`,
          name: 'Bulk Import Test Product',
          category: `Bulk Test Category ${Date.now()}`,
          price: 50,
          stock: 10,
          status: 'ACTIVE',
        },
      },
    ],
    duplicateMode: 'skip',
  };
  
  const { response, data } = await request('/api/products/bulk-import', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(bulkData),
  });
  
  assert(response.ok, 'Bulk import succeeds');
  assert(data?.imported >= 0, 'Bulk import returns import count');
  assert(data?.success === true, 'Bulk import reports success');
}

async function testCustomerRegistration() {
  const customerData = {
    name: 'Test Customer',
    mobile: `9${Math.floor(Math.random() * 900000000 + 100000000)}`,
    password: 'Test@12345',
  };
  
  const { response, data } = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(customerData),
  });
  
  assert(response.ok || response.status === 201 || response.status === 409, 
    'Customer registration succeeds or returns conflict for duplicate');
  
  if (response.ok || response.status === 201) {
    assert(data?.token, 'Customer registration returns token');
    if (data?.token) {
      customerToken = data.token;
    }
  }
}

async function testUnauthorizedAccess() {
  const { response } = await request('/api/admin/stats');
  assert(response.status === 401, 'Admin endpoints require authentication');
}

async function testInvalidLogin() {
  const { response } = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'invalid@test.com', password: 'wrong' }),
  });
  assert(response.status === 401 || response.status === 400, 'Invalid login returns 401/400');
}

// Cleanup
async function cleanup() {
  if (!adminToken) return;
  
  console.log('\n[CLEANUP] Removing test data...');
  
  if (createdProductId) {
    await request(`/api/products/${createdProductId}/archive`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    console.log(`✓ Archived test product ${createdProductId}`);
  }
  
  if (createdCategoryId) {
    await request(`/api/categories/${createdCategoryId}/archive`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    console.log(`✓ Archived test category ${createdCategoryId}`);
  }
}

// Run all tests
async function main() {
  console.log('========================================');
  console.log('MURUGESAN ELECTRICAL - ACCEPTANCE TESTS');
  console.log('========================================');
  console.log(`API URL: ${API_URL}`);
  console.log(`Admin Email: ${ADMIN_EMAIL}`);
  console.log('');
  
  await test('Health Endpoint', testHealthEndpoint);
  await test('Public Catalog', testPublicCatalog);
  await test('Admin Login', testAdminLogin);
  await test('Admin Stats', testAdminStats);
  await test('Category Creation', testCategoryCreation);
  await test('Product Creation', testProductCreation);
  await test('Stock Update', testStockUpdate);
  await test('Bulk Import', testBulkImport);
  await test('Customer Registration', testCustomerRegistration);
  await test('Unauthorized Access', testUnauthorizedAccess);
  await test('Invalid Login', testInvalidLogin);
  
  await cleanup();
  
  console.log('\n========================================');
  console.log('TEST RESULTS');
  console.log('========================================');
  console.log(`✓ Passed: ${testsPassed}`);
  console.log(`✗ Failed: ${testsFailed}`);
  console.log(`Total: ${testsPassed + testsFailed}`);
  console.log('========================================\n');
  
  process.exit(testsFailed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
