#!/bin/bash
# Auto-sync china-globe changes to GitHub → live site updates in ~60s
set -e
cd "$(dirname "$0")"
TOKEN=$(security find-generic-password -s "GitHub - https://api.github.com" -a "victormnl24-cpu" -w 2>/dev/null)
git remote set-url origin "https://victormnl24-cpu:${TOKEN}@github.com/victormnl24-cpu/RedDragonTracker.git"
git add -A
if git diff --staged --quiet; then
  echo "Nothing to push — already up to date."
else
  git commit -m "Update: $(date '+%Y-%m-%d %H:%M')"
  git push origin main
  echo "✅ Pushed → https://victormnl24-cpu.github.io/RedDragonTracker/"
fi
