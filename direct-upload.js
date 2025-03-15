#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// Install dependencies if needed
try {
  require('nostr-tools');
  require('form-data');
  require('node-fetch');
} catch (error) {
  console.log('Installing dependencies...');
  execSync('npm install nostr-tools form-data node-fetch@2');
}

const FormData = require('form-data');
const fetch = require('node-fetch');
const { getEventHash, signEvent, nip19 } = require('nostr-tools');

// Get inputs from environment or command line
const filePath = process.argv[2] || process.env.FILE_PATH;
const nsecKey = process.env.NSEC_KEY;
const host = process.env.HOST || 'https://blossom.swissdash.site';
const uniqueId = process.env.UNIQUE_ID || Date.now().toString();
const contentType = process.env.CONTENT_TYPE || '';
const retries = parseInt(process.env.RETRIES || '3');

// Set GitHub Actions output if running in GitHub Actions
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
  // Convert nsec to hex private key if needed
  let privateKey;
  if (nsecKey.startsWith('nsec')) {
    try {
      privateKey = nip19.decode(nsecKey).data;
    } catch (error) {
      throw new Error(`Invalid nsec key: ${error.message}`);
    }
  } else {
    privateKey = nsecKey;
  }
  
  // Create event
  const event = {
    kind: 27235, // NIP-98 auth event
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['u', uploadUrl],
      ['method', 'POST'],
      ['payload', uniqueId]
    ],
    content: ''
  };
  
  // Calculate event ID and sign
  event.id = getEventHash(event);
  event.sig = signEvent(event, privateKey);
  
  return event;
}

// Upload file to Blossom
async function uploadToBlossom(filePath, nsecKey, host, uniqueId, contentType, maxRetries) {
  // Validate inputs
  if (!filePath) {
    throw new Error('File path is required');
  }
  if (!nsecKey) {
    throw new Error('Nostr private key is required');
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
    if (!filePath || !nsecKey) {
      console.log('Usage: node direct-upload.js <file_path>');
      console.log('Environment variables:');
      console.log('  NSEC_KEY: Nostr private key (required)');
      console.log('  HOST: Blossom host URL (default: https://blossom.swissdash.site)');
      console.log('  UNIQUE_ID: Unique identifier (default: timestamp)');
      console.log('  CONTENT_TYPE: Content type of the file (optional)');
      console.log('  RETRIES: Number of upload retries (default: 3)');
      process.exit(1);
    }
    
    // Upload file
    const result = await uploadToBlossom(
      filePath,
      nsecKey,
      host,
      uniqueId,
      contentType,
      retries
    );
    
    // Output results
    if (result.success) {
      console.log(`URL: ${result.url}`);
      console.log(`Hash: ${result.hash}`);
      console.log(`Size: ${result.size}`);
      
      // Set GitHub outputs if running in GitHub Actions
      setOutput('url', result.url);
      setOutput('hash', result.hash);
      setOutput('size', result.size.toString());
      setOutput('success', 'true');
      
      process.exit(0);
    } else {
      console.error(`Error: ${result.error}`);
      
      // Set GitHub outputs if running in GitHub Actions
      setOutput('success', 'false');
      setOutput('error', result.error);
      
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    
    // Set GitHub outputs if running in GitHub Actions
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