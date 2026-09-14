# 🔧 FIX RENDER ENVIRONMENT VARIABLES

I can see your Render environment variables. Some need to be fixed before deploying.

---

## ⚠️ ISSUES TO FIX:

### 1. **ADMIN_EMAIL** - Currently Wrong
**Current value:** `monishkumar8110@gmail.com`
**Should be:** `owner@murugesan.in`

**Fix:**
1. Click the edit icon (pencil) next to ADMIN_EMAIL
2. Change value to: `owner@murugesan.in`
3. Click save

### 2. **UPLOAD_DIR** - Will Cause Issues
**Current value:** `/var/data/uploads`
**Problem:** Not writable on Render free tier
**Should be:** `/tmp/uploads`

**Fix:**
1. Click the edit icon (pencil) next to UPLOAD_DIR
2. Change value to: `/tmp/uploads`
3. Click save

⚠️ **Note:** `/tmp` is ephemeral - uploaded images will be lost on restart. For production, use cloud storage (S3, Cloudinary).

---

## ✅ CORRECT VALUES:

Here's what ALL your environment variables should be:

```
ADMIN_EMAIL = owner@murugesan.in
ADMIN_MOBILE = 9361866771
ADMIN_PASSWORD = Bu@240708
DATABASE_SSL = true
DATABASE_URL = postgresql://neondb_owner:npg_9GKyDRsFN5mL@ep-aged-darkness-b3bwqh1y-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
JWT_SECRET = murugesan-prod-jwt-secret-4c0a3f5e8b1d9c7e6a2b3d4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b
NODE_ENV = production
OWNER_WHATSAPP_NUMBER = 919361866771
PORT = 8787
SEED_DEMO_DATA = false
UPLOAD_DIR = /tmp/uploads
```

---

## 🚀 AFTER FIXING, DEPLOY:

1. **Save all changes** (click "Save Changes" button at bottom)

2. **Trigger deployment:**
   - Scroll to top
   - Click **"Manual Deploy"** button (top right)
   - Select **"Deploy latest commit"**
   - Wait 5 minutes

3. **Watch the logs:**
   - Click "Logs" tab
   - Look for success messages

4. **Test the site:**
   - Open: https://murugesan-electrical-and-hardwares.onrender.com
   - Login with: `owner@murugesan.in` / `Bu@240708`
   - Add a category
   - Add a product
   - Everything should work!

---

## 🎯 QUICK FIX CHECKLIST:

- [ ] Edit ADMIN_EMAIL → Change to `owner@murugesan.in`
- [ ] Edit UPLOAD_DIR → Change to `/tmp/uploads`
- [ ] Click "Save Changes" button
- [ ] Click "Manual Deploy" button
- [ ] Select "Deploy latest commit"
- [ ] Wait 5 minutes
- [ ] Test production site

---

## ✅ AFTER DEPLOYMENT:

Your site will work with these credentials:
- **Email:** owner@murugesan.in
- **Password:** Bu@240708

All fixes will be live:
- ✅ Add product works
- ✅ Add category works
- ✅ Delete category works
- ✅ Orders work
- ✅ Everything works!

---

**Fix those 2 variables, click deploy, wait 5 minutes, and you're done!** 🚀

