#!/usr/bin/env node

// Test script to verify server setup
const fs = require('fs');
const path = require('path');

console.log('🧪 Testing Multi-PDF Invoice Data Extraction App Setup...\n');

// Test 1: Check if .env file exists
console.log('1. Checking environment configuration...');
if (fs.existsSync('.env')) {
    console.log('   ✅ .env file found');
    
    const envContent = fs.readFileSync('.env', 'utf8');
    const hasOpenAIKey = envContent.includes('OPENAI_API_KEY=');
    const hasMongoURI = envContent.includes('MONGODB_URI=');
    
    if (hasOpenAIKey) {
        console.log('   ✅ OPENAI_API_KEY configured');
    } else {
        console.log('   ⚠️  OPENAI_API_KEY not found in .env');
    }
    
    if (hasMongoURI) {
        console.log('   ✅ MONGODB_URI configured');
    } else {
        console.log('   ⚠️  MONGODB_URI not found in .env');
    }
} else {
    console.log('   ❌ .env file not found');
    console.log('   💡 Run: cp .env.example .env and update with your values');
}

// Test 2: Check if node_modules exists
console.log('\n2. Checking dependencies...');
if (fs.existsSync('node_modules')) {
    console.log('   ✅ node_modules found');
} else {
    console.log('   ❌ node_modules not found');
    console.log('   💡 Run: npm install');
}

// Test 3: Check if uploads directory exists
console.log('\n3. Checking uploads directory...');
if (fs.existsSync('uploads')) {
    console.log('   ✅ uploads directory found');
} else {
    console.log('   ⚠️  uploads directory not found (will be created automatically)');
}

// Test 4: Check required files
console.log('\n4. Checking required files...');
const requiredFiles = [
    'server.js',
    'config/db.js',
    'models/Invoice.js',
    'controllers/pdfController.js',
    'controllers/invoiceController.js',
    'routes/pdfRoutes.js',
    'routes/invoiceRoutes.js',
    'services/pdfProcessor.js'
];

let allFilesExist = true;
requiredFiles.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`   ✅ ${file}`);
    } else {
        console.log(`   ❌ ${file} - Missing`);
        allFilesExist = false;
    }
});

// Test 5: Check package.json
console.log('\n5. Checking package.json...');
if (fs.existsSync('package.json')) {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const requiredDeps = ['express', 'mongoose', 'cors', 'helmet', 'express-rate-limit', 'dotenv', 'multer', 'pdf-parse', '@langchain/openai'];
    
    let allDepsFound = true;
    requiredDeps.forEach(dep => {
        if (packageJson.dependencies && packageJson.dependencies[dep]) {
            console.log(`   ✅ ${dep}`);
        } else if (packageJson.devDependencies && packageJson.devDependencies[dep]) {
            console.log(`   ✅ ${dep} (dev dependency)`);
        } else {
            console.log(`   ❌ ${dep} - Missing`);
            allDepsFound = false;
        }
    });
    
    if (allDepsFound) {
        console.log('   ✅ All required dependencies found');
    }
} else {
    console.log('   ❌ package.json not found');
}

// Summary
console.log('\n📋 Setup Summary:');
if (allFilesExist) {
    console.log('   ✅ All required files are present');
} else {
    console.log('   ❌ Some required files are missing');
}

console.log('\n🚀 Next steps:');
console.log('   1. Update .env file with your OpenAI API key and MongoDB URI');
console.log('   2. Run: npm install (if not done already)');
console.log('   3. Start MongoDB service');
console.log('   4. Run: npm run dev');
console.log('   5. Test the API at: http://localhost:3000/health');

console.log('\n✨ Setup test completed!');
