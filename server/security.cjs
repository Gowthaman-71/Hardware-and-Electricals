/**
 * Security Middleware and Utilities
 * Implements rate limiting, input validation, security headers, and error sanitization
 */

const jwt = require('jsonwebtoken');

// Rate limiting store (in-memory - use Redis for production scaling)
const rateLimitStore = new Map();

/**
 * Rate Limiting Middleware
 * Prevents brute-force attacks on sensitive endpoints
 */
function rateLimit(options = {}) {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    maxRequests = 50, // 50 requests per window
    keyGenerator = (req) => req.ip || req.connection.remoteAddress,
    message = 'Too many requests, please try again later',
    statusCode = 429,
    skipSuccessfulRequests = false
  } = options;

  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();
    
    // Clean up old entries periodically
    if (Math.random() < 0.01) { // 1% chance to clean
      for (const [k, v] of rateLimitStore.entries()) {
        if (now - v.resetTime > windowMs) {
          rateLimitStore.delete(k);
        }
      }
    }

    // Get or create rate limit entry
    let limitEntry = rateLimitStore.get(key);
    if (!limitEntry || now > limitEntry.resetTime) {
      limitEntry = {
        count: 0,
        resetTime: now + windowMs,
        firstRequest: now
      };
      rateLimitStore.set(key, limitEntry);
    }

    // Check if limit exceeded
    if (limitEntry.count >= maxRequests) {
      const retryAfter = Math.ceil((limitEntry.resetTime - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      res.set('X-RateLimit-Limit', String(maxRequests));
      res.set('X-RateLimit-Remaining', '0');
      res.set('X-RateLimit-Reset', new Date(limitEntry.resetTime).toISOString());
      return res.status(statusCode).json({ error: message });
    }

    // Increment counter (optionally skip on success)
    limitEntry.count++;

    // Set rate limit headers
    res.set('X-RateLimit-Limit', String(maxRequests));
    res.set('X-RateLimit-Remaining', String(maxRequests - limitEntry.count));
    res.set('X-RateLimit-Reset', new Date(limitEntry.resetTime).toISOString());

    // If skipSuccessfulRequests, decrement on successful response
    if (skipSuccessfulRequests) {
      const originalSend = res.json;
      res.json = function(data) {
        if (res.statusCode < 400) {
          limitEntry.count = Math.max(0, limitEntry.count - 1);
        }
        return originalSend.call(this, data);
      };
    }

    next();
  };
}

/**
 * Strict rate limiting for authentication endpoints
 */
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10, // Only 10 login attempts per 15 minutes
  message: 'Too many login attempts, please try again after 15 minutes',
  skipSuccessfulRequests: true // Don't count successful logins
});

/**
 * Moderate rate limiting for registration
 */
const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 5, // 5 registrations per hour per IP
  message: 'Too many registration attempts, please try again later'
});

/**
 * General API rate limiting
 */
const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100, // 100 requests per 15 minutes
  message: 'Too many requests, please slow down'
});

/**
 * Security Headers Middleware
 * Adds security headers to all responses
 */
function securityHeaders(req, res, next) {
  // Prevent MIME type sniffing
  res.set('X-Content-Type-Options', 'nosniff');
  
  // Prevent clickjacking
  res.set('X-Frame-Options', 'DENY');
  
  // Enable XSS protection
  res.set('X-XSS-Protection', '1; mode=block');
  
  // Referrer policy
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Remove powered-by header
  res.removeHeader('X-Powered-By');
  
  // Content Security Policy (adjusted for e-commerce)
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:", // React needs eval, add blob for modules
    "style-src 'self' 'unsafe-inline'", // Inline styles for React
    "img-src 'self' data: https: blob:", // Allow data URIs and external images
    "font-src 'self' data: blob:",
    "connect-src 'self' https://api.whatsapp.com https://*.onrender.com", // WhatsApp API + Render
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "worker-src 'self' blob:"
  ].join('; ');
  res.set('Content-Security-Policy', csp);
  
  // HTTPS enforcement (only in production with HTTPS)
  if (process.env.NODE_ENV === 'production') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  
  next();
}

/**
 * Input Validation Utilities
 */
const validators = {
  // Validate price (positive number, max 2 decimals)
  price: (value) => {
    const num = Number(value);
    return !isNaN(num) && num >= 0 && num < 10000000 && /^\d+(\.\d{1,2})?$/.test(String(value));
  },
  
  // Validate stock (non-negative integer)
  stock: (value) => {
    const num = Number(value);
    return Number.isInteger(num) && num >= 0 && num < 1000000;
  },
  
  // Validate quantity (positive integer)
  quantity: (value) => {
    const num = Number(value);
    return Number.isInteger(num) && num > 0 && num <= 10000;
  },
  
  // Validate SKU (alphanumeric, dashes, underscores, max 50 chars)
  sku: (value) => {
    return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,50}$/.test(value);
  },
  
  // Validate name (reasonable length, no special chars)
  name: (value, maxLength = 200) => {
    return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= maxLength;
  },
  
  // Validate mobile (Indian format)
  mobile: (value) => {
    return typeof value === 'string' && /^[6-9]\d{9}$/.test(value);
  },
  
  // Validate email
  email: (value) => {
    return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
  },
  
  // Validate ID (positive integer)
  id: (value) => {
    const num = Number(value);
    return Number.isInteger(num) && num > 0 && num < 2147483647;
  },
  
  // Validate slug (lowercase, alphanumeric, dashes)
  slug: (value) => {
    return typeof value === 'string' && /^[a-z0-9-]{1,100}$/.test(value);
  },
  
  // Validate status enum
  status: (value, allowedValues) => {
    return allowedValues.includes(value);
  },
  
  // Validate pincode (6 digits)
  pincode: (value) => {
    return typeof value === 'string' && /^\d{6}$/.test(value);
  }
};

/**
 * Error Sanitization
 * Removes sensitive information from error responses in production
 */
function sanitizeError(error, isProduction) {
  if (!isProduction) {
    // Development: return full error for debugging
    return {
      error: error.message || 'An error occurred',
      stack: error.stack,
      code: error.code,
      details: error
    };
  }
  
  // Production: sanitize error response
  const sanitized = {
    error: 'An error occurred'
  };
  
  // Map specific error types to user-friendly messages
  if (error.code === '23505') {
    // PostgreSQL unique constraint violation
    sanitized.error = 'This record already exists';
  } else if (error.code === '23503') {
    // PostgreSQL foreign key violation
    sanitized.error = 'Cannot delete: record is referenced by other data';
  } else if (error.code === '23502') {
    // PostgreSQL not null violation
    sanitized.error = 'Required field is missing';
  } else if (error.message && error.message.includes('UNIQUE constraint failed')) {
    // SQLite unique constraint
    sanitized.error = 'This record already exists';
  } else if (error.message && error.message.includes('FOREIGN KEY constraint failed')) {
    // SQLite foreign key violation
    sanitized.error = 'Cannot delete: record is referenced by other data';
  } else if (error.name === 'ValidationError') {
    // Custom validation error
    sanitized.error = error.message;
  } else if (error.name === 'UnauthorizedError' || error.name === 'JsonWebTokenError') {
    // JWT errors
    sanitized.error = 'Authentication required';
  } else if (error.name === 'TokenExpiredError') {
    // JWT expiration
    sanitized.error = 'Session expired, please login again';
  }
  
  // Never expose:
  // - Stack traces
  // - Database errors
  // - File paths
  // - Internal error codes
  // - SQL queries
  
  return sanitized;
}

/**
 * Global Error Handler Middleware
 */
function errorHandler(err, req, res, next) {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  
  // Log error for monitoring (but not sensitive data)
  console.error('[Error]', {
    method: req.method,
    path: req.path,
    error: err.message,
    code: err.code,
    stack: !isProduction ? err.stack : undefined
  });
  
  // Determine status code
  let statusCode = err.statusCode || err.status || 500;
  if (statusCode < 400 || statusCode > 599) {
    statusCode = 500;
  }
  
  // Send sanitized error response
  const sanitized = sanitizeError(err, isProduction);
  res.status(statusCode).json(sanitized);
}

/**
 * Authentication Middleware with improved error handling
 */
function createAuthMiddleware(jwtSecret) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
      const decoded = jwt.verify(token, jwtSecret);
      
      // Additional validation
      if (!decoded.id || !decoded.role) {
        return res.status(401).json({ error: 'Invalid token format' });
      }
      
      req.user = decoded;
      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Session expired, please login again' });
      } else if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: 'Invalid authentication token' });
      } else {
        return res.status(401).json({ error: 'Authentication failed' });
      }
    }
  };
}

/**
 * Admin Authorization Middleware
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  next();
}

/**
 * Customer Authorization Middleware
 */
function requireCustomer(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  if (req.user.role !== 'CUSTOMER') {
    return res.status(403).json({ error: 'Customer access required' });
  }
  
  next();
}

/**
 * Validate Request Body
 */
function validateBody(schema) {
  return (req, res, next) => {
    const errors = [];
    
    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];
      
      // Required check
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
        continue;
      }
      
      // Skip validation if field is optional and not provided
      if (!rules.required && (value === undefined || value === null || value === '')) {
        continue;
      }
      
      // Type validation
      if (rules.validator && !rules.validator(value)) {
        errors.push(rules.message || `${field} is invalid`);
      }
    }
    
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(', ') });
    }
    
    next();
  };
}

/**
 * CORS Configuration Helper
 */
function getCorsOptions(isProduction) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [];
  
  if (isProduction && allowedOrigins.length === 0) {
    console.warn('[Security Warning] ALLOWED_ORIGINS not set in production. CORS will allow all origins.');
  }
  
  return {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) {
        return callback(null, true);
      }
      
      // Development: allow all
      if (!isProduction) {
        return callback(null, true);
      }
      
      // Production: check whitelist
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('CORS policy: Origin not allowed'), false);
      }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  };
}

module.exports = {
  rateLimit,
  authRateLimit,
  registerRateLimit,
  apiRateLimit,
  securityHeaders,
  validators,
  sanitizeError,
  errorHandler,
  createAuthMiddleware,
  requireAdmin,
  requireCustomer,
  validateBody,
  getCorsOptions
};
