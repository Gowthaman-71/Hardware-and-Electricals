# 🧪 WHATSAPP ORDERING RELIABILITY TEST PLAN

**Application:** Murugesan Electrical E-commerce  
**Focus:** WhatsApp Ordering Reliability  
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

### 3. Verify Owner WhatsApp Number
Check backend configuration:
- Environment variable: `OWNER_WHATSAPP_NUMBER` or `WHATSAPP_OWNER_NUMBER`
- Default: `919361866771`
- Should be normalized to 10-digit format

---

## ✅ TEST 1: NORMAL ORDER FLOW

### Test 1.1: Standard Order with GST
**Steps:**
1. Login as customer or register
2. Add products to cart
3. Go to checkout
4. Fill customer details:
   - Name: "Test Customer"
   - Phone: "9876543210"
   - Address: Select or add address
   - GST Number: "22AAAAA0000A1Z5" (optional)
5. Click "Place Order"
6. ✅ **Expected:**
   - Button shows "PLACING ORDER..."
   - Button disabled during submission
   - Order created successfully
   - WhatsApp opens with pre-filled message
   - Message contains:
     - Business name: "Murugesan Electrical and Hardwares"
     - Order number: "MH-XXXXXX"
     - Customer name
     - Mobile number
     - GST number (if provided)
     - Delivery address
     - Product names with quantities and prices
     - Subtotal
     - Total
   - No duplicate fields (Mobile/Phone shown only once)

### Test 1.2: Standard Order without GST
**Steps:**
1. Same as Test 1.1, but leave GST number empty
2. ✅ **Expected:**
   - Order created successfully
   - WhatsApp message does NOT include GST field
   - Message format clean without empty GST line

---

## ✅ TEST 2: DUPLICATE CLICK PREVENTION

### Test 2.1: Rapid Double-Click
**Steps:**
1. Add products to cart
2. Go to checkout
3. Fill details
4. Double-click "Place Order" button rapidly
5. ✅ **Expected:**
   - Only one order created
   - Button disabled after first click
   - Idempotency key prevents duplicate
   - Check admin panel - only one order

### Test 2.2: Click During Validation
**Steps:**
1. Go to checkout
2. Click "Place Order"
3. Immediately click again while "Validating inventory..." shows
4. ✅ **Expected:**
   - Button disabled during validation
   - Second click ignored
   - Only one order created

---

## ✅ TEST 3: WHATSAPP OPENING FAILURE

### Test 3.1: WhatsApp Not Installed
**Steps:**
1. Uninstall WhatsApp from device (or use device without WhatsApp)
2. Place order
3. ✅ **Expected:**
   - Order created successfully
   - Shows: "Order MH-XXXXXX was created successfully, but WhatsApp could not be opened."
   - "Try WhatsApp Again" button appears
   - Order visible in order history
   - Notification status: NOT_ATTEMPTED

### Test 3.2: Popup Blocker
**Steps:**
1. Enable popup blocker in browser
2. Place order
3. ✅ **Expected:**
   - Order created successfully
   - Shows failure message
   - "Try WhatsApp Again" button appears
   - User can click to retry

### Test 3.3: Try WhatsApp Again
**Steps:**
1. After WhatsApp failure, click "Try WhatsApp Again"
2. ✅ **Expected:**
   - WhatsApp opens
   - Notification status updated to OPENED
   - Success message shows
   - "Try WhatsApp Again" button disappears

---

## ✅ TEST 4: NOTIFICATION STATE TRACKING

### Test 4.1: Check Notification Status
**Steps:**
1. Place order successfully
2. WhatsApp opens
3. Check database or admin panel for notification status
4. ✅ **Expected:**
   - Initial status: NOT_ATTEMPTED
   - After WhatsApp opens: OPENED
   - Order notification_status matches

### Test 4.2: Failed Notification
**Steps:**
1. Simulate WhatsApp failure (block popup)
2. Place order
3. ✅ **Expected:**
   - Order created
   - Notification status: NOT_ATTEMPTED (not FAILED yet)
   - Can retry with "Try WhatsApp Again"

---

## ✅ TEST 5: MOBILE BROWSER

### Test 5.1: Mobile Order Flow
**Steps:**
1. Open DevTools → Toggle device toolbar (Ctrl+Shift+M)
2. Select mobile device (iPhone 12 or Android)
3. Add products to cart
4. Go to checkout
5. Place order
6. ✅ **Expected:**
   - Touch targets adequate (min 44-48px)
   - Form fields easy to tap
   - WhatsApp app opens (if installed)
   - Message format correct on mobile

### Test 5.2: Mobile WhatsApp
**Steps:**
1. On mobile device with WhatsApp installed
2. Place order
3. ✅ **Expected:**
   - WhatsApp app opens
   - Pre-filled message appears
   - Customer can send message

---

## ✅ TEST 6: DESKTOP BROWSER

### Test 6.1: Desktop WhatsApp Web
**Steps:**
1. On desktop browser
2. Place order
3. ✅ **Expected:**
   - WhatsApp Web opens in new tab
   - Pre-filled message appears
   - Customer can send via WhatsApp Web

### Test 6.2: Desktop WhatsApp Desktop App
**Steps:**
1. On desktop with WhatsApp Desktop app installed
2. Place order
3. ✅ **Expected:**
   - WhatsApp Desktop app opens
   - Pre-filled message appears

---

## ✅ TEST 7: NETWORK FAILURE

### Test 7.1: Network Timeout
**Steps:**
1. Throttle network to "Offline"
2. Try to place order
3. ✅ **Expected:**
   - Shows timeout error after 30 seconds
   - "Request timed out. Please check your connection and try again."
   - Order NOT created
   - Button re-enabled

### Test 7.2: Network Recovery
**Steps:**
1. After timeout, restore network
2. Try to place order again
3. ✅ **Expected:**
   - Order created successfully
   - WhatsApp opens

---

## ✅ TEST 8: INVALID PHONE

### Test 8.1: Invalid Format
**Steps:**
1. Enter invalid phone: "123"
2. Try to place order
3. ✅ **Expected:**
   - Shows: "Please enter a valid WhatsApp-enabled mobile number."
   - Order NOT created

### Test 8.2: Missing Phone
**Steps:**
1. Leave phone empty
2. Try to place order
3. ✅ **Expected:**
   - Shows validation error
   - Order NOT created

---

## ✅ TEST 9: LONG PRODUCT LIST

### Test 9.1: Many Items in Cart
**Steps:**
1. Add 10+ different products to cart
2. Place order
3. ✅ **Expected:**
   - All items included in WhatsApp message
   - Message format remains readable
   - Each item shows: name, quantity, price, total
   - Subtotal and total calculated correctly

### Test 9.2: Large Quantities
**Steps:**
1. Add product with quantity 50
2. Place order
3. ✅ **Expected:**
   - Message shows correct quantity
   - Item total calculated correctly
   - Order total correct

---

## ✅ TEST 10: SPECIAL CHARACTERS

### Test 10.1: Product Names with Special Characters
**Steps:**
1. Add product with special characters in name (e.g., "MCB 16A-32A")
2. Place order
3. ✅ **Expected:**
   - Special characters preserved in message
   - Message format intact
   - No encoding issues

### Test 10.2: Address with Special Characters
**Steps:**
1. Use address with special characters (e.g., "#123, Street-A")
2. Place order
3. ✅ **Expected:**
   - Address formatted correctly in message
   - Special characters preserved

---

## ✅ TEST 11: BACK BUTTON

### Test 11.1: Back During Submission
**Steps:**
1. Click "Place Order"
2. Click browser back button immediately
3. ✅ **Expected:**
   - Returns to cart
   - No errors
   - Cart state preserved

### Test 11.2: Back After Order Created
**Steps:**
1. Place order successfully
2. Click browser back button
3. ✅ **Expected:**
   - Returns to cart (now empty)
   - Order still exists in order history
   - Can view order details

---

## ✅ TEST 12: REFRESH BEHAVIOR

### Test 12.1: Refresh During Submission
**Steps:**
1. Click "Place Order"
2. Refresh page (F5)
3. ✅ **Expected:**
   - Cart state preserved
   - Can retry order
   - No duplicate order created (idempotency)

---

## ✅ TEST 13: GST NUMBER HANDLING

### Test 13.1: Valid GST
**Steps:**
1. Enter valid GST: "22AAAAA0000A1Z5"
2. Place order
3. ✅ **Expected:**
   - Message includes: "GST: 22AAAAA0000A1Z5"
   - GST preserved in order record

### Test 13.2: Invalid GST
**Steps:**
1. Enter invalid GST: "ABC123"
2. Try to place order
3. ✅ **Expected:**
   - Shows: "Please enter a valid GST number."
   - Order NOT created

### Test 13.3: No GST
**Steps:**
1. Leave GST empty
2. Place order
3. ✅ **Expected:**
   - Order created successfully
   - Message does NOT include GST field
   - No empty GST line in message

---

## ✅ TEST 14: MESSAGE FORMAT VERIFICATION

### Test 14.1: Complete Message Check
**Steps:**
1. Place order with GST
2. Copy WhatsApp message
3. ✅ **Expected:**
   ```
   Hello Murugesan Electrical and Hardwares, I have placed an order.
   
   Order: MH-XXXXXX
   Customer: [Name]
   Mobile: [Phone]
   GST: [GST Number]
   
   Delivery address:
   [Address]
   
   Items:
   - [Product Name] x[Qty] @ [Price] = [Total]
   - [Product Name] x[Qty] @ [Price] = [Total]
   
   Subtotal: [Amount]
   Total: [Amount]
   
   Please confirm my order.
   ```

### Test 14.2: No Duplicate Fields
**Steps:**
1. Check message for duplicate customer fields
2. ✅ **Expected:**
   - Only "Mobile:" shown once
   - No "Phone:" field (unless genuinely different)
   - No duplicate address fields

---

## ✅ TEST 15: OWNER NUMBER SECURITY

### Test 15.1: Owner Number from Backend
**Steps:**
1. Check frontend source code
2. ✅ **Expected:**
   - Owner WhatsApp number NOT hardcoded in frontend
   - Only comes from backend response
   - Environment variable: `OWNER_WHATSAPP_NUMBER`

### Test 15.2: Fallback Number
**Steps:**
1. Check backend configuration
2. ✅ **Expected:**
   - Default fallback: "919361866771"
   - Can be overridden by environment variable
   - Normalized to 10-digit format

---

## 🐛 DEBUGGING TIPS

### If Something Fails:

1. **Check Console (F12):**
   - Look for WhatsApp-related errors
   - Check notification status updates
   - Verify order creation success

2. **Check Network Tab:**
   - Look for `/api/me/orders` request
   - Look for `/api/notifications/:id/status` request
   - Check response status and data

3. **Check Database:**
   - Verify order created in `orders` table
   - Check `notification_status` field
   - Check `order_notifications` table

4. **Common Issues:**

   **"WhatsApp could not be opened"**
   - Check if WhatsApp installed
   - Check popup blocker settings
   - Try "Try WhatsApp Again" button

   **"Duplicate order created"**
   - Check idempotency key logic
   - Verify button disabled during submission
   - Check database for duplicate orders

   **"GST not showing in message"**
   - Verify GST number provided
   - Check if GST validation passed
   - Check message generation logic

---

## 📊 EXPECTED BEHAVIOR SUMMARY

| Scenario | Expected Result |
|----------|----------------|
| Normal order with GST | Order created + WhatsApp opens + GST in message |
| Normal order without GST | Order created + WhatsApp opens + No GST in message |
| Duplicate click | Only one order created |
| WhatsApp not installed | Order created + Failure message + Retry button |
| Popup blocker | Order created + Failure message + Retry button |
| Try WhatsApp Again | WhatsApp opens + Status updated to OPENED |
| Mobile browser | Touch-friendly + WhatsApp app opens |
| Desktop browser | WhatsApp Web/Desktop opens |
| Network timeout | Timeout error + Order NOT created |
| Invalid phone | Validation error + Order NOT created |
| Long product list | All items in message + Format readable |
| Special characters | Characters preserved + No encoding issues |
| Back button | Returns to cart + No errors |
| Refresh | Cart preserved + No duplicate order |

---

## ✅ VERIFICATION CHECKLIST

After testing all scenarios:

**Message Format:**
- [ ] Business name in message
- [ ] Order number in message
- [ ] Customer name in message
- [ ] Mobile number in message (once)
- [ ] GST number in message (when provided)
- [ ] No GST field when not provided
- [ ] Delivery address in message
- [ ] Product names with quantities
- [ ] Unit prices in message
- [ ] Item totals in message
- [ ] Subtotal in message
- [ ] Total in message
- [ ] No duplicate customer fields

**Duplicate Prevention:**
- [ ] Button disabled during submission
- [ ] Idempotency key prevents duplicates
- [ ] Only one order created on double-click

**WhatsApp Failure:**
- [ ] Order created even if WhatsApp fails
- [ ] Clear failure message shown
- [ ] "Try WhatsApp Again" button appears
- [ ] Order visible in history
- [ ] Retry works correctly

**Notification Tracking:**
- [ ] Initial status: NOT_ATTEMPTED
- [ ] Status updates to OPENED on success
- [ ] Status can be updated via API
- [ ] Order notification_status matches

**Owner Number:**
- [ ] Owner number from backend config only
- [ ] Not hardcoded in frontend
- [ ] Environment variable configurable

**Cross-Platform:**
- [ ] Works on mobile browser
- [ ] Works on desktop browser
- [ ] WhatsApp app opens on mobile
- [ ] WhatsApp Web opens on desktop
- [ ] Touch targets adequate on mobile

**Edge Cases:**
- [ ] Network timeout handled
- [ ] Invalid phone rejected
- [ ] Long product lists handled
- [ ] Special characters preserved
- [ ] Back button handled
- [ ] Refresh handled

**If all checked, WhatsApp ordering is reliable!** 🎉

---

**IMPORTANT:** Keep browser console (F12) open while testing. It shows detailed messages for WhatsApp operations.
