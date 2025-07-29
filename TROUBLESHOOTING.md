# 🔧 Troubleshooting Guide

## Quick Start (if having issues)

### Option 1: Use the startup script
```bash
./start.sh
```

### Option 2: Manual startup
```bash
# Terminal 1: Start API
npm run api

# Terminal 2: Start Frontend
cd frontend && npm start
```

## Common Issues & Solutions

### 1. Port Already in Use
**Error**: `EADDRINUSE: address already in use :::3000`

**Solution**:
```bash
# Kill processes on ports
pkill -f "node.*3000"
pkill -f "node.*3001"

# Or change port in .env
# Change PORT=3000 to PORT=3001
```

### 2. Missing Dependencies
**Error**: `Cannot find module '...'`

**Solution**:
```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd frontend && npm install
```

### 3. TypeScript Compilation Errors
**Error**: `TS2307: Cannot find module` or compilation failures

**Solution**:
```bash
# Clean and rebuild
rm -rf dist node_modules frontend/node_modules
npm install
cd frontend && npm install && cd ..
npm run build
```

### 4. Anthropic API Key Not Set
**Error**: API calls failing or placeholder key warnings

**Solution**:
1. Get API key from: https://console.anthropic.com/
2. Edit `.env` file:
   ```bash
   ANTHROPIC_API_KEY=sk-ant-api03-your-actual-key-here
   ```

### 5. Supabase Connection Issues
**Error**: `Failed to log to Supabase` or database errors

**This is expected** - the system works without Supabase, you'll just see warnings.

**For full functionality**:
1. Create Supabase project: https://supabase.com/
2. Update `.env` with your Supabase URL and service role key
3. Run: `npm run setup-db`

### 6. Frontend Build Issues
**Error**: React compilation errors

**Solution**:
```bash
cd frontend
rm -rf node_modules build
npm install
npm run build
```

### 7. Permission Errors
**Error**: `Permission denied` when running scripts

**Solution**:
```bash
chmod +x start.sh
# Or run with: bash start.sh
```

## Manual Testing

### Test API Server
```bash
# Start API
npm run api

# In another terminal, test:
curl http://localhost:3001/api/health
```

### Test Frontend
```bash
cd frontend
npm start
# Should open http://localhost:3000
```

## Environment Check

Run this to check your environment:
```bash
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo "Current directory: $(pwd)"
echo "Dependencies installed: $([ -d node_modules ] && echo "✅" || echo "❌")"
echo "Frontend deps installed: $([ -d frontend/node_modules ] && echo "✅" || echo "❌")"
echo ".env file exists: $([ -f .env ] && echo "✅" || echo "❌")"
```

## Still Having Issues?

1. **Check the logs**: Look for specific error messages
2. **Verify Node.js version**: Requires Node.js 18+
3. **Check network**: Some corporate networks block npm installs
4. **Try clean install**: Delete `node_modules` and reinstall
5. **Check disk space**: Make sure you have enough space for dependencies

## System Requirements

- **Node.js**: 18.0.0 or higher
- **NPM**: 8.0.0 or higher  
- **Memory**: At least 2GB RAM for comfortable operation
- **Disk**: ~500MB for dependencies
- **Network**: Internet connection for API calls and package installs

## Minimal Working Configuration

If you just want to see it work, you need:
1. ✅ `.env` file with any Anthropic API key format
2. ✅ Dependencies installed (`npm install`)
3. ✅ Project built (`npm run build`)
4. ✅ Ports 3000/3001 available

The system will start and show the interface even without a valid API key or Supabase connection.