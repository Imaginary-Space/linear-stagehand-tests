#!/bin/bash

# Test E2E webhook script - simulates a Linear issue moving to QA status
# This triggers the full E2E test suite

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
URL="http://localhost:3000/webhooks/linear/e2e"

# Create payload simulating an issue moved to QA
cat > /tmp/e2e-webhook-payload.json << EOF
{
  "action": "update",
  "type": "Issue",
  "data": {
    "id": "e2e-test-${ISSUE_ID}",
    "title": "E2E Test Run",
    "identifier": "${ISSUE_ID}",
    "description": "Automated E2E test triggered via webhook simulation.",
    "url": "https://linear.app/your-team/issue/${ISSUE_ID}",
    "state": {
      "id": "state-qa",
      "name": "QA"
    },
    "labels": []
  },
  "url": "https://linear.app/your-team/issue/${ISSUE_ID}",
  "createdAt": "$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"
}
EOF

# Read payload from file
PAYLOAD=$(cat /tmp/e2e-webhook-payload.json)

# Generate signature
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

echo "========================================"
echo "  Simulating Linear Issue → QA Status"
echo "========================================"
echo ""
echo "Issue: ${ISSUE_ID} - E2E Test Run"
echo "State: QA"
echo ""
echo "Signature: $SIGNATURE"
echo ""
echo "Sending webhook to trigger E2E tests..."
echo ""

# Send request
curl -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "Linear-Signature: $SIGNATURE" \
  -d "$PAYLOAD" \
  -w "\n\nHTTP Status: %{http_code}\n"

echo ""
echo "========================================"
echo ""
echo "To check test status, run:"
echo "  curl http://localhost:3000/webhooks/e2e/status/e2e-test-${ISSUE_ID}"
echo ""
echo "To see all E2E tests:"
echo "  curl http://localhost:3000/webhooks/e2e/tests"
echo ""
