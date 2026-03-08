#!/usr/bin/env bash

set -ex  # Added -e to stop the script if any command fails

# Build inside Docker to ensure consistent environment and produce static /app/dist
IMAGE_NAME="file-diff-frontend:build"
CONTAINER_NAME="file-diff-frontend-build-tmp-$$"

# Build the docker image using the dedicated build Dockerfile
docker build -t "$IMAGE_NAME" -f Dockerfile.build .

# Create a temporary container from the image
docker create --name "$CONTAINER_NAME" "$IMAGE_NAME"

# Ensure we don't have a leftover dist folder locally
rm -rf dist

# Copy the built dist out of the container
docker cp "$CONTAINER_NAME":/app/dist ./dist

# Remove the temporary container
docker rm "$CONTAINER_NAME"

# Deploy (Using -rf to ensure the old directory is cleared)
sudo rm -rf /var/www/file-diff-frontend
sudo mv dist /var/www/file-diff-frontend