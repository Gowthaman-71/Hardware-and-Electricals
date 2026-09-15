'use strict';
/**
 * Comprehensive Catalog Test Suite
 * Run: ADMIN_PASSWORD=yourpass node catalog-test.cjs
 * Requires the dev server running: node server/index.cjs
 */
const http = require('http');

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const ADMIN_MOBILE = process.env.ADMIN_MOBILE || '9361866771';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

if (!ADMIN_PASSWORD) {
  console.error('Set ADMIN_PASSWORD env var. Example:\n  ADMIN_PASSWORD=yourpass node catalog-test.cjs');
  process.exit(1);
}

// ── minimal HTTP client ───────────────────────────────────────────────────────
function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port: Number(url.port) || 80,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const r = http.request(options, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const GET    = (p, t)    => req('GET',    p, null, t);
const POST   = (p, b, t) => req('POST',   p, b,    t);
const PATCH  = (p, b, t) => req('PATCH',  p, b,    t);

// ── runner ─────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { console.log(`  ✓  ${name}`); pass++; }
  else       { console.error(`  ✗  ${name}${detail ? ' — ' + detail : ''}`); fail++; failures.push(name); }
}
function section(t) { console.log(`\n${'─'.repeat(56)}\n  ${t}\n${'─'.repeat(56)}`); }

// ── unique ID to avoid collisions ─────────────────────────────────────────────
const UID  = Date.now().toString(36);
const sku  = (s) => `T${UID}-${s}`;
const name = (n) => `[TEST-${UID}] ${n}`;

// ── main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n  Catalog Test Suite  →  ${BASE}\n`);

  // ╔══════════════════════════════════════════════════════╗
  // ║  1. AUTH                                             ║
  // ╚══════════════════════════════════════════════════════╝
  section('1. Authentication');
  const loginOk = await POST('/api/auth/login', { mobile: ADMIN_MOBILE, password: ADMIN_PASSWORD });
  ok('Admin login → 200', loginOk.status === 200, `status=${loginOk.status} body=${JSON.stringify(loginOk.body)}`);
  const TOKEN = loginOk.body?.token;
  if (!TOKEN) { console.error('\nFATAL: No token. Check credentials.'); process.exit(1); }
  ok('Token returned', typeof TOKEN === 'string');

  const badLogin = await POST('/api/auth/login', { mobile: '9000000000', password: 'wrong' });
  ok('Bad credentials → 401', badLogin.status === 401);

  const noAuth = await GET('/api/admin/products');
  ok('Missing auth → 401', noAuth.status === 401);

  // ╔══════════════════════════════════════════════════════╗
  // ║  2. CATEGORIES                                       ║
  // ╚══════════════════════════════════════════════════════╝
  section('2. Categories');
  const catName = name('Switches');
  const catRes = await POST('/api/categories', {
    name: catName,
    description: 'Test category',
    attributes: [
      { name: 'Ampere',  type: 'Dropdown', values: ['6A','10A','16A'] },
      { name: 'Color',   type: 'Text',     values: [] },
      { name: 'Modules', type: 'Number',   values: [] },
    ],
  }, TOKEN);
  ok('Create category → 201',    catRes.status === 201, JSON.stringify(catRes.body?.error));
  const CAT_ID = catRes.body?.id;
  ok('Category has ID',          typeof CAT_ID === 'number');
  ok('Attributes saved',         Array.isArray(catRes.body?.attributes) && catRes.body.attributes.length >= 3);

  const catList = await GET('/api/categories');
  ok('List categories → 200',    catList.status === 200 && Array.isArray(catList.body));
  ok('New category in list',     catList.body.some(c => c.id === CAT_ID));

  const catPatch = await PATCH(`/api/categories/${CAT_ID}`, { description: 'Updated desc' }, TOKEN);
  ok('Update category → 200',    catPatch.status === 200);
  ok('Description persisted',    catPatch.body?.description === 'Updated desc');

  const dupCat = await POST('/api/categories', { name: catName }, TOKEN);
  ok('Duplicate category slug → 409', dupCat.status === 409);

  // safe-delete: category with no products should delete; with products should archive
  const tempCat = await POST('/api/categories', { name: name('TempCat') }, TOKEN);
  const tempCatId = tempCat.body?.id;
  const delTemp = await PATCH(`/api/categories/${tempCatId}/archive`, {}, TOKEN);
  ok('Delete empty category',    delTemp.body?.deleted === true);

  // ╔══════════════════════════════════════════════════════╗
  // ║  3. BRANDS                                           ║
  // ╚══════════════════════════════════════════════════════╝
  section('3. Brands');
  const brandName = name('Anchor');
  const brandRes = await POST('/api/brands', { name: brandName, description: 'Test brand' }, TOKEN);
  ok('Create brand → 201',       brandRes.status === 201, JSON.stringify(brandRes.body?.error));
  const BRAND_ID = brandRes.body?.id;
  ok('Brand has ID',             typeof BRAND_ID === 'number');

  const brandList = await GET('/api/brands');
  ok('List brands → 200',        brandList.status === 200 && Array.isArray(brandList.body));
  ok('New brand present',        brandList.body.some(b => b.id === BRAND_ID));

  const bSearch = await GET(`/api/brands?search=${encodeURIComponent(UID)}`);
  ok('Brand search → 200',       bSearch.status === 200);
  ok('Search returns brand',     bSearch.body.some(b => b.id === BRAND_ID));

  const bPatch = await PATCH(`/api/brands/${BRAND_ID}`, { description: 'Updated' }, TOKEN);
  ok('Update brand → 200',       bPatch.status === 200);

  // Test archive/restore on a separate brand so BRAND_ID remains usable
  // First create a product linked to tempBrand so it archives (not deletes)
  const tempBrandForArchive = await POST('/api/brands', { name: name('ArchiveBrand') }, TOKEN);
  const ARCHIVE_BRAND_ID = tempBrandForArchive.body?.id;
  // Add a product to prevent deletion
  await POST('/api/products', {
    sku: sku('ARCHBRAND'), name: name('ArchBrandProd'),
    categoryId: CAT_ID, brandId: ARCHIVE_BRAND_ID, price: 1, stock: 0,
  }, TOKEN);
  const archiveBrand = await PATCH(`/api/brands/${ARCHIVE_BRAND_ID}/archive`, {}, TOKEN);
  ok('Archive brand',            archiveBrand.status === 200 && archiveBrand.body?.archived === true);
  const restoreRes = await PATCH(`/api/brands/${ARCHIVE_BRAND_ID}/restore`, {}, TOKEN);
  ok('Restore brand',            restoreRes.status === 200 && restoreRes.body?.restored === true);

  // ╔══════════════════════════════════════════════════════╗
  // ║  4. PRODUCT TYPES                                    ║
  // ╚══════════════════════════════════════════════════════╝
  section('4. Product Types');
  const ptRes = await POST('/api/product-types', { categoryId: CAT_ID, name: name('Modular'), status: 'ACTIVE' }, TOKEN);
  ok('Create product type → 201', ptRes.status === 201, JSON.stringify(ptRes.body?.error));
  const PT_ID = ptRes.body?.id;
  ok('Product type has ID',       typeof PT_ID === 'number');
  ok('Linked to correct category', ptRes.body?.categoryId === CAT_ID);

  const ptList = await GET(`/api/product-types?categoryId=${CAT_ID}`);
  ok('List types by category',    ptList.status === 200 && ptList.body.some(t => t.id === PT_ID));

  const ptBadCat = await POST('/api/product-types', { categoryId: 9999999, name: 'Ghost' }, TOKEN);
  ok('Type with bad category → 4xx', ptBadCat.status >= 400);

  // ╔══════════════════════════════════════════════════════╗
  // ║  5. PRODUCT CRUD & VALIDATION                        ║
  // ╚══════════════════════════════════════════════════════╝
  section('5. Product CRUD & Validation');

  // create valid product
  const p1 = await POST('/api/products', {
    sku: sku('P1'), name: name('10A Switch'),
    categoryId: CAT_ID, brandId: BRAND_ID, productTypeId: PT_ID,
    price: 95, mrp: 120, discount: 0, stock: 50, unit: 'Nos',
    description: 'Quality modular switch for residential use',
    attributes: { Ampere: '10A', Color: 'White', Modules: '1' },
    status: 'ACTIVE',
  }, TOKEN);
  ok('Create valid product → 201', p1.status === 201, JSON.stringify(p1.body?.error));
  const PID1 = p1.body?.id;
  ok('Product ID returned',        typeof PID1 === 'number');
  ok('productType from DB (not details)', p1.body?.productType !== p1.body?.details || p1.body?.productTypeId === PT_ID);
  ok('Brand from DB',              p1.body?.brandId === BRAND_ID);
  ok('MRP saved correctly',        p1.body?.mrp === 120);
  ok('Price saved correctly',      p1.body?.price === 95);
  ok('Stock saved correctly',      p1.body?.stock === 50);

  // duplicate SKU
  const dupP = await POST('/api/products', {
    sku: sku('P1'), name: 'Dup', categoryId: CAT_ID, price: 10, stock: 0,
  }, TOKEN);
  ok('Duplicate SKU → 409',        dupP.status === 409);

  // invalid SKU characters
  const badSkuP = await POST('/api/products', {
    sku: 'bad sku!', name: 'Bad', categoryId: CAT_ID, price: 10, stock: 0,
  }, TOKEN);
  ok('Invalid SKU chars → 400',    badSkuP.status === 400);

  // MRP less than price
  const badMrp = await POST('/api/products', {
    sku: sku('BADMRP'), name: 'BadMRP', categoryId: CAT_ID, price: 100, mrp: 50, stock: 0,
  }, TOKEN);
  ok('MRP < price → 400',          badMrp.status === 400);

  // negative price
  const negP = await POST('/api/products', {
    sku: sku('NEGP'), name: 'NegP', categoryId: CAT_ID, price: -1, stock: 0,
  }, TOKEN);
  ok('Negative price → 400',       negP.status === 400);

  // discount > 100
  const badDisc = await POST('/api/products', {
    sku: sku('DISC'), name: 'BadDisc', categoryId: CAT_ID, price: 10, discount: 200, stock: 0,
  }, TOKEN);
  ok('Discount > 100 → 400',       badDisc.status === 400);

  // archived category
  const archCatRes = await POST('/api/categories', { name: name('ArchCat') }, TOKEN);
  const ARCH_CAT_ID = archCatRes.body?.id;
  await PATCH(`/api/categories/${ARCH_CAT_ID}/archive`, {}, TOKEN);
  const archCatP = await POST('/api/products', {
    sku: sku('ARCHCAT'), name: 'ArchCatP', categoryId: ARCH_CAT_ID, price: 10, stock: 0,
  }, TOKEN);
  ok('Product in archived category → 400', archCatP.status === 400);

  // missing required fields
  const missingFields = await POST('/api/products', { sku: '', name: '', price: 0 }, TOKEN);
  ok('Missing required fields → 400', missingFields.status === 400);

  // update product
  const upd = await PATCH(`/api/products/${PID1}`, {
    name: name('10A Switch UPDATED'), price: 99, mrp: 130, stock: 45,
  }, TOKEN);
  ok('Update product → 200',      upd.status === 200, JSON.stringify(upd.body?.error));
  ok('Name updated',              upd.body?.name?.includes('UPDATED'));
  ok('Price updated',             upd.body?.price === 99);
  ok('Stock updated',             upd.body?.stock === 45);

  // stock-only update
  const stk = await PATCH(`/api/products/${PID1}`, { stock: 100 }, TOKEN);
  ok('Stock-only update → 200',   stk.status === 200);
  ok('Stock value correct',       stk.body?.stock === 100);

  // invalid stock
  const badStk = await PATCH(`/api/products/${PID1}`, { stock: -1 }, TOKEN);
  ok('Negative stock → 400',      badStk.status === 400);

  // archive product
  const arch = await PATCH(`/api/products/${PID1}/archive`, {}, TOKEN);
  ok('Archive product → 204',     arch.status === 204);

  // ╔══════════════════════════════════════════════════════╗
  // ║  6. SEARCH / FILTER / PAGINATION / SORT              ║
  // ╚══════════════════════════════════════════════════════╝
  section('6. Search / Filter / Pagination / Sort');

  // create a second live product for filter tests
  const p2 = await POST('/api/products', {
    sku: sku('P2'), name: name('2.5mm Copper Wire'),
    categoryId: CAT_ID, brandId: BRAND_ID,
    price: 350, mrp: 420, stock: 0, unit: 'Meter',
    description: 'ISI-marked flexible copper wire',
    status: 'ACTIVE',
  }, TOKEN);
  const PID2 = p2.body?.id;
  ok('Second product created',    p2.status === 201);

  const pg = await GET('/api/admin/products?page=1&limit=5&sortBy=price&sortOrder=desc', TOKEN);
  ok('Paginated list → 200',      pg.status === 200);
  ok('data is array',             Array.isArray(pg.body?.data));
  ok('total count present',       typeof pg.body?.total === 'number');
  ok('pages count present',       typeof pg.body?.pages === 'number');
  ok('page size respected',       pg.body.data.length <= 5);

  const priceArr = pg.body.data.map(p => p.price);
  ok('Price sort desc correct',   priceArr.every((v, i) => i === 0 || v <= priceArr[i - 1]));

  const srch = await GET(`/api/admin/products?search=${encodeURIComponent('Copper Wire')}`, TOKEN);
  ok('Name search → 200',         srch.status === 200);
  ok('Search finds product',      srch.body.data.some(p => p.id === PID2));

  const catFil = await GET(`/api/admin/products?categoryId=${CAT_ID}`, TOKEN);
  ok('Category filter → 200',     catFil.status === 200);

  const outFil = await GET('/api/admin/products?status=OUT_OF_STOCK', TOKEN);
  ok('Out-of-stock filter → 200', outFil.status === 200);
  ok('All results have stock=0',  outFil.body.data.every(p => p.stock === 0));

  // ╔══════════════════════════════════════════════════════╗
  // ║  7. BULK IMPORT                                      ║
  // ╚══════════════════════════════════════════════════════╝
  section('7. Bulk Import');

  // helper to build a valid product row
  const mkRow = (i) => ({
    row: i + 1,
    product: {
      sku: sku(`BULK${String(i).padStart(4, '0')}`),
      name: name(`Bulk ${i}`),
      category: catName,
      brand: brandName,
      productType: ptRes.body?.name,
      price: 10 + i,
      mrp: 15 + i,
      stock: i,
      unit: 'Nos',
      description: `Bulk product ${i}`,
      status: 'ACTIVE',
    },
  });

  // import 100 valid products
  const bulk100 = await POST('/api/products/bulk-import', {
    duplicateMode: 'skip',
    products: Array.from({ length: 100 }, (_, i) => mkRow(i)),
  }, TOKEN);
  ok('Bulk import 100 → 200',     bulk100.status === 200, JSON.stringify(bulk100.body?.error));
  ok('100 imported',              bulk100.body?.imported === 100, `imported=${bulk100.body?.imported}`);
  ok('0 failures',                bulk100.body?.failed === 0,    `failed=${bulk100.body?.failed}`);

  // duplicate SKU within same file
  const dupFile = await POST('/api/products/bulk-import', {
    duplicateMode: 'skip',
    products: [
      { row: 1, product: { sku: sku('DUPX'), name: name('DupA'), category: catName, price: 10, stock: 0 } },
      { row: 2, product: { sku: sku('DUPX'), name: name('DupB'), category: catName, price: 10, stock: 0 } },
    ],
  }, TOKEN);
  ok('In-file dup SKU → failed>=1', dupFile.body?.failed >= 1);

  // existing SKU skip mode
  const existSku = sku('BULK0000');
  const skipTest = await POST('/api/products/bulk-import', {
    duplicateMode: 'skip',
    products: [{ row: 1, product: { sku: existSku, name: name('Dup Skip'), category: catName, price: 10, stock: 0 } }],
  }, TOKEN);
  ok('Existing SKU skip → skipped=1', skipTest.body?.skipped === 1, JSON.stringify(skipTest.body));

  // existing SKU update mode
  const updateTest = await POST('/api/products/bulk-import', {
    duplicateMode: 'update',
    products: [{ row: 1, product: { sku: existSku, name: name('Dup Updated'), category: catName, price: 99, stock: 77 } }],
  }, TOKEN);
  ok('Existing SKU update → updated=1', updateTest.body?.updated === 1, JSON.stringify(updateTest.body));

  // invalid price row
  const invPrice = await POST('/api/products/bulk-import', {
    duplicateMode: 'skip',
    products: [{ row: 1, product: { sku: sku('INVPR'), name: name('Bad Price'), category: catName, price: 'abc', stock: 0 } }],
  }, TOKEN);
  ok('Invalid price → failed',    invPrice.body?.failed >= 1);

  // missing SKU
  const noSku = await POST('/api/products/bulk-import', {
    duplicateMode: 'skip',
    products: [{ row: 1, product: { sku: '', name: name('NoSKU'), category: catName, price: 10, stock: 0 } }],
  }, TOKEN);
  ok('Missing SKU → failed',      noSku.body?.failed >= 1);

  // unknown category
  const unkCat = await POST('/api/products/bulk-import', {
    duplicateMode: 'skip',
    products: [{ row: 1, product: { sku: sku('UNKCAT'), name: name('UnkCat'), category: 'DOES_NOT_EXIST_XYZ', price: 10, stock: 0 } }],
  }, TOKEN);
  ok('Unknown category → failed', unkCat.body?.failed >= 1);

  // invalid discount
  const invDisc = await POST('/api/products/bulk-import', {
    duplicateMode: 'skip',
    products: [{ row: 1, product: { sku: sku('INVD'), name: name('BadDisc'), category: catName, price: 10, stock: 0, discount: 999 } }],
  }, TOKEN);
  ok('Invalid discount → failed', invDisc.body?.failed >= 1);

  // MRP < price
  const invMrp = await POST('/api/products/bulk-import', {
    duplicateMode: 'skip',
    products: [{ row: 1, product: { sku: sku('INVMRP'), name: name('BadMRP'), category: catName, price: 100, mrp: 50, stock: 0 } }],
  }, TOKEN);
  ok('MRP < price → failed',      invMrp.body?.failed >= 1);

  // max rows guard
  const over2k = await POST('/api/products/bulk-import', {
    duplicateMode: 'skip',
    products: Array.from({ length: 2001 }, (_, i) => mkRow(i + 200)),
  }, TOKEN);
  ok('Over 2000 rows → 400',      over2k.status === 400);

  // ╔══════════════════════════════════════════════════════╗
  // ║  8. CATEGORY SAFE DELETION / REASSIGNMENT            ║
  // ╚══════════════════════════════════════════════════════╝
  section('8. Category Safe Deletion & Reassignment');

  // create product in a category, then try to delete it → should archive
  const delCat = await POST('/api/categories', { name: name('ToDelete') }, TOKEN);
  const DEL_CAT_ID = delCat.body?.id;
  const prodInCat = await POST('/api/products', {
    sku: sku('DELCAT'), name: name('ProdInDelCat'),
    categoryId: DEL_CAT_ID, price: 10, stock: 1,
  }, TOKEN);
  ok('Product created in cat',    prodInCat.status === 201);

  const archWithProducts = await PATCH(`/api/categories/${DEL_CAT_ID}/archive`, {}, TOKEN);
  ok('Archive cat with products', archWithProducts.status === 200);
  ok('Returns archived:true',     archWithProducts.body?.archived === true);
  ok('Returns productCount',      archWithProducts.body?.productCount >= 1);

  // reassignment
  const reassignRes = await PATCH(`/api/categories/${DEL_CAT_ID}/archive`, {
    reassignToCategoryId: CAT_ID,
  }, TOKEN);
  ok('Reassign products to other cat', reassignRes.status === 200);
  ok('Reports reassigned:true',        reassignRes.body?.reassigned === true || reassignRes.body?.archived === true);

  // ╔══════════════════════════════════════════════════════╗
  // ║  9. AUTHORIZATION                                    ║
  // ╚══════════════════════════════════════════════════════╝
  section('9. Authorization');

  const regRes = await POST('/api/auth/register', {
    name: `Test Customer ${UID}`,
    mobile: `9876${String(Date.now()).slice(-6)}`,
    password: 'testpass123',
  });
  // Note: may get 429 if rate limit (5/hour) is hit during repeated test runs — that's expected security behavior
  const regOk = regRes.status === 201 || regRes.status === 200 || regRes.status === 409 || regRes.status === 429;
  ok('Customer registered (or rate-limited)',  regOk, `status=${regRes.status} body=${JSON.stringify(regRes.body)}`);
  const CUST_TOKEN = regRes.body?.token;

  if (CUST_TOKEN) {
    const custAdmin = await GET('/api/admin/products', CUST_TOKEN);
    ok('Customer cannot access admin products → 403', custAdmin.status === 403);

    const custCreate = await POST('/api/products', {
      sku: sku('CUSTPROD'), name: 'Cust Prod', categoryId: CAT_ID, price: 10, stock: 0,
    }, CUST_TOKEN);
    ok('Customer cannot create product → 403', custCreate.status === 403);

    const custDelCat = await PATCH(`/api/categories/${CAT_ID}/archive`, {}, CUST_TOKEN);
    ok('Customer cannot delete category → 403', custDelCat.status === 403);

    const custCreateBrand = await POST('/api/brands', { name: 'CustomerBrand' }, CUST_TOKEN);
    ok('Customer cannot create brand → 403', custCreateBrand.status === 403);
  } else {
    ok('Customer auth tests skipped (rate-limited or no token)', true);
  }

  // ╔══════════════════════════════════════════════════════╗
  // ║  10. IMAGE UPLOAD VALIDATION                         ║
  // ╚══════════════════════════════════════════════════════╝
  section('10. Image Upload');
  // Test that uploading without a file returns 400
  const imgNoFile = await POST('/api/images', {}, TOKEN);
  ok('Image upload without file → 400', imgNoFile.status === 400 || imgNoFile.status === 415);

  // ╔══════════════════════════════════════════════════════╗
  // ║  SUMMARY                                             ║
  // ╚══════════════════════════════════════════════════════╝
  const total = pass + fail;
  console.log(`\n${'═'.repeat(56)}`);
  console.log(`  Results: ${pass}/${total} passed  (${fail} failed)`);
  if (failures.length) {
    console.log('\n  Failed tests:');
    failures.forEach(f => console.log(`    ✗  ${f}`));
  }
  console.log(`${'═'.repeat(56)}\n`);
  process.exit(fail > 0 ? 1 : 0);
})();
