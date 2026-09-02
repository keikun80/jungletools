#!/bin/bash
# Usage: ./scripts/deploy-all.sh [PROFILE] [REGION]

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default values
PROFILE=${1:-"l-iam-s2"}
REGION=${2:-"ap-northeast-2"}

# Load environment configuration
if [ -f "../env.json" ]; then
    HUB_PROFILE=$(grep -o '"HUB_PROFILE": *"[^"]*' "../env.json" | grep -o '[^"]*$')
    REGION=$(grep -o '"REGION": *"[^"]*' "../env.json" | grep -o '[^"]*$')
    PROFILE=${HUB_PROFILE:-$PROFILE}
    echo -e "${YELLOW}Loaded configuration from env.json${NC}"
    echo -e "  Profile: ${PROFILE}"
    echo -e "  Region: ${REGION}"
else
    echo -e "${YELLOW}No env.json found. Using default values.${NC}"
fi

echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN}SG Automation Full Deployment${NC}"
echo -e "${CYAN}Profile: ${PROFILE}${NC}"
echo -e "${CYAN}Region: ${REGION}${NC}"
echo -e "${CYAN}============================================================${NC}"

# Step 0: Check env.json
echo -e "\n${YELLOW}[Step 0] Checking environment configuration...${NC}"
if [ ! -f "../env.json" ]; then
    echo -e "${RED}env.json not found. Please run generate-env-json.sh first.${NC}"
    exit 1
fi

# Step 1: Install backend dependencies
echo -e "\n${YELLOW}[Step 1] Installing backend dependencies...${NC}"
cd "../backend"
echo -e "${CYAN}Running: npm install${NC}"
npm install
if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to install backend dependencies.${NC}"
    exit 1
fi
cd "../"

# Step 2: Build SAM application
echo -e "\n${YELLOW}[Step 2] Building SAM application...${NC}"
echo -e "${CYAN}Running: sam build${NC}"
sam build --template-file template.yaml --build-dir .aws-sam/build --use-container
if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to build SAM application.${NC}"
    exit 1
fi

# Step 3: Deploy SAM application
echo -e "\n${YELLOW}[Step 3] Deploying SAM application...${NC}"
echo -e "${CYAN}Running: sam deploy${NC}"
sam deploy \
    --template-file .aws-sam/build/template.yaml \
    --stack-name sg-automation-stack \
    --resolve-s3 \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "$REGION" \
    --profile "$PROFILE" \
    --no-confirm-changeset
if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to deploy SAM application.${NC}"
    exit 1
fi

# Step 4: Get S3 bucket name and sync frontend
echo -e "\n${YELLOW}[Step 4] Syncing frontend to S3...${NC}"
stack_outputs=$(aws cloudformation describe-stacks \
    --stack-name sg-automation-stack \
    --query "Stacks[0].Outputs[?OutputKey=='FrontendWebsiteUrl'].OutputValue" \
    --output text \
    --profile "$PROFILE" \
    --region "$REGION" \
    --no-paginate)

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to get stack outputs.${NC}"
    exit 1
fi

# Extract bucket name from website URL
bucket_name=$(echo "$stack_outputs" | sed -e 's|https://||' -e 's|/||' -e 's|\.s3-website.*||')
echo -e "${GREEN}S3 Bucket Name: ${bucket_name}${NC}"

echo -e "${CYAN}Running: aws s3 sync frontend/ s3://$bucket_name/${NC}"
aws s3 sync ../frontend/ "s3://$bucket_name/" \
    --profile "$PROFILE" \
    --region "$REGION" \
    --delete \
    --no-paginate

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to sync frontend to S3.${NC}"
    exit 1
fi

# Summary
echo -e "\n${CYAN}============================================================${NC}"
echo -e "${GREEN}Deployment Completed Successfully!${NC}"
echo -e "${CYAN}============================================================${NC}"
echo -e "\n${WHITE}CloudFormation Stack: sg-automation-stack${NC}"
api_endpoint=$(echo "$stack_outputs" | sed 's|website|execute-api|')
echo -e "${WHITE}API Endpoint: ${CYAN}$api_endpoint${NC}"
echo -e "${WHITE}Frontend URL: ${CYAN}$stack_outputs${NC}"
echo -e "\n${YELLOW}Next Steps:${NC}"
echo -e "  1. Open the Frontend URL in your browser"
echo -e "  2. Configure IAM credentials with MFA for authentication"
echo -e "  3. Refer to README.md for usage instructions"
