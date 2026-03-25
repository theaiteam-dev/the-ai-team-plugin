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

echo "Bumped plugin.json and marketplace.json to $VERSION"
