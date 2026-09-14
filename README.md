# Murugesan Electrical and Hardwares - Production E-commerce Application

A complete e-commerce solution for Murugesan Electrical and Hardwares with admin panel, customer ordering, WhatsApp integration, and bulk product import.

## Features

### Customer Features
- Product browsing and search
- Category-based filtering
- Shopping cart management
- Customer registration and login
- Address management
- Order placement with idempotency protection
- WhatsApp-based order communication
- Order history viewing

### Admin Features
- Secure admin authentication (email or mobile)
- Real-time dashboard with statistics
- Product management (CRUD operations)
- Stock management
- Category management (with archive/restore)
- Brand management
- Bulk CSV product import with automatic category creation
- Order management and status tracking
- Customer WhatsApp order confirmations
- Business settings configuration

### Technical Features
- PostgreSQL/SQLite database support
- Transactional order processing
- Atomic stock management (prevents overselling)
- Request timeout protection (30s)
- Idempotent order creation
- Automatic database migrations
- Image upload support
- CORS security configuration

## Local Development

**Requirements:** Node.js 24+ (for `node:sqlite` module)

```bash
# Install dependencies
npm install

# Start API server
npm run dev:api

# Start frontend (in separate terminal)
npm run dev
```

The Vite development server proxies `/api` and `/uploads` to `http://localhost:8787`.

## Environment Configuration

Create a `.env` file based on `.env.example`:

### Required Variables

```bash
# Server
PORT=8787
JWT_SECRET=your-secure-random-secret-at-least-32-characters

# Admin Account (created automatically on first run)
ADMIN_EMAIL=owner@murugesan.in
ADMIN_MOBILE=9361866771
ADMIN_PASSWORD=your-secure-admin-password

# WhatsApp (for order notifications)
OWNER_WHATSAPP_NUMBER=919361866771

# Database
# Local development: SQLite (default)
# Production: PostgreSQL required
DATABASE_URL=postgresql://user:password@host:port/database

# Uploads
# WARNING: /tmp on Render is ephemeral - images lost on restart
# Use cloud storage (S3, Cloudinary) for production
UPLOAD_DIR=server/uploads

# Optional
SEED_DEMO_DATA=false
ALLOWED_ORIGINS=https://yourdomain.com
```

## Database

### Local Development (SQLite)
Database file: `server/data/catalog.sqlite`

Automatic features:
- Schema creation
- Migrations
- Admin account setup
- Backup creation

### Production (PostgreSQL)
**Required:** Set `DATABASE_URL` environment variable

Features:
- Full PostgreSQL schema support
- Automatic table creation
- Sequence synchronization
- Index optimization

## Architecture

### Backend (`server/index.cjs`)
- Express.js API server
- JWT authentication
- Role-based access control (ADMIN/CUSTOMER)
- Transaction-safe order processing
- Atomic stock updates
- Idempotency key support
- WhatsApp URL generation (click-to-chat only, no auto-send)

### Frontend (`src/App.tsx`)
- React 19 single-page application
- Customer store interface
- Admin dashboard
- Request timeout protection (30s)
- Optimistic UI updates
- localStorage for cart persistence

### Database Schema (`server/schema.sql`)
- Users (customers and admins)
- Addresses
- Products (with SKU, pricing, stock, attributes)
- Categories (hierarchical with archive support)
- Brands
- Product Types
- Orders (with idempotency and status history)
- Order Items
- Order Notifications

## Key APIs

### Public Endpoints
- `GET /api/catalog` - Active products and categories
- `GET /api/products` - Paginated product list with search
- `POST /api/auth/login` - User authentication
- `POST /api/auth/register` - Customer registration
- `GET /api/health` - Health check endpoint

### Protected Endpoints (Customer)
- `GET /api/me` - Current user profile
- `POST /api/me/orders` - Create order (idempotent)
- `GET /api/me/orders` - Order history
- `POST /api/me/addresses` - Address management

### Admin Endpoints
- `GET /api/admin/stats` - Real dashboard statistics
- `GET /api/admin/products` - Paginated product management
- `POST /api/products` - Create product
- `PATCH /api/products/:id` - Update product
- `POST /api/products/bulk-import` - CSV bulk import
- `GET /api/categories` - All categories (including archived)
- `POST /api/categories` - Create category
- `PATCH /api/categories/:id/archive` - Archive category
- `PATCH /api/categories/:id/restore` - Restore archived category
- `GET /api/admin/orders` - All orders
- `PATCH /api/orders/:id/confirm` - Confirm order (generates WhatsApp URL)

## WhatsApp Integration

**Important:** This application uses WhatsApp **Click-to-Chat** only.

### Customer Places Order
1. Order created successfully
2. Backend generates `wa.me` URL with pre-filled message
3. Frontend opens WhatsApp with owner's number
4. **Customer manually presses Send** in WhatsApp

### Owner Confirms Order
1. Admin clicks "Confirm Order"
2. Backend updates order status
3. Backend generates `wa.me` URL with confirmation message
4. **Owner manually presses Send** in WhatsApp

**No automatic sending occurs.** Notification status is "PREPARED" not "SENT".

## Bulk Import

CSV format with automatic category creation:

```csv
SKU,Product Name,Category,Brand,Product Type,Price,Discount,Stock,Description,Image 1,Status
SW001,MCB Switch,Electrical Switches,Havells,MCB,450,0,100,16A MCB,,ACTIVE
```

Features:
- Validates all rows before importing
- Creates missing categories automatically
- Restores archived categories if needed
- Normalizes category names (case-insensitive, whitespace-safe)
- Transactional (all-or-nothing)
- Detailed error reporting per row
- Supports update or skip for duplicates

## Production Deployment

### Render.com Configuration

See `render.yaml` for full configuration.

**Critical Settings:**
```yaml
env_vars:
  - JWT_SECRET: generateValue: true
  - DATABASE_URL: (link to Render PostgreSQL)
  - UPLOAD_DIR: /tmp/uploads  # WARNING: Ephemeral!
  - ADMIN_EMAIL: owner@murugesan.in
  - ADMIN_PASSWORD: (set securely)
  - OWNER_WHATSAPP_NUMBER: 919361866771
```

### Storage Warning
`/tmp/uploads` on Render is **ephemeral storage**. Images are lost on:
- Application restart
- Deployment
- Server scaling

**Production recommendation:** Integrate cloud storage:
- AWS S3
- Cloudinary
- Digital Ocean Spaces
- Azure Blob Storage

### Database Migration
To migrate SQLite to PostgreSQL:
```bash
node server/migrate-sqlite-to-postgres.cjs
```

## Security

### Implemented
✅ JWT authentication with 8-hour expiration
✅ Password hashing with bcrypt (12 rounds)
✅ Role-based access control
✅ CORS configuration with origin control
✅ Request body size limits (2MB)
✅ File upload size limits (10MB)
✅ SQL injection protection (prepared statements)
✅ Input validation and sanitization
✅ Idempotency protection for orders
✅ Request timeout protection (30s)

### Production Checklist
- [ ] Use strong `JWT_SECRET` (32+ random characters)
- [ ] Use strong `ADMIN_PASSWORD`
- [ ] Configure `ALLOWED_ORIGINS` for CORS
- [ ] Use PostgreSQL (not SQLite)
- [ ] Set up cloud storage for images
- [ ] Enable HTTPS
- [ ] Set up database backups
- [ ] Monitor error logs
- [ ] Configure rate limiting (future)

## Testing

```bash
# Build and verify
npm run build

# Check for issues
npm run lint
```

## Known Limitations

1. **Image Storage:** Temporary filesystem storage (not suitable for scaled production)
2. **Rate Limiting:** Not implemented (add nginx or Express rate limiter)
3. **Email Notifications:** Not implemented (WhatsApp only)
4. **Payment Gateway:** Cash on Delivery only
5. **Search:** Basic string matching (no full-text search)
6. **Analytics:** Basic statistics only

## Future Enhancements

- Cloud storage integration (S3/Cloudinary)
- Payment gateway integration
- Email notification system
- Advanced search with filters
- Customer reviews and ratings
- Wishlist functionality
- Promotional offers and coupons
- Real-time inventory alerts
- Advanced analytics dashboard

## License

Proprietary - Murugesan Electrical and Hardwares

## Support

For technical issues or questions, contact the development team.
