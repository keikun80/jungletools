#!/usr/bin/env bash
# Usage: ./scripts/generate-env-json.sh [HUB_PROFILE] [REGION]

HUB_PROFILE=${1:-"l-iam-s2"}
REGION=${2:-"ap-northeast-2"}
OUTPUT_FILE="env.json"

echo "=========================================================="
echo "Generating env.json from local AWS CLI configuration..."
echo "Hub Profile: $HUB_PROFILE"
echo "Region: $REGION"
echo "=========================================================="

HUB_ACCOUNT_ID=$(aws sts get-caller-identity --profile "$HUB_PROFILE" --query "Account" --output text 2>/dev/null)

if [ -z "$HUB_ACCOUNT_ID" ] || [ "$HUB_ACCOUNT_ID" == "None" ]; then
    echo "Error: Could not retrieve Account ID for Hub Profile '$HUB_PROFILE'."
    exit 1
fi

echo "Discovered Hub Account ID: $HUB_ACCOUNT_ID"

ALL_PROFILES=$(aws configure list-profiles)
SPOKE_ITEMS=()

for PROF in $ALL_PROFILES; do
    if [ "$PROF" == "default" ] || [ "$PROF" == "mfa" ]; then
        continue
    fi

    ACC_ID=$(aws sts get-caller-identity --profile "$PROF" --query "Account" --output text 2>/dev/null)
    if [ -n "$ACC_ID" ] && [ "$ACC_ID" != "None" ]; then
        if [ "$PROF" == "$HUB_PROFILE" ] || [ "$ACC_ID" == "$HUB_ACCOUNT_ID" ]; then
            continue
        fi
        SPOKE_ITEMS+=("    {\"profile\": \"$PROF\", \"accountId\": \"$ACC_ID\"}")
    fi
done

SPOKE_JSON=$(IFS=,$'\n'; echo "${SPOKE_ITEMS[*]}")

cat <<EOF > "$OUTPUT_FILE"
{
  "HUB_ACCOUNT_ID": "$HUB_ACCOUNT_ID",
  "HUB_PROFILE": "$HUB_PROFILE",
  "REGION": "$REGION",
  "SPOKE_PROFILES": [
$SPOKE_JSON
  ]
}
EOF

echo "Successfully generated '$OUTPUT_FILE'!"
