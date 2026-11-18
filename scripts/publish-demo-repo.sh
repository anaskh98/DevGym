#!/usr/bin/env bash
# Publishes demo-repo/ as its own GitHub repository (EV-1).
#
# The demo repo must be separate from this monorepo: Clarify runs on a clone of
# it, and the answer key in packages/eval must not be inside that clone.
#
#   scripts/publish-demo-repo.sh <owner/name> [--public]
#
# Needs the GitHub CLI (gh), logged in.
set -euo pipefail

REPO="${1:?usage: scripts/publish-demo-repo.sh <owner/name> [--public]}"
VISIBILITY="--private"
[[ "${2:-}" == "--public" ]] && VISIBILITY="--public"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Copy everything except installed dependencies.
(cd "$ROOT/demo-repo" && tar --exclude=node_modules -cf - .) | (cd "$WORK" && tar -xf -)

cd "$WORK"
git init -q -b main
git add .
git commit -q -m "Roomly: synthetic demo service and ticket DEMO-1"
gh repo create "$REPO" "$VISIBILITY" --source . --push \
  --description "Synthetic demo service for DevGym"

echo
echo "Published https://github.com/$REPO"
echo "Clone it somewhere outside this monorepo and run Claude Code there."
