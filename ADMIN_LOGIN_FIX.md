# Admin Login Fix - January 2025

## Issue
Owner was unable to login to the admin panel.

## Root Cause
The admin account existed in the database but the password hash was corrupted or incorrect. Password verification was failing:
- Email: `owner@murugesan.in` ✓ (existed)
- Role: `ADMIN` ✓ (correct)
- Status: `ACTIVE` ✓ (correct)
- Password hash: ✗ (did not match configured password)

## Solution
Reset the password hash in the database to match the configured password from `.env`:

```bash
# The password hash was regenerated and updated in the database
Password: Bu@240708
```

## Verification
Tested login endpoint successfully:
```bash
POST /api/auth/login
{
  "email": "owner@murugesan.in",
  "password": "Bu@240708"
}

Response: ✓ SUCCESS
{
  "token": "eyJ...",
  "user": {
    "id": 1,
    "name": "Store Owner",
    "email": "owner@murugesan.in",
    "role": "ADMIN",
    "mobile": "9361866771"
  }
}
```

## Current Admin Credentials
**Email:** `owner@murugesan.in`  
**Password:** `Bu@240708`  
**Role:** `ADMIN`  
**Mobile:** `9361866771`

## Prevention
The `ensureCoreAdminAccount()` function only creates the admin if it doesn't exist. Since the admin already existed with a wrong password, it didn't update it. This is correct behavior to prevent overwriting passwords on server restarts.

For production deployment, ensure the admin account is created fresh with the correct password from environment variables.

## Files Modified
- Database: `server/data/catalog.sqlite` (password hash updated)
- No code changes required - login logic was working correctly

## Status
✅ FIXED - Owner can now login successfully
