#!/usr/bin/env bash
# Usage: ./scripts/setup-all-spokes.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/env.json"

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE not found. Please run ./scripts/generate-env-json.sh first."
    exit 1
fi

HUB_ACCOUNT_ID=$(node -e "console.log(require('$ENV_FILE').HUB_ACCOUNT_ID || '')")
REGION=$(node -e "console.log(require('$ENV_FILE').REGION || 'ap-northeast-2')")
PROFILES=$(node -e "console.log((require('$ENV_FILE').SPOKE_PROFILES || []).map(p => p.profile).join(' '))")

if [ -z "$HUB_ACCOUNT_ID" ]; then
    echo "Error: HUB_ACCOUNT_ID not found in $ENV_FILE"
    exit 1
fi

echo "=========================================================="
echo "Batch Deploying JungleToolsCrossAccountRole to Spoke Accounts"
echo "Hub Account ID: $HUB_ACCOUNT_ID"
echo "Region: $REGION"
echo "Target Profiles: $PROFILES"
echo "=========================================================="

if [ -z "$PROFILES" ]; then
    echo "No Spoke profiles found in $ENV_FILE. Skipping Spoke deployment."
    exit 0
fi

for PROF in $PROFILES; do
    echo ""
    echo "----------------------------------------------------------"
    echo "Deploying to Spoke Profile: $PROF"
    echo "----------------------------------------------------------"
    aws cloudformation deploy \
        --template-file "$ROOT_DIR/spoke-account-template.yaml" \
        --stack-name jungle-tools-spoke-role \
        --parameter-overrides HubAccountId="$HUB_ACCOUNT_ID" \
        --capabilities CAPABILITY_NAMED_IAM \
        --profile "$PROF" \
        --region "$REGION"
    
    if [ $? -eq 0 ]; then
        echo "Successfully deployed JungleToolsCrossAccountRole to '$PROF'"
    else
        echo "Failed to deploy JungleToolsCrossAccountRole to '$PROF'"
    fi
done

echo ""
echo "=========================================================="
echo "All Spoke Account deployments completed."
echo "=========================================================="
