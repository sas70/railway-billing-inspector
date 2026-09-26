#!/usr/bin/env bash
# Copy the latest public GitHub main into this folder (never touches .env).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! git remote get-url public >/dev/null 2>&1; then
  git remote add public https://github.com/sas70/railway-billing-inspector.git
  git remote set-url --push public no-push-use-npm-run-publish-public
fi

git fetch public
git checkout public/main -- .
echo "Public main is now in this folder. Your .env was left alone."
echo "Review with git status, then commit here if you want a private backup."
