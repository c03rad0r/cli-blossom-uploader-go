#!/usr/bin/env python3
import os
import sys
import json
import time
import requests
import hashlib
from pathlib import Path
import base64
import binascii

# Try different Nostr libraries with fallbacks
try:
    from nostr.key import PrivateKey
    from nostr.event import Event
    import inspect
    
    # Check Event constructor parameters to handle different API versions
    event_params = inspect.signature(Event.__init__).parameters
    NOSTR_LIB = "nostr-python"
    print(f"Detected Nostr library: {NOSTR_LIB}")
    print(f"Event constructor parameters: {list(event_params.keys())}")
except ImportError:
    try:
        import nostr
        NOSTR_LIB = "nostr"
        print(f"Detected Nostr library: {NOSTR_LIB}")
    except ImportError:
        print("Warning: No Nostr library found. Implementing basic Nostr functionality.")
        NOSTR_LIB = "custom"

class BlossomUploader:
    def __init__(self, host, nsec_key, file_path, content_type="", unique_id="", retries=3):
        self.host = host.rstrip('/')
        self.nsec_key = nsec_key
        self.file_path = file_path
        self.content_type = content_type
        self.unique_id = unique_id or str(int(time.time()))
        self.retries = int(retries)
        
        # Validate inputs
        if not Path(file_path).exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        
        # Set GitHub outputs function
        self.set_output = self._github_output
    
    def _github_output(self, name, value):
        """Set GitHub Actions output variable"""
        with open(os.environ.get('GITHUB_OUTPUT', '/dev/null'), 'a') as f:
            f.write(f"{name}={value}\n")
        # Legacy method (deprecated but keeping for compatibility)
        print(f"::set-output name={name}::{value}")
    
    def _create_auth_event_nostr_python(self):
        """Create auth event using nostr-python library"""
        try:
            # Convert nsec to hex private key if needed
            if self.nsec_key.startswith('nsec'):
                private_key = PrivateKey.from_nsec(self.nsec_key)
            else:
                try:
                    private_key = PrivateKey(bytes.fromhex(self.nsec_key))
                except:
                    raise ValueError("Invalid private key format")
            
            # Get public key
            pubkey = private_key.public_key.hex()
            timestamp = int(time.time())
            
            # Create event with different parameter names based on library version
            try:
                # Try with pub_key parameter (older versions)
                event = Event(
                    kind=27235,
                    content="",
                    tags=[
                        ["u", f"{self.host}/upload"],
                        ["method", "POST"],
                        ["payload", self.unique_id]
                    ],
                    pub_key=pubkey,
                    created_at=timestamp
                )
            except TypeError as e:
                if "pub_key" in str(e):
                    # Try with pubkey parameter (newer versions)
                    event = Event(
                        kind=27235,
                        content="",
                        tags=[
                            ["u", f"{self.host}/upload"],
                            ["method", "POST"],
                            ["payload", self.unique_id]
                        ],
                        pubkey=pubkey,
                        created_at=timestamp
                    )
                else:
                    # Try alternative approach
                    event = Event()
                    event.kind = 27235
                    event.content = ""
                    event.tags = [
                        ["u", f"{self.host}/upload"],
                        ["method", "POST"],
                        ["payload", self.unique_id]
                    ]
                    event.pubkey = pubkey
                    event.created_at = timestamp
            
            # Sign the event
            try:
                # Try direct signing method
                event.sign(private_key.hex())
            except (AttributeError, TypeError):
                # Alternative signing approach
                try:
                    from nostr.key import PrivateKey as NostrPrivateKey
                    pk = NostrPrivateKey.from_hex(private_key.hex())
                    event.sig = pk.sign_event_id(event.id)
                except:
                    # Last resort manual signing
                    print("Using manual event signing")
                    event_data = json.dumps([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
                    event_id = hashlib.sha256(event_data.encode()).hexdigest()
                    event.id = event_id
                    # Note: This is a placeholder. In production, implement proper signing
                    event.sig = "placeholder_signature"
            
            return json.dumps(event.to_dict())
        except Exception as e:
            print(f"Error in _create_auth_event_nostr_python: {e}")
            raise
    
    def _create_auth_event_custom(self):
        """Create auth event using custom implementation"""
        # Convert nsec to hex if needed
        if self.nsec_key.startswith('nsec'):
            try:
                # Remove nsec prefix and decode bech32
                data = self.nsec_key[4:]
                # This is a simplified version - in production use proper bech32 decoding
                decoded = base64.b64decode(data + '=' * (-len(data) % 4))
                private_key_hex = binascii.hexlify(decoded).decode('utf-8')
            except:
                raise ValueError("Invalid nsec format")
        else:
            private_key_hex = self.nsec_key
        
        # For a complete implementation, we would:
        # 1. Derive public key from private key
        # 2. Create event object
        # 3. Calculate event ID
        # 4. Sign event with private key
        
        # This is a placeholder - in a real implementation you would:
        # - Use proper cryptographic libraries for key derivation and signing
        # - Implement the full Nostr event creation and signing process
        
        raise NotImplementedError(
            "Custom Nostr implementation not available. Please install nostr-python: pip install nostr"
        )
    
    def create_auth_event(self):
        """Create Nostr auth event for Blossom upload"""
        if NOSTR_LIB == "nostr-python":
            return self._create_auth_event_nostr_python()
        elif NOSTR_LIB == "nostr":
            # Implement for alternative nostr library if needed
            raise NotImplementedError("Support for 'nostr' library not implemented")
        else:
            return self._create_auth_event_custom()
    
    def upload(self):
        """Upload file to Blossom"""
        file_path = Path(self.file_path)
        file_size = file_path.stat().st_size
        
        # Calculate file hash
        sha256_hash = hashlib.sha256()
        with open(file_path, 'rb') as f:
            for byte_block in iter(lambda: f.read(4096), b""):
                sha256_hash.update(byte_block)
        file_hash = sha256_hash.hexdigest()
        
        # Prepare upload
        headers = {}
        files = {'file': open(file_path, 'rb')}
        
        # Add content type if specified
        if self.content_type:
            files = {'file': (file_path.name, open(file_path, 'rb'), self.content_type)}
        
        # Create auth event and add to headers
        try:
            auth_event = self.create_auth_event()
            headers['Authorization'] = f'Nostr {auth_event}'
        except Exception as e:
            self.set_output("success", "false")
            self.set_output("error", str(e))
            print(f"Error creating auth event: {e}")
            return False
        
        # Attempt upload with retries
        for attempt in range(self.retries):
            try:
                print(f"Upload attempt {attempt + 1}/{self.retries}...")
                response = requests.post(
                    f"{self.host}/upload",
                    headers=headers,
                    files=files
                )
                
                if response.status_code == 200:
                    result = response.json()
                    print(f"Upload successful: {result.get('url', 'No URL returned')}")
                    
                    # Set outputs
                    self.set_output("url", result.get('url', ''))
                    self.set_output("hash", result.get('hash', file_hash))
                    self.set_output("size", str(file_size))
                    self.set_output("success", "true")
                    return True
                else:
                    print(f"Upload failed: HTTP {response.status_code}")
                    print(f"Response: {response.text}")
                    
                    # If auth event was already used, regenerate with new timestamp
                    if "Auth event already used" in response.text:
                        print("Auth event already used, regenerating...")
                        self.unique_id = str(int(time.time())) + f"-{attempt}"
                        auth_event = self.create_auth_event()
                        headers['Authorization'] = f'Nostr {auth_event}'
                    
                    # Wait before retry
                    if attempt < self.retries - 1:
                        time.sleep(2 ** attempt)  # Exponential backoff
            except Exception as e:
                print(f"Error during upload: {e}")
                if attempt < self.retries - 1:
                    time.sleep(2 ** attempt)
        
        # All attempts failed
        self.set_output("success", "false")
        self.set_output("error", f"Failed after {self.retries} attempts")
        return False

def main():
    """Main entry point for the action"""
    # Get inputs from environment variables (set by GitHub Actions)
    host = os.environ.get('INPUT_HOST', 'https://blossom.swissdash.site')
    file_path = os.environ.get('INPUT_FILEPATH', '')
    nsec_key = os.environ.get('INPUT_NOSTRPRIVATEKEY', '')
    content_type = os.environ.get('INPUT_CONTENTTYPE', '')
    unique_id = os.environ.get('INPUT_UNIQUEID', '')
    retries = os.environ.get('INPUT_RETRIES', '3')
    
    # Validate required inputs
    if not file_path:
        print("Error: filePath is required")
        sys.exit(1)
    if not nsec_key:
        print("Error: nostrPrivateKey is required")
        sys.exit(1)
    
    # Create uploader and execute
    try:
        uploader = BlossomUploader(
            host=host,
            nsec_key=nsec_key,
            file_path=file_path,
            content_type=content_type,
            unique_id=unique_id,
            retries=retries
        )
        success = uploader.upload()
        
        if not success:
            sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
