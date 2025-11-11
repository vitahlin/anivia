#!/bin/bash

APP_NAME="anivia"

if [ "$1" = "--logs" ] || [ "$1" = "-l" ]; then
    pm2 logs "$APP_NAME"
    exit 0
fi

if [ "$1" = "--monitor" ] || [ "$1" = "-m" ]; then
    pm2 monit
    exit 0
fi

if ! pm2 describe "$APP_NAME" > /dev/null 2>&1; then
    echo "⚠️  $APP_NAME not running"
    pm2 list
    exit 1
fi

pm2 show "$APP_NAME"
echo ""
pm2 list
echo ""
echo "Logs:"
echo "  pm2 logs $APP_NAME"
echo "  tail -f logs/app-\$(date +%Y-%m-%d-%H).log"

