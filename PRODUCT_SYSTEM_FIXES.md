# Product/Catalog Management System Fixes

**Status:** In Progress  
**Started:** 2026-09-15

## Issues Identified

### 1. Product Fields & Validation
- ❌ Product type inferred from `details` field instead of using proper `product_type_id`
- ❌ Brand handled as text string instead of dropdown selection from database
- ❌ Missing server-side validation for all fields
- ❌ Attributes stored but not structured or validated against category schema
- ❌ Discount validation incomplete
- ❌ MRP can be less than price (invalid)

### 2. Image Storage
- ⚠️ Base64 images stored in product form state (memory issue)
- ✅ Upload endpoint exists (`/api/images`) but not consistently used
- ❌ No validation for image size/format
- ❌ Render uses /tmp which is ephemeral (files lost on restart)
- ❌ No image cleanup for deleted products

### 3. Brands Management
- ✅ Database-backed (brands table exists)
- ❌ Product form uses text input instead of searchable dropdown
- ❌ No brand search/autocomplete
- ❌ Duplicate brands can be created with slight variations
- ❌ No brand status check when assigning to products

### 4. Categories Management  
- ✅ Safe deletion with archive exists
- ❌ No reassignment flow for products when deleting category
- ⚠️ Product count shown but not always accurate
- ❌ Archived categories still appear in some dropdowns
- ❌ Category attributes exist but not enforced on products

### 5. Product Types
- ❌ Product types exist in DB but forms use `details` field as fallback
- ❌ No product type selector in product form
- ❌ Product types not tied to categories properly
- ❌ Attributes should be per product-type, not just per category

### 6. Dynamic Attributes
- ⚠️ Attribute schema exists in categories
- ❌ Not enforced during product creation/update
- ❌ No validation of attribute values against schema
- ❌ Not tied to product types (should be type-specific)

### 7. Bulk Import
- ⚠️ CSV import partially works
- ❌ Category auto-creation without validation
- ❌ No row-level transaction rollback
- ❌ Error reporting incomplete
- ❌ No duplicate SKU prevention within file
- ❌ Large imports (1000+ rows) may timeout

### 8. Search/Filter/Pagination
- ⚠️ Basic search exists
- ❌ No proper pagination (all products loaded)
- ❌ No sorting options
- ❌ Filtering by brand/price/stock incomplete
- ❌ No full-text search on product attributes

## Implementation Plan

### Phase 1: Backend Fixes (Tasks 2-8)
1. ✅ Add comprehensive input validators to `server/security.cjs`
2. Update product endpoints with proper validation
3. Fix product type handling (remove inference from details)
4. Add brand search endpoint
5. Improve category deletion with reassignment
6. Fix bulk import with proper transactions
7. Add pagination/filtering to product listing endpoint

### Phase 2: Frontend Fixes (Tasks 4-7)
1. Replace brand text input with searchable select
2. Add product type selector
3. Implement dynamic attribute forms
4. Fix image upload (remove base64)
5. Add category reassignment UI
6. Improve bulk import UX

### Phase 3: Testing (Tasks 10-11)
1. Test all CRUD operations
2. Test validation edge cases
3. Test bulk import with 100+ products
4. Test with duplicate SKUs
5. Test with invalid data

## Files to Modify

### Backend
- `server/index.cjs` - Add validation, fix endpoints
- `server/security.cjs` - Already has validators, may need additions

### Frontend
- `src/App.tsx` - Fix product form, add brand selector, product type selector

## Progress

- [x] Task 1: Analysis complete
- [ ] Task 2: Backend validation (IN PROGRESS)
- [ ] Task 3: Image storage fixes
- [ ] Task 4: Brand management UI
- [ ] Task 5: Category reassignment
- [ ] Task 6: Product type implementation
- [ ] Task 7: Dynamic attributes
- [ ] Task 8: Bulk import improvements
- [ ] Task 9: Search/filter/pagination
- [ ] Task 10: CRUD testing
- [ ] Task 11: Comprehensive testing

