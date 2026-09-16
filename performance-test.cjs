/**
 * Performance Test Script for Large Catalog
 * Tests API performance with 1,000+ products
 * Usage: node performance-test.cjs
 */

const http = require('http');

const API_URL = 'http://localhost:8787';
const ADMIN_EMAIL = 'owner@murugesan.in';
const ADMIN_PASSWORD = 'Bu@240708';

let adminToken = null;

// Helper function to make HTTP requests
function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_URL);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    };

    if (options.body) {
      opts.headers['Content-Length'] = Buffer.byteLength(options.body);
    }

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ response: res, data: json });
        } catch {
          resolve({ response: res, data: data });
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

// Measure execution time
async function measureTime(name, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    console.log(`✓ ${name}: ${duration}ms`);
    return { success: true, duration, result };
  } catch (error) {
    const duration = Date.now() - start;
    console.log(`✗ ${name}: ${duration}ms - ${error.message}`);
    return { success: false, duration, error };
  }
}

// Test suite
async function runTests() {
  console.log('\n=== PERFORMANCE TEST SUITE ===\n');
  console.log('Testing with large catalog (1,000+ products)\n');

  // Login
  console.log('--- Authentication ---');
  const loginResult = await measureTime('Admin Login', async () => {
    const { response, data } = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ mobile: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    });
    if (!response.ok) throw new Error('Login failed');
    adminToken = data.token;
    return data;
  });

  if (!loginResult.success) {
    console.error('Failed to authenticate. Exiting.');
    return;
  }

  console.log('\n--- API Performance Tests ---\n');

  const results = [];

  // Test 1: Load categories (cached)
  results.push(await measureTime('GET /api/categories (cached)', async () => {
    const { response, data } = await request('/api/categories', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    if (!response.ok) throw new Error('Failed to load categories');
    return data;
  }));

  // Test 2: Load categories (second call - should hit cache)
  results.push(await measureTime('GET /api/categories (cache hit)', async () => {
    const { response, data } = await request('/api/categories', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    if (!response.ok) throw new Error('Failed to load categories');
    return data;
  }));

  // Test 3: Load brands (cached)
  results.push(await measureTime('GET /api/brands (cached)', async () => {
    const { response, data } = await request('/api/brands', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    if (!response.ok) throw new Error('Failed to load brands');
    return data;
  }));

  // Test 4: Load products page 1 (24 items)
  results.push(await measureTime('GET /api/products?page=1&limit=24', async () => {
    const { response, data } = await request('/api/products?page=1&limit=24');
    if (!response.ok) throw new Error('Failed to load products');
    return data;
  }));

  // Test 5: Load products page 10 (24 items)
  results.push(await measureTime('GET /api/products?page=10&limit=24', async () => {
    const { response, data } = await request('/api/products?page=10&limit=24');
    if (!response.ok) throw new Error('Failed to load products');
    return data;
  }));

  // Test 6: Search products
  results.push(await measureTime('GET /api/products?search=LED&limit=24', async () => {
    const { response, data } = await request('/api/products?search=LED&limit=24');
    if (!response.ok) throw new Error('Failed to search products');
    return data;
  }));

  // Test 7: Filter by category
  results.push(await measureTime('GET /api/products?category=Lighting&limit=24', async () => {
    const { response, data } = await request('/api/products?category=Lighting&limit=24');
    if (!response.ok) throw new Error('Failed to filter products');
    return data;
  }));

  // Test 8: Admin products list (50 items)
  results.push(await measureTime('GET /api/admin/products?limit=50', async () => {
    const { response, data } = await request('/api/admin/products?limit=50', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    if (!response.ok) throw new Error('Failed to load admin products');
    return data;
  }));

  // Test 9: Admin products list (100 items)
  results.push(await measureTime('GET /api/admin/products?limit=100', async () => {
    const { response, data } = await request('/api/admin/products?limit=100', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    if (!response.ok) throw new Error('Failed to load admin products');
    return data;
  }));

  // Test 10: Catalog with pagination
  results.push(await measureTime('GET /api/catalog?page=1&limit=24', async () => {
    const { response, data } = await request('/api/catalog?page=1&limit=24');
    if (!response.ok) throw new Error('Failed to load catalog');
    return data;
  }));

  // Test 11: Search endpoint
  results.push(await measureTime('GET /api/search?q=fan&limit=24', async () => {
    const { response, data } = await request('/api/search?q=fan&limit=24');
    if (!response.ok) throw new Error('Failed to search');
    return data;
  }));

  console.log('\n--- Performance Summary ---\n');

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`Total Tests: ${results.length}`);
  console.log(`Successful: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);

  if (successful.length > 0) {
    const avgTime = successful.reduce((sum, r) => sum + r.duration, 0) / successful.length;
    const maxTime = Math.max(...successful.map(r => r.duration));
    const minTime = Math.min(...successful.map(r => r.duration));
    
    console.log(`\nAverage Response Time: ${avgTime.toFixed(2)}ms`);
    console.log(`Min Response Time: ${minTime}ms`);
    console.log(`Max Response Time: ${maxTime}ms`);
  }

  console.log('\n--- Performance Benchmarks ---\n');
  console.log('Target Performance:');
  console.log('- API Response: < 200ms');
  console.log('- Page Load: < 500ms');
  console.log('- Search: < 300ms');
  console.log('- Admin List: < 500ms');

  console.log('\n--- Detailed Results ---\n');
  results.forEach(r => {
    const status = r.success ? '✓' : '✗';
    console.log(`${status} ${r.duration}ms - ${r.duration < 200 ? 'EXCELLENT' : r.duration < 500 ? 'GOOD' : 'NEEDS OPTIMIZATION'}`);
  });

  console.log('\n=== TEST COMPLETE ===\n');
}

// Run tests
runTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
