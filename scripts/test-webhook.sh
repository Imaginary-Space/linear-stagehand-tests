#!/bin/bash

# Test webhook script - sends a properly signed request to the local server

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Load environment variables from .env file
if [ -f "$PROJECT_ROOT/.env" ]; then
  export $(grep -v '^#' "$PROJECT_ROOT/.env" | xargs)
fi

# Use env variables or defaults
SECRET="${LINEAR_WEBHOOK_SECRET:-lin_wh_h9CCEmjRNlY2giXw7Vwz9ksnTD8FzLPngguXNnkKlGbR}"
ISSUE_ID="${LINEAR_TEST_ID:-FEL-395}"
URL="http://localhost:3000/webhooks/linear"

# Create payload as a file to avoid shell escaping issues
cat > /tmp/webhook-payload.json << EOF
{"action":"update","type":"Issue","data":{"id":"test-${ISSUE_ID}","title":"Test Login Feature","identifier":"${ISSUE_ID}","description":"## Acceptance Criteria\n- [ ] User can see the login page\n- [ ] User can enter credentials","state":{"id":"state-1","name":"Ready for Testing"}}}
EOF

# Read payload from file
PAYLOAD=$(cat /tmp/webhook-payload.json)

# Generate signature
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

echo "Payload: $PAYLOAD"
echo "Signature: $SIGNATURE"
echo ""
echo "Sending request..."
echo ""

# Send request
curl -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "Linear-Signature: $SIGNATURE" \
  -d "$PAYLOAD"

echo ""
