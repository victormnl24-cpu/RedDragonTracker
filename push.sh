#!/bin/bash
# Auto-sync china-globe changes to GitHub → live site updates in ~60s
set -e
cd "$(dirname "$0")"
git add -A
if git diff --staged --quiet; then
  echo "Nothing to push — already up to date."
else
  git commit -m "Update: $(date '+%Y-%m-%d %H:%M')"
  git push origin main
  echo "✅ Pushed to GitHub — https://victormnl24-cpu.github.io/china-globe/"
fi
