#!/bin/bash

APP_NAME="anivia"

if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 not installed. Run: npm install -g pm2"
    exit 1
fi

if ! command -v bun &> /dev/null; then
    echo "❌ Bun not installed. Visit: https://bun.sh"
    exit 1
fi

if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found"
    exit 1
fi

mkdir -p logs

if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    bun install
fi

if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
    echo "🔄 Restarting $APP_NAME..."
    pm2 restart "$APP_NAME"
else
    echo "🚀 Starting $APP_NAME..."
    pm2 start ecosystem.config.js
fi

pm2 save

PORT=$(grep "^API_PORT=" .env | cut -d '=' -f2)
PORT=${PORT:-18888}

echo ""
echo "✅ $APP_NAME started"
echo "   http://localhost:$PORT"
echo ""
pm2 list

