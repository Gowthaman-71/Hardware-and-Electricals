#!/usr/bin/env node

/**
 * Production Database Reset Script
 * Clears all products, categories, orders from PostgreSQL
 * Preserves admin user
 */

const { Pool } = require('pg');

// Your Neon PostgreSQL connection string
const DATABASE_URL = 'postgresql://neondb_owner:npg_9GKyDRsFN5mL@ep-aged-darkness-b3bwqh1y-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

async function resetDatabase() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('\n=== CONNECTING TO PRODUCTION DATABASE ===');
    const client = await pool.connect();
    console.log('✅ Connected to Neon PostgreSQL\n');

    console.log('=== CURRENT DATA ===');
    const products = await client.query('SELECT COUNT(*) as count FROM products');
    const categories = await client.query('SELECT COUNT(*) as count FROM categories');
    const orders = await client.query('SELECT COUNT(*) as count FROM orders');
    console.log('Products:', products.rows[0].count);
    console.log('Categories:', categories.rows[0].count);
    console.log('Orders:', orders.rows[0].count);

    console.log('\n=== CLEARING DATA ===');
    
    await client.query('BEGIN');
    
    console.log('Deleting order items...');
    await client.query('DELETE FROM order_items');
    
    console.log('Deleting order status history...');
    await client.query('DELETE FROM order_status_history');
    
    console.log('Deleting order notifications...');
    await client.query('DELETE FROM order_notifications');
    
    console.log('Deleting orders...');
    await client.query('DELETE FROM orders');
    
    console.log('Deleting products...');
    await client.query('DELETE FROM products');
    
    console.log('Deleting attributes...');
    await client.query('DELETE FROM attributes');
    
    console.log('Deleting product types...');
    await client.query('DELETE FROM product_types');
    
    console.log('Deleting brands...');
    await client.query('DELETE FROM brands');
    
    console.log('Deleting categories...');
    await client.query('DELETE FROM categories');
    
    console.log('Deleting import jobs...');
    await client.query('DELETE FROM import_jobs');
    
    console.log('Resetting sequences...');
    await client.query("SELECT setval('products_id_seq', 1, false)");
    await client.query("SELECT setval('categories_id_seq', 1, false)");
    await client.query("SELECT setval('brands_id_seq', 1, false)");
    await client.query("SELECT setval('orders_id_seq', 1, false)");
    
    await client.query('COMMIT');
    
    console.log('\n=== AFTER CLEANUP ===');
    const afterProducts = await client.query('SELECT COUNT(*) as count FROM products');
    const afterCategories = await client.query('SELECT COUNT(*) as count FROM categories');
    const afterOrders = await client.query('SELECT COUNT(*) as count FROM orders');
    console.log('Products:', afterProducts.rows[0].count);
    console.log('Categories:', afterCategories.rows[0].count);
    console.log('Orders:', afterOrders.rows[0].count);
    
    console.log('\n✅ Database cleared successfully!');
    console.log('Admin user preserved. Ready for fresh data.');
    
    client.release();
    await pool.end();
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

resetDatabase();
