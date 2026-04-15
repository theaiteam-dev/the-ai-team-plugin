#!/usr/bin/env bash
# Called by semantic-release via @semantic-release/exec to update
# plugin.json and marketplace.json with the new release version.
#
# Usage: ./scripts/bump-plugin-version.sh <version>
# Example: ./scripts/bump-plugin-version.sh 1.3.0

set -euo pipefail

VERSION="$1"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PLUGIN_JSON="$ROOT_DIR/.claude-plugin/plugin.json"
MARKETPLACE_JSON="$ROOT_DIR/.claude-plugin/marketplace.json"

# Update plugin.json version
sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$PLUGIN_JSON"
rm -f "$PLUGIN_JSON.bak"

# Update marketplace.json version
sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$MARKETPLACE_JSON"
rm -f "$MARKETPLACE_JSON.bak"

# Bump minCliVersion if packages/ateam-cli/ changed since last tag
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || true)
if [ -n "$LAST_TAG" ]; then
  CLI_CHANGED=$(git diff --name-only "$LAST_TAG"..HEAD -- packages/ateam-cli/ | head -1)
else
  # No previous tag — treat as CLI change (first release)
  CLI_CHANGED="first-release"
fi

if [ -n "$CLI_CHANGED" ]; then
  sed -i.bak "s/\"minCliVersion\": \"[^\"]*\"/\"minCliVersion\": \"$VERSION\"/" "$PLUGIN_JSON"
  rm -f "$PLUGIN_JSON.bak"
  echo "Bumped minCliVersion to $VERSION (CLI changes detected)"
else
  echo "minCliVersion unchanged (no CLI changes)"
fi

echo "Bumped plugin.json and marketplace.json to $VERSION"
