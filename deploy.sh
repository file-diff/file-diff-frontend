#!/usr/bin/env bash

set -ex  # Stop the script if any command fails

IMAGE_NAME="file-diff-frontend:latest"
CONTAINER_NAME="file-diff-frontend"
GIT_COMMIT="${VITE_GIT_COMMIT:-${GITHUB_SHA:-$(git rev-parse --short HEAD)}}"
test -n "$GIT_COMMIT" || { echo "Error: Unable to determine git commit SHA" >&2; exit 1; }
GIT_COMMIT="${GIT_COMMIT:0:7}"

# Build the Docker image (includes client + SSR server bundles)
docker build \
  --build-arg VITE_GIT_COMMIT="$GIT_COMMIT" \
  --build-arg VITE_API_BASE_URL="https://filediff.org/api" \
  -t "$IMAGE_NAME" \
  -f Dockerfile.build .

# Stop and remove the existing container (if any)
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

# Run the new container
docker run -d \
  --name "$CONTAINER_NAME" \
  -p 3000:3000 \
  -e API_BASE_URL="https://filediff.org/api" \
  --restart unless-stopped \
  "$IMAGE_NAME"
