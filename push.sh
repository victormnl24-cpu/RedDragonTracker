#!/bin/bash
# Sync RedDragonTracker to GitHub → Cloudflare Pages rebuilds → live in ~60s
set -euo pipefail
cd "$(dirname "$0")"

GH_USER="victormnl24-cpu"
GH_REPO="github.com/victormnl24-cpu/RedDragonTracker.git"
BRANCH="main"

TOKEN=$(security find-generic-password -s "GitHub - https://api.github.com" \
        -a "$GH_USER" -w 2>/dev/null || true)
if [ -z "$TOKEN" ]; then
    echo "❌ Could not read the GitHub token from the keychain."
    echo "   Expected a generic password: service 'GitHub - https://api.github.com', account '$GH_USER'."
    exit 1
fi

# Always put the tokenless URL back — even on failure — so the token is
# never left sitting in .git/config where anything can read it.
restore_remote() { git remote set-url origin "https://$GH_REPO" 2>/dev/null || true; }
trap restore_remote EXIT

# ── Commit working-tree changes, if any ────────────────────────────────
git add -A
if git diff --staged --quiet; then
    echo "No file changes to commit."
else
    git commit -m "Update: $(date '+%Y-%m-%d %H:%M')"
    echo "✅ Committed working-tree changes."
fi

git remote set-url origin "https://$GH_USER:$TOKEN@$GH_REPO"

# ── Never clobber remote work ──────────────────────────────────────────
git fetch --quiet origin "$BRANCH"
BEHIND=$(git rev-list --count "$BRANCH".."origin/$BRANCH")
AHEAD=$(git rev-list --count "origin/$BRANCH".."$BRANCH")

if [ "$BEHIND" -gt 0 ]; then
    echo "⚠️  origin/$BRANCH has $BEHIND commit(s) you don't have locally."
    echo "   Integrate them first:  git pull --rebase origin $BRANCH"
    exit 1
fi

# This is the case the old script got wrong: a clean working tree but
# commits that were never pushed. It reported "up to date" and pushed nothing.
if [ "$AHEAD" -eq 0 ]; then
    echo "Nothing to push — already in sync with origin/$BRANCH."
    exit 0
fi

echo "Pushing $AHEAD commit(s)…"
git push origin "$BRANCH"
echo "✅ Pushed → https://reddragontracker.com (Cloudflare Pages rebuilds in ~60s)"
