#!/bin/bash

# Multi-PDF Invoice Data Extraction App - Startup Script

echo "🚀 Starting Multi-PDF Invoice Data Extraction App..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating template..."
    cat > .env << EOF
# Server Configuration
PORT=3000

# Database Configuration
MONGODB_URI=mongodb://localhost:27017/pdf-invoice-reader

# OpenAI Configuration (for PDF processing)
OPENAI_API_KEY=your_openai_api_key_here

# Optional: Production Database URL
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/pdf-invoice-reader?retryWrites=true&w=majority
EOF
    echo "📝 .env file created. Please update it with your actual values."
    echo "   - Set your OpenAI API key"
    echo "   - Update MongoDB URI if needed"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Check if uploads directory exists
if [ ! -d "uploads" ]; then
    echo "📁 Creating uploads directory..."
    mkdir -p uploads
fi

# Start the server
echo "🎯 Starting server..."
npm run dev
