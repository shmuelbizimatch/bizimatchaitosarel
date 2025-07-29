#!/usr/bin/env node

/**
 * Prerequisites Checker for Claude Agent System
 * Validates environment setup before starting the application
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

console.log('🔍 Checking Claude Agent System prerequisites...\n');

let hasErrors = false;

// Check 1: Node.js version
console.log('📦 Checking Node.js version...');
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
if (majorVersion < 18) {
  console.log('❌ Node.js 18+ is required. Current version:', nodeVersion);
  hasErrors = true;
} else {
  console.log('✅ Node.js version:', nodeVersion);
}

// Check 2: Required environment variables
console.log('\n🔑 Checking environment variables...');
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY'
];

const missingEnvVars = [];
for (const envVar of requiredEnvVars) {
  const value = process.env[envVar];
  if (!value) {
    missingEnvVars.push(envVar);
  } else if (value.includes('your_') || value.includes('your-')) {
    console.log(`⚠️  ${envVar} appears to be a placeholder value`);
    missingEnvVars.push(envVar);
  } else {
    console.log(`✅ ${envVar} is set`);
  }
}

if (missingEnvVars.length > 0) {
  console.log(`❌ Missing or invalid environment variables: ${missingEnvVars.join(', ')}`);
  hasErrors = true;
}

// Check 3: .env file exists
console.log('\n📄 Checking configuration files...');
if (!fs.existsSync('.env')) {
  console.log('❌ .env file not found. Please copy .env.example to .env and configure it.');
  hasErrors = true;
} else {
  console.log('✅ .env file exists');
}

// Check 4: Dependencies installed
console.log('\n📚 Checking dependencies...');
if (!fs.existsSync('node_modules')) {
  console.log('❌ node_modules not found. Please run: npm install');
  hasErrors = true;
} else {
  console.log('✅ Main dependencies installed');
}

if (!fs.existsSync('frontend/node_modules')) {
  console.log('❌ Frontend dependencies not found. Please run: cd frontend && npm install');
  hasErrors = true;
} else {
  console.log('✅ Frontend dependencies installed');
}

// Check 5: Built files
console.log('\n🔨 Checking build status...');
if (!fs.existsSync('dist')) {
  console.log('❌ dist folder not found. Please run: npm run build');
  hasErrors = true;
} else {
  console.log('✅ Build files exist');
}

// Check 6: Database connectivity (if env vars are set)
async function checkDatabase() {
  console.log('\n🗄️  Checking database connectivity...');
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && 
      !process.env.SUPABASE_URL.includes('your-') && 
      !process.env.SUPABASE_SERVICE_ROLE_KEY.includes('your_')) {
    
    // Test Supabase connection
    const { createClient } = require('@supabase/supabase-js');
    
    try {
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      
      // Simple connectivity test with timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 5000)
      );
      
      const connectPromise = supabase.from('information_schema.tables').select('count', { count: 'exact' }).limit(1);
      
      const { data, error } = await Promise.race([connectPromise, timeoutPromise]);
      
      if (error) {
        console.log('❌ Database connection failed:', error.message);
        hasErrors = true;
      } else {
        console.log('✅ Database connection successful');
      }
    } catch (error) {
      console.log('❌ Database connection failed:', error.message);
      hasErrors = true;
    }
  } else {
    console.log('⚠️  Skipping database check - credentials not configured');
  }
}

// Run database check and then summary
checkDatabase().then(() => {
  // Summary
  console.log('\n' + '='.repeat(50));
  if (hasErrors) {
    console.log('❌ Prerequisites check FAILED');
    console.log('\n🔧 To fix these issues:');
    console.log('1. Ensure Node.js 18+ is installed');
    console.log('2. Copy .env.example to .env: cp .env.example .env');
    console.log('3. Edit .env with your actual API keys and Supabase credentials');
    console.log('4. Install dependencies: npm install && cd frontend && npm install && cd ..');
    console.log('5. Build the project: npm run build');
    console.log('6. Run this check again: npm run check');
    console.log('\n📚 See README.md for detailed setup instructions');
    process.exit(1);
  } else {
    console.log('✅ All prerequisites met! You can now start the system.');
    console.log('\n🚀 To start the system:');
    console.log('   Terminal 1: npm run api');
    console.log('   Terminal 2: npm run frontend');
  }
}).catch((error) => {
  console.error('❌ Error during database check:', error.message);
  process.exit(1);
});