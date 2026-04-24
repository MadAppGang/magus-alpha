#!/bin/bash
# Check if webhook server is running

PORT="${AUTOLINEAR_WEBHOOK_PORT:-3001}"

if curl -s "http://localhost:$PORT/health" > /dev/null 2>&1; then
  echo "AutoLinear: Webhook server running on port $PORT"
else
  echo "INFO: AutoLinear webhook server not running. Manual task execution only."
fi
