#!/bin/bash

APP_NAME="anivia"

if [ "$1" = "--update" ]; then
    echo "📦 Updating dependencies..."
    bun install
fi

if ! pm2 describe "$APP_NAME" > /dev/null 2>&1; then
    echo "⚠️  $APP_NAME not running, use ./start.sh"
    exit 1
fi

pm2 restart "$APP_NAME"
pm2 save

echo "✅ $APP_NAME restarted"
pm2 logs "$APP_NAME" --lines 20

