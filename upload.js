const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Install dependencies if needed
try {
  require('nostr-tools');
  require('form-data');
  require('node-fetch');
} catch (error) {
  console.log('Installing dependencies...');
  const { execSync } = require('child_process');
  execSync('npm install nostr-tools form-data node-fetch@2');
}

const FormData = require('form-data');
const fetch = require('node-fetch');
const nostrTools = require('nostr-tools');

// Get inputs from environment
const filePath = process.env.FILE_PATH;
const nsecKey = process.env.NSEC_KEY;
const host = process.env.HOST || 'https://blossom.swishdash.site';
const uniqueId = process.env.UNIQUE_ID || Date.now().toString();
const contentType = process.env.CONTENT_TYPE || '';
const retries = parseInt(process.env.RETRIES || '3');

// Set GitHub Actions output
function setOutput(name, value) {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    fs.appendFileSync(githubOutput, `${name}=${value}\n`);
  }
}

// Calculate SHA256 hash of a file
function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    stream.on('error', err => reject(err));
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// Get file size
function getFileSize(filePath) {
  const stats = fs.statSync(filePath);
  return stats.size;
}

// Create Nostr auth event (NIP-98)
function createAuthEvent(nsecKey, uploadUrl, uniqueId) {
  try {
    // Convert nsec to hex private key if needed
    let privateKey;
    if (nsecKey.startsWith('nsec')) {
      try {
        privateKey = nostrTools.nip19.decode(nsecKey).data;
      } catch (error) {
        console.error(`Error decoding nsec: ${error.message}`);
        throw new Error(`Invalid nsec key: ${error.message}`);
      }
    } else {
      privateKey = nsecKey;
    }
    
    // Get public key from private key
    const pubkey = nostrTools.getPublicKey(privateKey);
    console.log(`Using pubkey: ${pubkey}`);
    
    // Create event with all required properties
    const event = {
      kind: 27235, // NIP-98 auth event
      created_at: Math.floor(Date.now() / 1000),
      pubkey: pubkey,
      tags: [
        ['u', uploadUrl],
        ['method', 'POST'],
        ['payload', uniqueId]
      ],
      content: ''
    };
    
    // Calculate event ID
    event.id = nostrTools.getEventHash(event);
    console.log(`Event ID: ${event.id}`);
    
    // Sign the event
    event.sig = nostrTools.signEvent(event, privateKey);
    console.log(`Event signature: ${event.sig.substring(0, 20)}...`);
    
    // Verify the event is valid
    const isValid = nostrTools.validateEvent(event);
    const isSignatureValid = nostrTools.verifySignature(event);
    
    console.log(`Event valid: ${isValid}`);
    console.log(`Signature valid: ${isSignatureValid}`);
    
    if (!isValid || !isSignatureValid) {
      throw new Error('Created event is invalid');
    }
    
    return event;
  } catch (error) {
    console.error(`Error in createAuthEvent: ${error.message}`);
    throw error;
  }
}

// Upload file to Blossom
async function uploadToBlossom(filePath, nsecKey, host, uniqueId, contentType, maxRetries) {
  // Validate inputs
  if (!filePath) {
    throw new Error('filePath is required');
  }
  if (!nsecKey) {
    throw new Error('nostrPrivateKey is required');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  // Calculate file hash and size
  const fileHash = await calculateFileHash(filePath);
  const fileSize = getFileSize(filePath);
  
  console.log(`File: ${filePath}`);
  console.log(`Hash: ${fileHash}`);
  console.log(`Size: ${fileSize} bytes`);
  
  // Upload with retries
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`Upload attempt ${attempt + 1}/${maxRetries}...`);
      
      // Create unique ID with attempt number if retrying
      const currentUniqueId = attempt > 0 ? `${uniqueId}-${attempt}` : uniqueId;
      
      // Create auth event
      const uploadUrl = `${host}/upload`;
      const authEvent = createAuthEvent(nsecKey, uploadUrl, currentUniqueId);
      
      // Prepare form data
      const form = new FormData();
      const fileStream = fs.createReadStream(filePath);
      
      if (contentType) {
        form.append('file', fileStream, {
          filename: path.basename(filePath),
          contentType: contentType
        });
      } else {
        form.append('file', fileStream);
      }
      
      // Upload file
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Nostr ${JSON.stringify(authEvent)}`
        },
        body: form
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log(`Upload successful: ${result.url}`);
        
        return {
          url: result.url,
          hash: result.hash || fileHash,
          size: fileSize,
          success: true
        };
      } else {
        const errorText = await response.text();
        console.error(`Upload failed: HTTP ${response.status}`);
        console.error(`Response: ${errorText}`);
        
        // If auth event already used, we'll retry with a new unique ID
        lastError = `HTTP ${response.status}: ${errorText}`;
        
        // Wait before retry with exponential backoff
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`Waiting ${delay}ms before next attempt...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    } catch (error) {
      console.error(`Error during upload: ${error.message}`);
      lastError = error.message;
      
      // Wait before retry
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Waiting ${delay}ms before next attempt...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // All attempts failed
  return {
    success: false,
    error: `Failed after ${maxRetries} attempts. Last error: ${lastError}`
  };
}

// Main function
async function main() {
  try {
    // Log nostr-tools version
    console.log(`nostr-tools version: ${nostrTools.version || 'unknown'}`);
    
    // Upload file
    const result = await uploadToBlossom(
      filePath,
      nsecKey,
      host,
      uniqueId,
      contentType,
      retries
    );
    
    // Set outputs
    if (result.success) {
      setOutput('url', result.url);
      setOutput('hash', result.hash);
      setOutput('size', result.size.toString());
      setOutput('success', 'true');
      process.exit(0);
    } else {
      setOutput('success', 'false');
      setOutput('error', result.error);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    setOutput('success', 'false');
    setOutput('error', error.message);
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  console.error(`Unhandled error: ${error.message}`);
  process.exit(1);
});