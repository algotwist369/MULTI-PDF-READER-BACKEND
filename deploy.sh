#!/bin/bash

echo "Deploying PDF AI Reader Backend..."

# Stop the current process
echo "Stopping current process..."
pm2 stop pdf-ai-reader

# Pull latest changes (if using git)
# git pull origin main

# Install dependencies
echo "Installing dependencies..."
npm install

# Fix file paths in database (if needed)
echo "Checking and fixing file paths..."
node fix-file-paths.js

# Start the server
echo "Starting server..."
pm2 start server.js --name pdf-ai-reader

# Save PM2 configuration
pm2 save

echo "Deployment completed!"
echo "Server should now be running with the trust proxy fix and file path resolution."
