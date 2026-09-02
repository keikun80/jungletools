/**
 * Application AWS Configuration (Template)
 * Copy this file to config.js and update with your actual environment values.
 */
window.APP_CONFIG = {
  // API Gateway Endpoint URL
  apiEndpoint: "https://<YOUR_API_ID>.execute-api.ap-northeast-2.amazonaws.com",
  
  // AWS Region
  defaultRegion: "ap-northeast-2",
  
  // Hub Account ID (Primary Deployment Account)
  localAccountId: "123456789012",
  
  // Cross-Account IAM Role Name
  defaultRoleName: "SgAutomationCrossAccountRole",
  
  // Target Accounts List for Selector
  targetAccounts: [
    { id: "123456789012", label: "Local Account (123456789012)" },
    { id: "987654321098", label: "Spoke Account 1 (987654321098)" }
  ]
};
