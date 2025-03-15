# Blossom Uploader Action

A GitHub Action for uploading files to Blossom with Nostr authentication.

## Features

- Upload files to Blossom using Nostr authentication (NIP-98)
- Automatic retries with exponential backoff
- Support for custom content types
- Unique ID generation to prevent auth event reuse
- Detailed output including URL, hash, and size

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `host` | Blossom host URL | Yes | `https://blossom.swissdash.site` |
| `filePath` | Path to the file to upload | Yes | - |
| `nostrPrivateKey` | Nostr private key (nsec or hex format) | Yes | - |
| `contentType` | Content type of the file | No | - |
| `uniqueId` | Unique identifier to prevent auth reuse | No | Timestamp |
| `retries` | Number of upload retries | No | `3` |

## Outputs

| Output | Description |
|--------|-------------|
| `url` | URL of the uploaded file |
| `hash` | Hash of the uploaded file |
| `size` | Size of the uploaded file in bytes |
| `success` | Whether the upload was successful (true/false) |
| `error` | Error message if upload failed |

## Example Usage

```yaml
- name: Upload to Blossom
  id: blossom_upload
  uses: OpenTollGate/python-blossom-uploader@main
  with:
    host: "https://blossom.swissdash.site"
    filePath: "path/to/file.zip"
    nostrPrivateKey: ${{ secrets.NSEC }}
    uniqueId: ${{ github.run_id }}-${{ github.run_number }}

- name: Use Upload Result
  if: steps.blossom_upload.outputs.success == 'true'
  run: |
    echo "File uploaded to: ${{ steps.blossom_upload.outputs.url }}"
    echo "File hash: ${{ steps.blossom_upload.outputs.hash }}"
    echo "File size: ${{ steps.blossom_upload.outputs.size }} bytes"
```

## Error Handling

The action will automatically retry failed uploads with exponential backoff. If all retries fail, the action will exit with a non-zero status code and set the `success` output to `false`.

## Authentication

This action uses Nostr authentication (NIP-98) to authenticate with Blossom. You need to provide a Nostr private key (nsec or hex format) as the `nostrPrivateKey` input.

## License

MIT
