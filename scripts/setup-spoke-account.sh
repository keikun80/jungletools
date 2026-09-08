#!/usr/bin/env bash
# Usage: ./scripts/setup-spoke-account.sh <PROFILE_NAME>

PROFILE=$1
ENV_FILE="env.json"

if [ -z "$PROFILE" ]; then
    echo "Usage: ./scripts/setup-spoke-account.sh <PROFILE_NAME>"
    exit 1
fi

if [ -f "$ENV_FILE" ]; then
    HUB_ACCOUNT_ID=$(grep -o '"HUB_ACCOUNT_ID": "[^"]*' "$ENV_FILE" | grep -o '[^"]*$')
    REGION=$(grep -o '"REGION": "[^"]*' "$ENV_FILE" | grep -o '[^"]*$')
else
    echo "Error: $ENV_FILE not found."
    exit 1
fi

echo "=========================================================="
echo "Deploying Cross-Account IAM Role to Profile: $PROFILE"
echo "Hub Account ID: $HUB_ACCOUNT_ID"
echo "Region: $REGION"
echo "=========================================================="

aws cloudformation deploy \
    --template-file spoke-account-template.yaml \
    --stack-name jungle-tools-spoke-role \
    --parameter-overrides HubAccountId="$HUB_ACCOUNT_ID" \
    --capabilities CAPABILITY_NAMED_IAM \
    --profile "$PROFILE" \
    --region "$REGION"

if [ $? -eq 0 ]; then
    echo "Successfully created/updated JungleToolsCrossAccountRole in profile '$PROFILE'!"
else
    echo "Failed to deploy IAM Role to profile '$PROFILE'."
fi
