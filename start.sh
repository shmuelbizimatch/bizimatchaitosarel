#!/bin/bash

echo "🤖 Starting Claude Agent System..."
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing backend dependencies..."
    npm install
fi

if [ ! -d "frontend/node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    cd frontend && npm install && cd ..
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found. Please copy .env.example to .env and configure your API keys."
    exit 1
fi

# Check if Anthropic API key is set
if grep -q "placeholder-key-get-from-anthropic-console" .env; then
    echo "⚠️  WARNING: Please update your ANTHROPIC_API_KEY in .env file"
    echo "   Get your API key from: https://console.anthropic.com/"
    echo ""
fi

# Build the project
echo "🔨 Building the project..."
npm run build

echo ""
echo "🚀 Starting servers..."
echo "   API Server: http://localhost:3001"
echo "   Frontend: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop both servers"
echo ""

# Function to handle cleanup
cleanup() {
    echo ""
    echo "🛑 Shutting down servers..."
    kill $API_PID $FRONTEND_PID 2>/dev/null
    exit 0
}

# Set up trap to catch Ctrl+C
trap cleanup SIGINT

# Start API server in background
npm run api &
API_PID=$!

# Wait a moment for API to start
sleep 2

# Start frontend in background
cd frontend && npm start &
FRONTEND_PID=$!
cd ..

# Wait for both processes
wait $API_PID $FRONTEND_PID