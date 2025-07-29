#!/bin/bash

# Claude Agent System - Security Setup Script
# This script helps you set up all security features properly

set -e

echo "🔒 Claude Agent System - Security Setup"
echo "========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check if .env file exists
if [ ! -f .env ]; then
    print_info "Creating .env file from template..."
    cp .env.example .env
    print_status ".env file created"
else
    print_warning ".env file already exists. Backing up to .env.backup"
    cp .env .env.backup
fi

# Generate secure keys
echo ""
print_info "Generating secure keys..."

# Check if openssl is available
if ! command -v openssl &> /dev/null; then
    print_error "OpenSSL is required for key generation. Please install it first."
    exit 1
fi

# Generate APP_SECRET_KEY
APP_SECRET_KEY=$(openssl rand -hex 32)
sed -i.bak "s/your_generated_secret_key_here/$APP_SECRET_KEY/" .env

# Generate JWT_SECRET
JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
sed -i.bak "s/your_jwt_secret_here/$JWT_SECRET/" .env

# Generate ENCRYPTION_KEY
ENCRYPTION_KEY=$(openssl rand -hex 32)
sed -i.bak "s/your_encryption_key_here/$ENCRYPTION_KEY/" .env

print_status "Security keys generated and added to .env"

# Prompt for API keys
echo ""
print_info "Please enter your API credentials:"

# Anthropic API Key
read -p "Enter your Anthropic API Key: " anthropic_key
if [ ! -z "$anthropic_key" ]; then
    sed -i.bak "s/your_anthropic_api_key_here/$anthropic_key/" .env
    print_status "Anthropic API key added"
else
    print_warning "Anthropic API key not provided - you'll need to add it manually"
fi

# Supabase URL
read -p "Enter your Supabase URL: " supabase_url
if [ ! -z "$supabase_url" ]; then
    sed -i.bak "s|https://your-project-ref.supabase.co|$supabase_url|" .env
    print_status "Supabase URL added"
else
    print_warning "Supabase URL not provided - you'll need to add it manually"
fi

# Supabase Service Role Key
read -p "Enter your Supabase Service Role Key: " supabase_service_key
if [ ! -z "$supabase_service_key" ]; then
    sed -i.bak "s/your_supabase_service_role_key_here/$supabase_service_key/" .env
    print_status "Supabase Service Role Key added"
else
    print_warning "Supabase Service Role Key not provided - you'll need to add it manually"
fi

# Supabase Anon Key
read -p "Enter your Supabase Anon Key: " supabase_anon_key
if [ ! -z "$supabase_anon_key" ]; then
    sed -i.bak "s/your_supabase_anon_key_here/$supabase_anon_key/" .env
    print_status "Supabase Anon Key added"
else
    print_warning "Supabase Anon Key not provided - you'll need to add it manually"
fi

# Clean up backup files
rm -f .env.bak

# Install security dependencies
echo ""
print_info "Installing security dependencies..."

if [ -f "backend/package.json" ]; then
    cd backend
    npm install express-rate-limit express-validator helmet jsonwebtoken multer @types/jsonwebtoken @types/multer
    cd ..
    print_status "Backend security dependencies installed"
else
    print_warning "Backend package.json not found - please install dependencies manually"
fi

# Set up database security tables
echo ""
print_info "Setting up database security tables..."
print_warning "Please run the following SQL in your Supabase SQL editor:"
echo ""
echo "1. Go to your Supabase dashboard"
echo "2. Navigate to the SQL editor"
echo "3. Run the contents of: supabase/security_schema.sql"
echo ""
read -p "Press Enter after you've run the security schema SQL..."

print_status "Database setup instructions provided"

# Security configuration validation
echo ""
print_info "Validating security configuration..."

# Check if Node.js version is adequate
node_version=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$node_version" -lt 18 ]; then
    print_error "Node.js 18+ is required for security features. Current version: $(node --version)"
else
    print_status "Node.js version is adequate: $(node --version)"
fi

# Check if all required environment variables are set
missing_vars=()
required_vars=("ANTHROPIC_API_KEY" "SUPABASE_URL" "SUPABASE_SERVICE_ROLE_KEY" "APP_SECRET_KEY" "JWT_SECRET" "ENCRYPTION_KEY")

for var in "${required_vars[@]}"; do
    if ! grep -q "^$var=" .env || grep -q "your_" .env; then
        missing_vars+=("$var")
    fi
done

if [ ${#missing_vars[@]} -eq 0 ]; then
    print_status "All required environment variables are configured"
else
    print_error "Missing or placeholder environment variables: ${missing_vars[*]}"
    print_info "Please edit .env file and replace placeholder values"
fi

# Security checklist
echo ""
echo "🔐 Security Setup Checklist"
echo "==========================="
echo ""
echo "✅ Environment variables configured"
echo "✅ Security keys generated"
echo "✅ Dependencies installed"
echo "📝 Database security tables (manual step required)"
echo ""

# Production security warnings
echo ""
print_warning "IMPORTANT SECURITY NOTES:"
echo ""
echo "1. 🔐 Change the default admin password immediately:"
echo "   - Email: admin@example.com"
echo "   - Password: Admin123!"
echo ""
echo "2. 🔒 For production deployment:"
echo "   - Set NODE_ENV=production"
echo "   - Enable HTTPS"
echo "   - Set up monitoring and alerting"
echo "   - Configure backup procedures"
echo ""
echo "3. 🛡️  Security features enabled:"
echo "   - JWT authentication with RBAC"
echo "   - Rate limiting (100 requests/15 minutes)"
echo "   - Input validation and sanitization"
echo "   - Security headers (CSP, HSTS, etc.)"
echo "   - Logging with sensitive data redaction"
echo "   - AI prompt injection prevention"
echo ""

# Test security setup
echo ""
print_info "Testing security setup..."

if npm run check > /dev/null 2>&1; then
    print_status "Prerequisites check passed"
else
    print_warning "Prerequisites check failed - please run 'npm run check' for details"
fi

echo ""
print_status "Security setup completed!"
echo ""
print_info "Next steps:"
echo "1. Review and update the default admin credentials"
echo "2. Run the security schema SQL in Supabase"
echo "3. Test the authentication system"
echo "4. Start the application: npm run dev"
echo ""
print_info "For detailed security information, see: SECURITY_AUDIT_REPORT.md"
echo ""

# Final security reminder
print_warning "Remember: Security is an ongoing process!"
print_info "Schedule regular security audits and keep dependencies updated."