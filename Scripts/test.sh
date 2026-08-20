#!/usr/bin/env bash
# Mirrors the native Perlite app repo's own Scripts/test.sh: typecheck + the full test
# suite (including the conformance corpus), with the same corpus-presence guard.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Same check the native app repo's Scripts/test.sh has — an uninitialized submodule
# leaves conformance/ present but empty; this turns that into an actionable message
# instead of a confusing "could not read index.json" error deep in the test run.
if [ ! -f "$REPO_ROOT/conformance/SCHEMA.md" ]; then
    echo "FAIL: conformance/SCHEMA.md not found. Run:" >&2
    echo "  git submodule update --init" >&2
    exit 1
fi

echo "==> npm run typecheck"
npm run typecheck

echo ""
echo "==> npm test"
npm test
