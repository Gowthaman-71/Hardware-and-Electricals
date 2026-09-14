# 🚀 RENDER DEPLOYMENT GUIDE

**Production URL:** https://murugesan-electrical-and-hardwares.onrender.com  
**Status:** Needs redeployment with latest fixes

---

## 🔄 HOW TO REDEPLOY TO RENDER

### Option 1: Automatic Deployment (Recommended)
Render automatically deploys when you push to the `main` branch.

**Steps:**
1. All your changes are already pushed to GitHub ✅
2. Go to Render Dashboard: https://dashboard.render.com
3. Find your service: `hardware-and-electricals`
4. Click **"Manual Deploy"** → **"Deploy latest commit"**
5. Wait 3-5 minutes for build to complete
6. Site will be live at: https://murugesan-electrical-and-hardwares.onrender.com

### Option 2: Manual Trigger
If auto-deploy is disabled:
1. Go to Render Dashboard
2. Click on your service
3. Click **"Manual Deploy"**
4. Select **"Clear build cache & deploy"** (if having issues)
5. Wait for deployment

---

## ⚙️ REQUIRED ENVIRONMENT VARIABLES ON RENDER

Make sure these are set in your Render dashboard:

### Required (MUST SET):
```
DATABASE_URL=postgresql://username:password@host:port/database
```
**Important:** You MUST have a PostgreSQL database. Get connection string from:
- Render PostgreSQL (create one in same account)
- Supabase
- Neon
- Railway
- Any PostgreSQL provider

```
JWT_SECRET=your-long-random-secret-at-least-32-characters
ADMIN_EMAIL=owner@murugesan.in
ADMIN_PASSWORD=Bu@240708
```

### Recommended:
```
ADMIN_MOBILE=9361866771
OWNER_WHATSAPP_NUMBER=919361866771
SEED_DEMO_DATA=false
UPLOAD_DIR=/tmp/uploads
```

### Optional (WhatsApp Cloud API - leave blank if not using):
```
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
```

---

## 🗄️ DATABASE SETUP

### If You Don't Have PostgreSQL Database Yet:

#### Option A: Render PostgreSQL (Recommended)
1. In Render Dashboard, click **"New +"**
2. Select **"PostgreSQL"**
3. Choose free plan
4. Name: `murugesan-electrical-db`
5. Click **Create Database**
6. Copy the **"External Database URL"**
7. Add it to your web service as `DATABASE_URL`

#### Option B: Supabase (Free, Easy)
1. Go to https://supabase.com
2. Create new project
3. Go to Settings → Database
4. Copy **Connection string** (URI format)
5. Replace `[YOUR-PASSWORD]` with your actual password
6. Add to Render as `DATABASE_URL`

#### Option C: Neon (Serverless PostgreSQL)
1. Go to https://neon.tech
2. Create new project
3. Copy connection string
4. Add to Render as `DATABASE_URL`

---

## 📝 SETTING ENVIRONMENT VARIABLES ON RENDER

1. Go to your service in Render Dashboard
2. Click **"Environment"** tab
3. Add each variable:
   - Click **"Add Environment Variable"**
   - Enter **Key** (e.g., `DATABASE_URL`)
   - Enter **Value** (e.g., your PostgreSQL connection string)
   - Click **"Save Changes"**
4. After adding all variables, service will redeploy automatically

---

## ✅ VERIFY DEPLOYMENT

### 1. Check Build Logs:
- Go to service → **"Logs"** tab
- Look for:
  ```
  ✅ Build successful
  ✅ Catalog API listening on http://0.0.0.0:10000
  ```

### 2. Test Production Site:
Open: https://murugesan-electrical-and-hardwares.onrender.com

**Expected:**
- ✅ Site loads
- ✅ Can browse catalog
- ✅ Can login as admin
- ✅ Can add categories
- ✅ Can add products

### 3. Check API Health:
Open: https://murugesan-electrical-and-hardwares.onrender.com/api/health

**Expected Response:**
```json
{
  "ok": true,
  "database": "postgresql",
  "environment": "production",
  "productionDatabaseConfigured": true
}
```

---

## 🐛 TROUBLESHOOTING

### Site Shows "Service Unavailable"
**Cause:** Service is spinning down (free tier sleeps after 15 min)  
**Fix:** Wait 30-60 seconds, refresh page. Service will wake up.

### Site Shows Blank Page
**Causes:**
1. Build failed
2. Environment variables missing
3. Database not connected

**Fixes:**
1. Check Render logs for build errors
2. Verify all environment variables are set
3. Check DATABASE_URL is correct
4. Try "Clear build cache & deploy"

### "Database connection failed"
**Causes:**
1. DATABASE_URL not set
2. Wrong connection string
3. Database not accessible

**Fixes:**
1. Verify DATABASE_URL is set in Environment tab
2. Test connection string locally first
3. Make sure PostgreSQL database is running
4. Check database allows external connections

### Admin Login Not Working
**Causes:**
1. Admin user not created in database
2. Wrong credentials
3. JWT_SECRET not set

**Fixes:**
1. Check server logs for "Admin user seeded" message
2. Verify ADMIN_EMAIL and ADMIN_PASSWORD match what you're entering
3. Set JWT_SECRET environment variable
4. Redeploy after setting variables

### Add Product/Category Not Working
**Likely:** Old code deployed before fixes

**Fix:**
1. Verify latest commit is deployed
2. Check commit message should be: "🔧 CRITICAL: Fixed all add/delete/order issues"
3. If not, trigger manual deploy
4. Clear browser cache (Ctrl+Shift+Delete)

---

## 🔍 CHECKING DEPLOYED VERSION

To verify the latest code is deployed:

1. Check Render logs for deployment timestamp
2. Should show recent deployment
3. Or check GitHub: latest commit should match Render

**Latest commit should be:**
```
1cb4a0a - 📝 Add comprehensive test instructions
6e259d0 - 🔧 CRITICAL: Fixed all add/delete/order issues
```

If you see older commits, trigger a new deployment.

---

## ⚠️ IMPORTANT NOTES

### File Uploads on Render:
- Uses `/tmp/uploads` (ephemeral storage)
- **Files are deleted on restart/redeploy**
- For permanent storage, integrate cloud storage:
  - AWS S3
  - Cloudinary
  - Uploadcare
  - Any CDN/storage service

### Database Migrations:
- First deployment will auto-create all tables
- Check logs for "Schema setup complete"
- Admin user auto-created from env vars

### Free Tier Limitations:
- Service sleeps after 15 minutes of inactivity
- 750 hours/month (enough for 24/7 if only one service)
- Slow cold starts (30-60 seconds)
- Consider paid plan for production

---

## 🚀 DEPLOYMENT CHECKLIST

Before deploying, verify:

- [ ] Code pushed to GitHub main branch
- [ ] Latest commit includes all fixes
- [ ] DATABASE_URL configured (PostgreSQL)
- [ ] JWT_SECRET set (32+ characters)
- [ ] ADMIN_EMAIL set
- [ ] ADMIN_PASSWORD set
- [ ] SEED_DEMO_DATA set to "false"
- [ ] All environment variables saved
- [ ] Database is accessible
- [ ] Render service is active

After deploying, verify:

- [ ] Build completed successfully
- [ ] No errors in logs
- [ ] Site loads at production URL
- [ ] /api/health returns OK
- [ ] Can login as admin
- [ ] Can add categories
- [ ] Can add products
- [ ] All fixes working

---

## 📞 SUPPORT

If deployment fails:

1. **Check Render Logs:**
   - Dashboard → Service → Logs tab
   - Look for red error messages

2. **Check Environment Variables:**
   - Dashboard → Service → Environment tab
   - Verify all required vars are set

3. **Check Database:**
   - Verify DATABASE_URL is correct
   - Test connection with pgAdmin or similar

4. **Clear Cache and Retry:**
   - Manual Deploy → "Clear build cache & deploy"

---

## ✅ SUCCESS CRITERIA

Deployment is successful when:

- ✅ Site loads without errors
- ✅ Admin can login
- ✅ Categories can be added
- ✅ Products can be added
- ✅ Orders can be placed
- ✅ All operations complete within 30 seconds
- ✅ No console errors

---

**After following this guide, your production site should be fully functional!** 🎉

