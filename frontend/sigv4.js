// AWS Signature Version 4 Signing Helper using CryptoJS
// Implements client-side signing for AWS API Gateway (execute-api) requests.

function signRequest(url, method, headers, bodyData, credentials) {
  const { accessKeyId, secretAccessKey, sessionToken, region } = credentials;
  const service = 'execute-api';

  // Parse URL
  const parsedUrl = new URL(url);
  const host = parsedUrl.host;
  const path = parsedUrl.pathname;
  const searchParams = parsedUrl.searchParams;

  // 1. Create ISO dates
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, ''); // e.g., 20260729T073000Z
  const dateStamp = amzDate.substr(0, 8); // e.g., 20260729

  // Clone and lowercase all keys of incoming headers
  const lowercaseHeaders = {};
  if (headers) {
    for (const key of Object.keys(headers)) {
      lowercaseHeaders[key.toLowerCase()] = headers[key];
    }
  }

  // Add mandatory AWS headers
  lowercaseHeaders['host'] = host;
  lowercaseHeaders['x-amz-date'] = amzDate;
  if (sessionToken) {
    lowercaseHeaders['x-amz-security-token'] = sessionToken;
  }

  // 2. Canonical Request Components
  const canonicalUri = path;
  
  // Sort and escape query parameters
  const queryKeys = Array.from(searchParams.keys()).sort();
  const canonicalQuery = queryKeys.map(key => {
    return encodeURIComponent(key) + '=' + encodeURIComponent(searchParams.get(key));
  }).join('&');

  // Format headers canonically (lowercase keys, trimmed values, sorted)
  const headerKeys = Object.keys(lowercaseHeaders).sort();
  const canonicalHeaders = headerKeys.map(k => {
    const val = lowercaseHeaders[k].trim().replace(/\s+/g, ' ');
    return k + ':' + val;
  }).join('\n') + '\n';

  const signedHeaders = headerKeys.join(';');

  // Calculate payload hash
  const payload = typeof bodyData === 'string' ? bodyData : (JSON.stringify(bodyData) || '');
  const hashedPayload = CryptoJS.SHA256(payload).toString(CryptoJS.enc.Hex);

  // Combine to Canonical Request
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    hashedPayload
  ].join('\n');

  const hashedCanonicalRequest = CryptoJS.SHA256(canonicalRequest).toString(CryptoJS.enc.Hex);

  // 3. String to Sign
  const credentialScope = [dateStamp, region, service, 'aws4_request'].join('/');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    hashedCanonicalRequest
  ].join('\n');

  // 4. Calculate Signature
  function getSignatureKey(key, date, regionName, serviceName) {
    const kDate = CryptoJS.HmacSHA256(date, 'AWS4' + key);
    const kRegion = CryptoJS.HmacSHA256(regionName, kDate);
    const kService = CryptoJS.HmacSHA256(serviceName, kRegion);
    const kSigning = CryptoJS.HmacSHA256('aws4_request', kService);
    return kSigning;
  }

  const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = CryptoJS.HmacSHA256(stringToSign, signingKey).toString(CryptoJS.enc.Hex);

  // 5. Authorization Header value
  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  // Add final Authorization header to request headers
  lowercaseHeaders['authorization'] = authorizationHeader;

  return lowercaseHeaders;
}
