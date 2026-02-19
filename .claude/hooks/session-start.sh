#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Install Netlify CLI for local dev server (netlify dev)
if ! command -v netlify &> /dev/null; then
  echo "Installing Netlify CLI..."
  npm install -g netlify-cli
fi

echo "Session start hook complete."
