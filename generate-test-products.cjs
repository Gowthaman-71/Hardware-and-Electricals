/**
 * Test Data Generator for Bulk Import
 * Generates 1,000+ realistic products for performance testing
 * Usage: node generate-test-products.cjs
 */

const fs = require('node:fs');
const path = require('node:path');

// Product data templates
const categories = [
  'Lighting',
  'Wiring & Cables',
  'Switches & Sockets',
  'Fans',
  'Tools',
  'Safety Equipment',
  'Motors',
  'Pumps',
  'Batteries',
  'Inverters'
];

const brands = [
  'Havells',
  'Anchor',
  'Philips',
  'Bajaj',
  'Crompton',
  'Syska',
  'Orient',
  'Luminous',
  'Exide',
  'Finolex'
];

const productTypes = {
  'Lighting': ['LED Bulb', 'Tube Light', 'Spotlight', 'Panel Light', 'Street Light'],
  'Wiring & Cables': ['PVC Wire', 'Copper Wire', 'Coaxial Cable', 'Ethernet Cable', 'Power Cord'],
  'Switches & Sockets': ['Modular Switch', 'Socket', 'Dimmer', 'MCB', 'Distribution Board'],
  'Fans': ['Ceiling Fan', 'Table Fan', 'Exhaust Fan', 'Pedestal Fan', 'Wall Fan'],
  'Tools': ['Drill Machine', 'Screwdriver Set', 'Pliers', 'Wire Stripper', 'Multimeter'],
  'Safety Equipment': ['Helmet', 'Gloves', 'Safety Shoes', 'Goggles', 'Safety Belt'],
  'Motors': ['Induction Motor', 'Servo Motor', 'Gear Motor', 'Pump Motor', 'Fan Motor'],
  'Pumps': ['Submersible Pump', 'Centrifugal Pump', 'Jet Pump', 'Booster Pump', 'Sump Pump'],
  'Batteries': ['Lead Acid Battery', 'Lithium Battery', 'Tubular Battery', 'SMF Battery', 'Gel Battery'],
  'Inverters': ['Sine Wave Inverter', 'Square Wave Inverter', 'Hybrid Inverter', 'Solar Inverter', 'UPS']
};

const descriptions = [
  'High-quality product for residential and commercial use',
  'Durable and reliable performance',
  'Energy-efficient design for cost savings',
  'Easy installation and maintenance',
  'Weather-resistant construction',
  'Long-lasting with warranty',
  'Industry-standard specifications',
  'Premium quality materials',
  'Optimized for performance',
  'Safe and certified product'
];

const details = [
  'Voltage: 220V | Frequency: 50Hz',
  'Power Rating: High Efficiency',
  'Material: Premium Grade',
  'Certification: ISI Approved',
  'Warranty: 2 Years',
  'IP Rating: IP20',
  'Color: White',
  'Dimensions: Standard',
  'Weight: Lightweight',
  'Mounting: Easy Install'
];

// Generate random SKU
function generateSKU(category, index) {
  const categoryCode = category.substring(0, 3).toUpperCase();
  const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${categoryCode}-${String(index).padStart(4, '0')}-${randomPart}`;
}

// Generate random price
function generatePrice() {
  return Math.floor(Math.random() * 10000) + 100;
}

// Generate random stock
function generateStock() {
  return Math.floor(Math.random() * 500) + 10;
}

// Generate random discount
function generateDiscount() {
  return Math.random() > 0.7 ? Math.floor(Math.random() * 30) : 0;
}

// Generate test products
function generateProducts(count = 1000) {
  const products = [];
  
  for (let i = 1; i <= count; i++) {
    const category = categories[Math.floor(Math.random() * categories.length)];
    const brand = brands[Math.floor(Math.random() * brands.length)];
    const typeOptions = productTypes[category] || ['Standard'];
    const productType = typeOptions[Math.floor(Math.random() * typeOptions.length)];
    const price = generatePrice();
    const discount = generateDiscount();
    const mrp = Math.floor(price * (1 + discount / 100));
    
    products.push({
      row: i,
      product: {
        sku: generateSKU(category, i),
        name: `${brand} ${productType} ${i % 10 === 0 ? 'Pro' : 'Standard'}`,
        category: category,
        brand: brand,
        productType: productType,
        price: price,
        mrp: mrp,
        discount: discount,
        stock: generateStock(),
        unit: 'Nos',
        status: Math.random() > 0.1 ? 'ACTIVE' : 'INACTIVE',
        description: descriptions[Math.floor(Math.random() * descriptions.length)],
        details: details[Math.floor(Math.random() * details.length)],
        imageUrl: null
      }
    });
  }
  
  return products;
}

// Save to file
function saveToFile(products, filename = 'test-products.json') {
  const filePath = path.join(__dirname, filename);
  fs.writeFileSync(filePath, JSON.stringify(products, null, 2), 'utf-8');
  console.log(`Generated ${products.length} test products saved to ${filePath}`);
}

// Main execution
const count = process.argv[2] ? parseInt(process.argv[2]) : 1000;
const products = generateProducts(count);
saveToFile(products, 'test-products.json');

console.log('\n=== Test Data Generation Complete ===');
console.log(`Total Products: ${products.length}`);
console.log(`Categories: ${categories.length}`);
console.log(`Brands: ${brands.length}`);
console.log(`Active Products: ${products.filter(p => p.product.status === 'ACTIVE').length}`);
console.log(`Inactive Products: ${products.filter(p => p.product.status === 'INACTIVE').length}`);
console.log(`Products with Discount: ${products.filter(p => p.product.discount > 0).length}`);
console.log('\nFile: test-products.json');
console.log('\nTo import these products, use the bulk import endpoint:');
console.log('POST /api/products/bulk-import-job');
console.log('Body: { "products": <content of test-products.json>, "duplicateMode": "skip" }');
