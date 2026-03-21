#!/usr/bin/env bash

set -ex  # Stop the script if any command fails

IMAGE_NAME="file-diff-frontend:latest"
CONTAINER_NAME="file-diff-frontend"
GIT_COMMIT="${VITE_GIT_COMMIT:-${GITHUB_SHA:-$(git rev-parse --short HEAD)}}"
test -n "$GIT_COMMIT" || { echo "Error: Unable to determine git commit SHA" >&2; exit 1; }
GIT_COMMIT="${GIT_COMMIT:0:7}"

docker compose down
docker compose up -d --force-recreate --build