# 🧪 ADMIN DASHBOARD TEST PLAN

**Application:** Murugesan Electrical E-commerce  
**Focus:** Admin Dashboard with Real Data  
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

### 2. Login as Admin
```
URL: http://localhost:5173
Email: owner@murugesan.in
Password: Bu@240708
```

### 3. Open Browser Console (IMPORTANT!)
Press **F12** on your keyboard to open Developer Tools
- You'll see helpful messages as you test
- Any errors will show here

---

## ✅ TEST 1: DASHBOARD WITH ZERO ORDERS

### Test 1.1: Empty Dashboard
**Steps:**
1. Login as admin
2. Go to Dashboard
3. ✅ **Expected:**
   - All metrics show 0
   - Today's Orders: 0
   - Pending Orders: 0
   - Confirmed Orders: 0
   - Processing Orders: 0
   - Delivered Orders: 0
   - Cancelled Orders: 0
   - Today's Revenue: ₹0
   - Total Revenue: ₹0
   - Total Products: [actual count]
   - Low Stock: [actual count]
   - Out of Stock: [actual count]
   - Total Customers: [actual count]
   - No fake data displayed

### Test 1.2: Refresh Button
**Steps:**
1. Click "Refresh" button
2. ✅ **Expected:**
   - Shows "Refreshing..."
   - Metrics reload
   - No errors

---

## ✅ TEST 2: DASHBOARD WITH ORDERS

### Test 2.1: Create Test Order
**Steps:**
1. Logout from admin
2. Register/login as customer
3. Add products to cart
4. Place order
5. ✅ **Expected:**
   - Order created successfully
   - WhatsApp opens

### Test 2.2: Dashboard Metrics Update
**Steps:**
1. Login as admin
2. Go to Dashboard
3. ✅ **Expected:**
   - Today's Orders: 1
   - Pending Orders: 1
   - Today's Revenue: [order total]
   - Total Revenue: [order total]
   - Total Customers: 1

### Test 2.3: Auto-Refresh
**Steps:**
1. Wait 30 seconds on Dashboard
2. ✅ **Expected:**
   - Metrics auto-refresh
   - No manual refresh needed

---

## ✅ TEST 3: CANCELLED ORDERS

### Test 3.1: Cancel Order
**Steps:**
1. Go to Orders page
2. Find pending order
3. Change status to "CANCELLED"
4. ✅ **Expected:**
   - Status updated successfully
   - Order shows as cancelled

### Test 3.2: Revenue Calculation
**Steps:**
1. Go to Dashboard
2. ✅ **Expected:**
   - Total Revenue: ₹0 (cancelled order excluded)
   - Today's Revenue: ₹0 (cancelled order excluded)
   - Cancelled Orders: 1
   - Revenue correctly excludes cancelled orders

---

## ✅ TEST 4: MULTIPLE CUSTOMERS

### Test 4.1: Register Multiple Customers
**Steps:**
1. Logout
2. Register as customer 1
3. Place order
4. Logout
5. Register as customer 2
6. Place order
7. ✅ **Expected:**
   - Both customers registered
   - Both orders created

### Test 4.2: Customer List
**Steps:**
1. Login as admin
2. Go to Customers page
3. ✅ **Expected:**
   - Shows both customers
   - Order counts correct
   - Total spent correct
   - Real customer data only

---

## ✅ TEST 5: INVENTORY CHANGES

### Test 5.1: Low Stock Products
**Steps:**
1. Go to Products page
2. Find product with stock < 10
3. ✅ **Expected:**
   - Dashboard shows Low Stock count
   - Warning indicator shown

### Test 5.2: Out of Stock Products
**Steps:**
1. Set product stock to 0
2. Go to Dashboard
3. ✅ **Expected:**
   - Out of Stock count increased
   - Warning indicator shown

### Test 5.3: Inventory Page
**Steps:**
1. Click "Inventory" button on Dashboard
2. ✅ **Expected:**
   - Navigates to Products page
   - Shows stock levels
   - Can update stock inline

---

## ✅ TEST 6: SETTINGS UPDATE

### Test 6.1: Load Settings
**Steps:**
1. Go to Settings page
2. ✅ **Expected:**
   - Shows "Loading settings..."
   - Current settings loaded from database
   - No fake defaults

### Test 6.2: Update Settings
**Steps:**
1. Change Business Name
2. Change Phone
3. Change GSTIN
4. Change Address
5. Click "Save settings"
6. ✅ **Expected:**
   - Shows "Saving..."
   - Success message: "Settings saved successfully"
   - Database updated
   - Values persist after refresh

### Test 6.3: Settings Persistence
**Steps:**
1. Refresh page (F5)
2. Go to Settings
3. ✅ **Expected:**
   - Updated values still shown
   - Not reverted to defaults

---

## ✅ TEST 7: QUICK ACTION BUTTONS

### Test 7.1: Manage Products
**Steps:**
1. Click "Manage Products" button
2. ✅ **Expected:**
   - Navigates to Products page
   - Shows product list

### Test 7.2: Manage Categories
**Steps:**
1. Click "Manage Categories" button
2. ✅ **Expected:**
   - Navigates to Categories page
   - Shows category list

### Test 7.3: View Orders
**Steps:**
1. Click "View Orders" button
2. ✅ **Expected:**
   - Navigates to Orders page
   - Shows order list

### Test 7.4: Inventory
**Steps:**
1. Click "Inventory" button
2. ✅ **Expected:**
   - Navigates to Products page (inventory mode)
   - Shows stock levels

### Test 7.5: Settings
**Steps:**
1. Click "Settings" button
2. ✅ **Expected:**
   - Navigates to Settings page
   - Shows settings form

---

## ✅ TEST 8: ORDERS MANAGEMENT

### Test 8.1: View Orders
**Steps:**
1. Go to Orders page
2. ✅ **Expected:**
   - Shows all orders
   - Real order data only
   - No fake orders

### Test 8.2: Search Orders
**Steps:**
1. Type order number in search box
2. ✅ **Expected:**
   - Results filtered
   - Matches order number

### Test 8.3: Filter by Status
**Steps:**
1. Select "Pending" from filter
2. ✅ **Expected:**
   - Shows only pending orders

### Test 8.4: Inspect Order Details
**Steps:**
1. Click on an order to expand
2. ✅ **Expected:**
   - Shows customer details
   - Shows items
   - Shows address
   - Shows status history

### Test 8.5: Change Status
**Steps:**
1. Change status from "Pending" to "Confirmed"
2. ✅ **Expected:**
   - Status updated
   - WhatsApp opens for customer notification
   - Status history updated

### Test 8.6: Safe Status Transitions
**Steps:**
1. Try to change status from "CANCELLED" to "PENDING"
2. ✅ **Expected:**
   - Error: Invalid status transition
   - Status not changed
   - Only valid transitions allowed

---

## ✅ TEST 9: ERROR HANDLING

### Test 9.1: Network Failure
**Steps:**
1. Throttle network to "Offline"
2. Try to load Dashboard
3. ✅ **Expected:**
   - Shows error message
   - "Failed to load dashboard stats"
   - No infinite spinner

### Test 9.2: Expired Admin Session
**Steps:**
1. Clear sessionStorage
2. Try to access admin pages
3. ✅ **Expected:**
   - Redirected to login
   - Unauthorized access blocked

### Test 9.3: Unauthorized Access
**Steps:**
1. Login as customer
2. Try to access `/api/admin/stats`
3. ✅ **Expected:**
   - 403 error
   - Access denied

---

## ✅ TEST 10: LOADING STATES

### Test 10.1: Dashboard Loading
**Steps:**
1. Go to Dashboard
2. ✅ **Expected:**
   - Loading state shown
   - Metrics appear after load

### Test 10.2: Orders Loading
**Steps:**
1. Go to Orders page
2. ✅ **Expected:**
   - "Loading orders..." shown
   - Orders appear after load

### Test 10.3: Settings Loading
**Steps:**
1. Go to Settings page
2. ✅ **Expected:**
   - "Loading settings..." shown
   - Settings appear after load

---

## 🐛 DEBUGGING TIPS

### If Something Fails:

1. **Check Console (F12):**
   - Look for red error messages
   - Check API request failures
   - Verify authentication

2. **Check Network Tab:**
   - Look for failed requests (red)
   - Check response status
   - Verify request payloads

3. **Common Issues:**

   **"Failed to load dashboard stats"**
   - Check if backend is running
   - Verify admin token
   - Check Network tab for `/api/admin/stats`

   **"Settings not persisting"**
   - Check if save succeeded
   - Verify database update
   - Check console for errors

   **"Orders not loading"**
   - Check admin authentication
   - Verify `/api/admin/orders` endpoint
   - Check database for orders

---

## 📊 EXPECTED BEHAVIOR SUMMARY

| Scenario | Expected Result |
|----------|----------------|
| Zero orders | All metrics 0 except products/customers |
| With orders | Metrics reflect real data |
| Cancelled order | Revenue excludes cancelled |
| Multiple customers | Customer list shows all |
| Inventory changes | Stock counts update |
| Settings update | Database updated, values persist |
| Quick actions | Navigate to correct pages |
| Orders management | View, search, filter, sort work |
| Status changes | Safe transitions enforced |
| Network failure | Error message shown |
| Expired session | Redirect to login |
| Loading states | Loading indicators shown |

---

## ✅ VERIFICATION CHECKLIST

After testing all scenarios:

**Dashboard:**
- [ ] No fake data displayed
- [ ] Metrics use real API data
- [ ] Revenue excludes cancelled orders
- [ ] Refresh button works
- [ ] Auto-refresh every 30 seconds
- [ ] Loading state shown
- [ ] Error handling works

**Quick Actions:**
- [ ] Manage Products navigates correctly
- [ ] Manage Categories navigates correctly
- [ ] View Orders navigates correctly
- [ ] Inventory navigates correctly
- [ ] Settings navigates correctly

**Orders:**
- [ ] Real order data only
- [ ] Search works
- [ ] Filter works
- [ ] Sort works
- [ ] Status changes work
- [ ] Safe transitions enforced
- [ ] WhatsApp notification on confirm
- [ ] Status history shown

**Inventory:**
- [ ] Real stock data
- [ ] Low stock count accurate
- [ ] Out of stock count accurate
- [ ] Stock updates work
- [ ] Inline stock editing works

**Customers:**
- [ ] Real customer records
- [ ] Order counts correct
- [ ] Total spent correct
- [ ] No fake customers

**Settings:**
- [ ] Loads from database
- [ ] Saves to database
- [ ] Values persist after refresh
- [ ] Success message on save
- [ ] Error message on failure

**Error Handling:**
- [ ] Network failure handled
- [ ] Expired session handled
- [ ] Unauthorized access blocked
- [ ] Loading states shown
- [ ] Error messages shown

**If all checked, admin dashboard is reliable!** 🎉

---

**IMPORTANT:** Keep browser console (F12) open while testing. It shows detailed messages for all operations.
