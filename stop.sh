#!/bin/bash

APP_NAME="anivia"

if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 not installed"
    exit 1
fi

if ! pm2 describe "$APP_NAME" > /dev/null 2>&1; then
    echo "⚠️  $APP_NAME is not running"
    exit 1
fi

pm2 stop "$APP_NAME"
pm2 save

echo "✅ $APP_NAME stopped"
pm2 list

