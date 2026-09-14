# Category Deletion Fix

## Problem
Categories appeared to "disappear" when deleted in the admin panel, but were actually being archived (not deleted) when they contained products. After page refresh, archived categories didn't reappear because the admin was loading categories from `/api/catalog` which only returns ACTIVE categories.

## Root Cause
1. Admin panel loaded categories from shared state populated by `/api/catalog`
2. `/api/catalog` endpoint filters to `status = 'ACTIVE'` only (line 1149 in server/index.cjs)
3. Backend correctly archives categories with products (line 1262 in server/index.cjs)
4. After archiving, category was removed from UI state immediately
5. On refresh, archived categories didn't reload (excluded by `/api/catalog`)

## Solution
1. **Added new endpoint loading function** (`loadAllCategories`) that fetches from `/api/categories` (returns all categories including archived)
2. **Admin loads all categories** on mount via useEffect hook
3. **Visual indicators** for archived categories:
   - "(Archived)" label displayed next to category name
   - Status shows "Archived" instead of Active/Inactive
4. **Updated filter** to include "Archived" option
5. **Restore functionality** - Archived categories show "Restore" button instead of Edit/Disable/Delete
6. **Better feedback** - When deleting:
   - If archived (has products): Category stays in list, marked as archived, message: "Category archived (contains products)"
   - If deleted (no products): Category removed from list, message: "Category deleted"

## Files Changed
- `src/App.tsx`:
  - Added `loadAllCategories()` function
  - Added useEffect in `Admin` component to load all categories
  - Updated `Category` type to include `status?: "ACTIVE" | "INACTIVE" | "ARCHIVED"`
  - Modified `DynamicCategoryManager`:
    - Updated filter logic to handle archived status
    - Added "Archived" to status dropdown
    - Added visual indicator for archived categories
    - Added restore button for archived categories
    - Updated `remove()` function to keep archived categories in state

## Testing
1. Login as admin (owner@murugesan.in / Bu@240708)
2. Navigate to Categories
3. Try to delete a category that has products:
   - Should see confirmation: "Archive [name]? This category contains X products"
   - After confirming, category stays visible with "(Archived)" label
   - Status shows "Archived"
   - Only "Restore" button available
4. Filter by "Archived" to see only archived categories
5. Click "Restore" to restore an archived category
6. Try to delete a category without products:
   - Should see confirmation: "Delete [name]?"
   - After confirming, category disappears completely
7. Refresh page - archived categories should remain visible

## API Endpoints Used
- `GET /api/categories` - Returns ALL categories (active, inactive, archived) - requires auth
- `GET /api/catalog` - Returns only ACTIVE categories and products - public
- `PATCH /api/categories/:id/archive` - Archives or deletes category
- `PATCH /api/categories/:id/restore` - Restores archived category

## Database Behavior (server/index.cjs lines 1262-1289)
```javascript
// If category has products → ARCHIVE
if (productCount > 0) {
  db.prepare("UPDATE categories SET status = 'ARCHIVED' WHERE id = ?").run(categoryId);
  return res.json({ ...category, status: 'ARCHIVED' });
}
// If no products → DELETE
db.prepare("DELETE FROM categories WHERE id = ?").run(categoryId);
res.json({ deleted: true });
```

## Benefits
1. **Transparency** - Admins can see what happened to categories
2. **Data safety** - Archived categories are preserved and can be restored
3. **Clear feedback** - User understands whether category was archived or deleted
4. **No surprises** - Archived categories persist across page refreshes
5. **Compliance** - Matches backend behavior (archive vs delete based on product count)
