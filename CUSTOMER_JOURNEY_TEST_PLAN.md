# 🧪 CUSTOMER JOURNEY RELIABILITY TEST PLAN

**Application:** Murugesan Electrical E-commerce  
**Focus:** Customer Journey Reliability (Search, Cart, Checkout, Mobile)  
**Status:** ✅ All improvements implemented, ready for testing

---

## 🚀 PREPARATION

### 1. Start Servers
```bash
# Terminal 1 - Backend
npm run dev:api

# Terminal 2 - Frontend  
npm run dev
```

### 2. Open Browser
- URL: http://localhost:5173
- Press **F12** to open Developer Tools (keep open for console messages)

### 3. Clear Browser Data
- Open DevTools → Application → Local Storage
- Clear all data for localhost:5173
- This ensures clean test environment

---

## ✅ TEST 1: SEARCH FUNCTIONALITY

### Test 1.1: Backend Search with Debounce
**Steps:**
1. Click "Products" in navigation
2. Type "switch" in search box (type slowly)
3. ✅ **Expected:** 
   - Search doesn't trigger on every keystroke (debounce working)
   - Loading state shows "Searching products..."
   - Results appear after brief delay
4. Type "xyz123" (non-existent product)
5. ✅ **Expected:** 
   - Shows "No products found" message
   - No infinite spinner

### Test 1.2: Case-Insensitive Search
**Steps:**
1. Search for "MCB" (uppercase)
2. ✅ **Expected:** Products with "mcb" appear
3. Search for "mcb" (lowercase)  
4. ✅ **Expected:** Same results as uppercase search

### Test 1.3: Search Error Handling
**Steps:**
1. Open DevTools → Network tab
2. Throttle network to "Offline"
3. Type in search box
4. ✅ **Expected:** 
   - Shows "Search failed" error message
   - No infinite spinner
5. Restore network
6. ✅ **Expected:** Search works again

---

## ✅ TEST 2: PRODUCT DATA FRESHNESS

### Test 2.1: Fresh Product Data on Detail View
**Steps:**
1. Click on any product
2. ✅ **Expected:** Product detail opens
3. Note the stock quantity shown
4. Open admin panel in another tab
5. Change stock for that product
6. Go back to product detail and refresh
7. ✅ **Expected:** Updated stock shows (data fetched from server)

---

## ✅ TEST 3: CART OPERATIONS WITH STOCK VALIDATION

### Test 3.1: Add to Cart with Stock Limit
**Steps:**
1. Find a product with stock = 5
2. Add to cart 6 times
3. ✅ **Expected:** 
   - After 5th add: "Maximum stock reached for this item"
   - Cannot add 6th item
   - Cart shows quantity = 5

### Test 3.2: Quantity Adjustment with Stock Correction
**Steps:**
1. Add product to cart (stock = 3)
2. In cart, change quantity to 10
3. ✅ **Expected:** 
   - Shows notification: "Quantity adjusted to available stock (3)"
   - Quantity automatically set to 3

### Test 3.3: Out of Stock Handling
**Steps:**
1. Find product with stock = 0
2. Try to add to cart
3. ✅ **Expected:** 
   - Shows "This product is currently out of stock"
   - Product not added to cart
4. If already in cart from before:
5. ✅ **Expected:** Shows "Out of stock" label in cart

### Test 3.4: Cart Persistence with Stock Correction
**Steps:**
1. Add product to cart (stock = 5)
2. Set quantity to 5 in cart
3. Refresh page (F5)
4. ✅ **Expected:** Cart restored with quantity = 5
5. In admin, change stock to 2
6. Refresh page again
7. ✅ **Expected:** 
   - Shows notification: "Some cart quantities were adjusted to match current stock"
   - Quantity auto-corrected to 2

---

## ✅ TEST 4: STALE INVENTORY VALIDATION

### Test 4.1: Pre-Checkout Inventory Check
**Steps:**
1. Add product to cart (stock = 5)
2. Set quantity to 5
3. Go to checkout
4. In admin, change stock to 2
5. Click "Place Order"
6. ✅ **Expected:** 
   - Shows "Validating inventory..."
   - Shows error: "Some items in your cart have limited stock. Please review your cart before checkout."
   - Order not placed

### Test 4.2: Out of Stock at Checkout
**Steps:**
1. Add product to cart
2. In admin, set stock to 0
3. Go to checkout
4. Click "Place Order"
5. ✅ **Expected:** 
   - Shows error: "The following items are out of stock: [product name]. Please remove them from your cart."
   - Order not placed

---

## ✅ TEST 5: CHECKOUT VALIDATION

### Test 5.1: Empty Cart
**Steps:**
1. Clear cart
2. Go to checkout
3. ✅ **Expected:** 
   - Shows "Add at least one product to place an order"
   - Cannot proceed

### Test 5.2: Invalid Phone Number
**Steps:**
1. Add product to cart
2. Go to checkout
3. Enter invalid phone: "123"
4. Click "Place Order"
5. ✅ **Expected:** 
   - Shows "Please enter a valid WhatsApp-enabled mobile number."
   - Order not placed

### Test 5.3: Invalid GST Number
**Steps:**
1. Enter invalid GST: "ABC123"
2. Click "Place Order"
3. ✅ **Expected:** 
   - Shows "Please enter a valid GST number."
   - Order not placed

### Test 5.4: No Address Selected
**Steps:**
1. Remove all addresses from account
2. Go to checkout
3. ✅ **Expected:** 
   - Shows "No saved address. Add one from My Account before placing an order."
   - Button to go to My Account

---

## ✅ TEST 6: SERVER-SIDE TOTAL CALCULATION

### Test 6.1: Price Manipulation Prevention
**Steps:**
1. Add product to cart (price = 100)
2. Open DevTools → Console
3. Manipulate cart to change price to 10
4. Go to checkout
5. Click "Place Order"
6. ✅ **Expected:** 
   - Order created with correct price (100)
   - Server ignores manipulated price
   - Check order in admin to verify correct total

---

## ✅ TEST 7: LOADING/SUCCESS/FAILURE STATES

### Test 7.1: Search Loading State
**Steps:**
1. Type in search box
2. ✅ **Expected:** Shows "Searching products..." while loading
3. ✅ **Expected:** Loading indicator disappears when done

### Test 7.2: Cart Update Loading State
**Steps:**
1. In cart, change quantity
2. ✅ **Expected:** Buttons disabled during update
3. ✅ **Expected:** No error if update succeeds

### Test 7.3: Checkout Validation Loading
**Steps:**
1. Go to checkout
2. Click "Place Order"
3. ✅ **Expected:** Shows "Validating inventory..."
4. ✅ **Expected:** Then shows "PLACING ORDER..."

### Test 7.4: Error Retry
**Steps:**
1. Throttle network to "Offline"
2. Try to search
3. ✅ **Expected:** Shows "Search failed" error
4. Restore network
5. Search again
6. ✅ **Expected:** Search works (retry successful)

---

## ✅ TEST 8: MOBILE RESPONSIVENESS

### Test 8.1: Mobile Navigation
**Steps:**
1. Open DevTools → Toggle device toolbar (Ctrl+Shift+M)
2. Select mobile device (iPhone 12 or similar)
3. ✅ **Expected:** 
   - Hamburger menu button visible
   - Click menu → navigation dropdown appears
   - All menu items accessible

### Test 8.2: Mobile Product Grid
**Steps:**
1. On mobile view, go to Products page
2. ✅ **Expected:** 
   - 2-column grid layout
   - Product images responsive
   - Product names wrap properly
   - Add buttons full-width and touch-friendly

### Test 8.3: Mobile Cart
**Steps:**
1. Add products to cart
2. Go to cart on mobile
3. ✅ **Expected:** 
   - Cart items stack vertically
   - Quantity controls touch-friendly (min 36px)
   - Remove button accessible
   - Checkout button full-width

### Test 8.4: Mobile Checkout
**Steps:**
1. Go to checkout on mobile
2. ✅ **Expected:** 
   - Address selection works
   - Radio buttons touch-friendly (min 20px)
   - Place Order button full-width (min 48px)
   - Form fields min-height 46px

### Test 8.5: Mobile Touch Targets
**Steps:**
1. Test all buttons on mobile
2. ✅ **Expected:** 
   - All buttons min-height 44-48px
   - Easy to tap with finger
   - No buttons too close together

---

## ✅ TEST 9: EDGE CASES

### Test 9.1: Duplicate Checkout Click
**Steps:**
1. Add product to cart
2. Go to checkout
3. Double-click "Place Order" rapidly
4. ✅ **Expected:** 
   - Only one order created
   - Idempotency key prevents duplicate orders

### Test 9.2: Back Button During Checkout
**Steps:**
1. Go to checkout
2. Click browser back button
3. ✅ **Expected:** 
   - Returns to cart
   - No errors
   - Cart state preserved

### Test 9.3: Network Failure During Order
**Steps:**
1. Throttle network to "Offline"
2. Try to place order
3. ✅ **Expected:** 
   - Shows error after 30 seconds
   - "Request timed out. Please check your connection and try again."
   - Order not created

### Test 9.4: Refresh During Cart Operations
**Steps:**
1. Add product to cart
2. Refresh page
3. ✅ **Expected:** Cart restored from localStorage

### Test 9.5: Login/Logout with Cart
**Steps:**
1. Add products as guest
2. Login as customer
3. ✅ **Expected:** Cart preserved
4. Logout
5. Login again
6. ✅ **Expected:** Cart still there

---

## 🐛 DEBUGGING TIPS

### If Something Fails:

1. **Check Console (F12):**
   - Look for `[Search]`, `[Cart]`, `[Checkout]` prefixed messages
   - These show exactly what's happening

2. **Check Network Tab:**
   - Look for `/api/search` requests
   - Look for `/api/products/validate` requests
   - Look for `/api/me/orders` requests
   - Check response status and error messages

3. **Common Issues:**

   **"Search failed"**
   - Check if backend is running
   - Check Network tab for `/api/search` request
   - Verify search endpoint exists

   **"Cart quantity not updating"**
   - Check console for stock validation messages
   - Verify product stock in database
   - Check if product is out of stock

   **"Checkout validation error"**
   - Check console for validation error details
   - Verify customer has saved address
   - Check phone number format

---

## 📊 EXPECTED BEHAVIOR SUMMARY

| Operation | Time | Result |
|-----------|------|--------|
| Search query | < 1 second | Results with loading state |
| Empty search | Immediate | "No products found" message |
| Add to cart | < 1 second | Item added with notification |
| Stock limit hit | Immediate | "Maximum stock reached" message |
| Quantity adjustment | < 1 second | Quantity corrected with notification |
| Cart refresh | < 1 second | Cart restored with stock correction |
| Inventory validation | 1-2 seconds | "Validating inventory..." message |
| Checkout validation | < 1 second | Errors shown if invalid |
| Place order | 2-5 seconds | Order created + WhatsApp opens |
| Network error | 30 seconds | Timeout error message |

---

## ✅ VERIFICATION CHECKLIST

After testing all scenarios:

**Search:**
- [ ] Backend search works with debounce
- [ ] Case-insensitive matching works
- [ ] Loading state shows during search
- [ ] Empty results handled gracefully
- [ ] Error state shows on network failure

**Product Data:**
- [ ] Fresh data fetched on product detail
- [ ] Current stock/price always shown

**Cart:**
- [ ] Stock validation on add to cart
- [ ] Stock limit enforced
- [ ] Quantity adjustment with correction
- [ ] Out of stock items handled
- [ ] Cart persistence works
- [ ] Stock correction on restore

**Checkout:**
- [ ] Stale inventory validation before order
- [ ] Empty cart prevented
- [ ] Invalid phone rejected
- [ ] Invalid GST rejected
- [ ] No address handled
- [ ] Server calculates totals correctly

**Loading States:**
- [ ] Search loading state
- [ ] Cart update loading state
- [ ] Checkout validation loading state
- [ ] Error retry works

**Mobile:**
- [ ] Navigation works on mobile
- [ ] Product grid responsive
- [ ] Cart layout mobile-friendly
- [ ] Checkout form mobile-friendly
- [ ] Touch targets adequate (44-48px)

**Edge Cases:**
- [ ] Duplicate checkout prevented
- [ ] Back button handled
- [ ] Network failure timeout
- [ ] Refresh preserves state
- [ ] Login/logout preserves cart

**If all checked, customer journey is reliable!** 🎉

---

**IMPORTANT:** Keep browser console (F12) open while testing. It shows detailed messages for all operations.
