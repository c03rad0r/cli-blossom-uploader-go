# Blossom CLI Uploader Action

A GitHub Action for uploading files to Blossom with Nostr authentication using the blossom-cli tool.

## Features

- Upload files to Blossom using Nostr authentication
- Automatic installation of the blossom-cli tool
- File hash verification
- Detailed output including URL and hash

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `host` | Blossom host URL | Yes | `https://blossom.swissdash.site` |
| `filePath` | Path to the file to upload | Yes | - |
| `nostrPrivateKey` | Nostr private key (must be in nsec format) | Yes | - |
| `cliVersion` | Version of blossom-cli to use | No | `latest` |

## Outputs

| Output | Description |
|--------|-------------|
| `url` | URL of the uploaded file |
| `hash` | Hash of the uploaded file |
| `success` | Whether the upload was successful (true/false) |
| `error` | Error message if upload failed |

## Example Usage

```yaml
- name: Upload to Blossom
  id: blossom_upload
  uses: c03rad0r/cli-blossom-uploader-go@main
  with:
    host: "https://blossom.swissdash.site"
    filePath: "path/to/file.zip"
    nostrPrivateKey: ${{ secrets.NSEC }}

- name: Use Upload Result
  if: steps.blossom_upload.outputs.success == 'true'
  run: |
    echo "File uploaded to: ${{ steps.blossom_upload.outputs.url }}"
    echo "File hash: ${{ steps.blossom_upload.outputs.hash }}"
```

## Private Key Format

This action requires your Nostr private key to be in nsec format (starting with 'nsec'). If you have a hex format key, you'll need to convert it to nsec format before using this action.

## How It Works

The action performs the following steps:

1. Sets up Go 1.22 in the GitHub Actions environment
2. Installs the blossom-cli tool from source
3. Validates that the provided private key is in nsec format
4. Calculates the SHA256 hash of the file to be uploaded
5. Uploads the file to the specified Blossom host
6. Extracts the URL and hash from the upload response
7. Sets the outputs for use in subsequent steps

## Error Handling

If the upload fails, the action will set the `success` output to `false` and provide the error message in the `error` output. The action will exit with a non-zero status code in case of failure.

## Testing

You can test this action using the provided test workflow in `.github/workflows/test-blossom-upload.yml`. This workflow:

1. Generates a random test file
2. Uploads it to Blossom
3. Verifies the upload was successful
4. Downloads the file back
5. Compares the original and downloaded file hashes to ensure integrity

## License

MIT
