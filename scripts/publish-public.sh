#!/usr/bin/env bash
# Copy this working tree (no .env, no build cache) to the public GitHub repo.
# Do not `git push` this folder's main there — older private commits still contain a token.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${PUBLIC_REPO_DIR:-$ROOT/../railway-billing-inspector}"
REMOTE="https://github.com/sas70/railway-billing-inspector.git"
MESSAGE="${1:-Update public Railway Billing Inspector from local work.}"

echo "Tip: if you merged a PR on GitHub, run npm run pull:public first so this copy does not overwrite it."

if [[ -e "$DEST" && ! -d "$DEST/.git" ]]; then
  echo "Refusing to publish: $DEST exists and is not a git repo." >&2
  exit 1
fi

if [[ ! -d "$DEST/.git" ]]; then
  git clone "$REMOTE" "$DEST"
fi

git -C "$DEST" checkout main
git -C "$DEST" pull --ff-only origin main

rsync -a --delete \
  --exclude '.git/' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '.next/' \
  --exclude 'node_modules/' \
  --exclude 'data/audit-log.jsonl' \
  --exclude 'data/audit-log.demo.jsonl' \
  --exclude 'tsconfig.tsbuildinfo' \
  --exclude '.DS_Store' \
  --exclude 'railway-billing-inspector-README.md' \
  "$ROOT/" "$DEST/"

cd "$DEST"
if git diff --cached --name-only --quiet && git diff --name-only --quiet && [[ -z "$(git ls-files --others --exclude-standard)" ]]; then
  echo "Public repo already matches this folder. Nothing to push."
  exit 0
fi

git add -A
if git diff --cached --name-only | grep -E '(^|/)\.env$|(^|/)\.env\.local$'; then
  echo "Refusing to publish: a real .env file was staged." >&2
  exit 1
fi

git commit -m "$MESSAGE"
git push origin HEAD
echo "Published: https://github.com/sas70/railway-billing-inspector"
echo "Vercel will redeploy https://railway-billing-inspector.vercel.app"
