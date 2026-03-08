#!/usr/bin/env bash

set -ex  # Added -e to stop the script if any command fails

# Use 'ci' for a guaranteed, immutable install based on your lockfile
npm ci

# Build the project
npm run build

# Deploy (Using -rf to ensure the old directory is cleared)
sudo rm -rf /var/www/file-diff-frontend
sudo mv dist /var/www/file-diff-frontend