#!/usr/bin/env node

/**
 * Database Reset Script
 * Clears all products and categories, keeps admin user
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, '../server/data/catalog.sqlite');

if (!fs.existsSync(dbPath)) {
  console.error('Error: Database not found at', dbPath);
  process.exit(1);
}

console.log('Opening database:', dbPath);
const db = new DatabaseSync(dbPath);

console.log('\n=== CURRENT DATA ===');
const beforeProducts = db.prepare('SELECT COUNT(*) as count FROM products').get();
const beforeCategories = db.prepare('SELECT COUNT(*) as count FROM categories').get();
const beforeBrands = db.prepare('SELECT COUNT(*) as count FROM brands').get();
const beforeOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get();

console.log('Products:', beforeProducts.count);
console.log('Categories:', beforeCategories.count);
console.log('Brands:', beforeBrands.count);
console.log('Orders:', beforeOrders.count);

console.log('\n=== CLEARING DATA ===');

try {
  db.exec('BEGIN');
  
  // Delete in correct order to respect foreign keys
  console.log('Deleting order items...');
  db.exec('DELETE FROM order_items');
  
  console.log('Deleting order status history...');
  db.exec('DELETE FROM order_status_history');
  
  console.log('Deleting order notifications...');
  db.exec('DELETE FROM order_notifications');
  
  console.log('Deleting orders...');
  db.exec('DELETE FROM orders');
  
  console.log('Deleting products...');
  db.exec('DELETE FROM products');
  
  console.log('Deleting attributes...');
  db.exec('DELETE FROM attributes');
  
  console.log('Deleting product types...');
  db.exec('DELETE FROM product_types');
  
  console.log('Deleting brands...');
  db.exec('DELETE FROM brands');
  
  console.log('Deleting categories...');
  db.exec('DELETE FROM categories');
  
  console.log('Deleting import jobs...');
  db.exec('DELETE FROM import_jobs');
  
  // Reset auto-increment sequences
  console.log('Resetting sequences...');
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('products', 'categories', 'brands', 'orders', 'order_items', 'product_types', 'attributes', 'import_jobs')");
  
  db.exec('COMMIT');
  
  console.log('\n=== AFTER CLEANUP ===');
  const afterProducts = db.prepare('SELECT COUNT(*) as count FROM products').get();
  const afterCategories = db.prepare('SELECT COUNT(*) as count FROM categories').get();
  const afterBrands = db.prepare('SELECT COUNT(*) as count FROM brands').get();
  const afterOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get();
  
  console.log('Products:', afterProducts.count);
  console.log('Categories:', afterCategories.count);
  console.log('Brands:', afterBrands.count);
  console.log('Orders:', afterOrders.count);
  
  console.log('\n✅ Database cleared successfully!');
  console.log('Admin user preserved. Owner can now add categories and products.');
  
} catch (error) {
  db.exec('ROLLBACK');
  console.error('\n❌ Error:', error.message);
  process.exit(1);
}

db.close();
