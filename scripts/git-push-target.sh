#!/usr/bin/env bash
# Shared implementation behind `git push-preview` (-> dev) and `git push-prod` (-> main).
# See "Branch policy" in AGENTS.md — this repo only ever works on main/dev.
#
# Works no matter which of the two branches you're currently on:
#   - if you have uncommitted changes and you're already on the target branch, it just
#     commits + pushes them there;
#   - if you have uncommitted changes and you're on the OTHER branch, it stashes them,
#     switches to the target branch, re-applies the stash, commits, and pushes;
#   - either way, once pushed it switches you back to whichever branch you started on.
set -euo pipefail

target="$1"
shift
msg="${1:-}"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ "$target" != "dev" && "$target" != "main" ]]; then
  echo "error: internal — target must be dev or main, got '$target'" >&2
  exit 1
fi

start_branch="$(git rev-parse --abbrev-ref HEAD)"
dirty="$(git status --porcelain)"

if [[ -n "$dirty" && -z "$msg" ]]; then
  alias_name="push-prod"; [[ "$target" == "dev" ]] && alias_name="push-preview"
  echo "error: uncommitted changes present — pass a commit message, e.g.:" >&2
  echo "  git $alias_name \"message\"" >&2
  exit 1
fi

stashed=0
if [[ -n "$dirty" && "$start_branch" != "$target" ]]; then
  echo "Stashing uncommitted changes off '$start_branch'..."
  git stash push -u -m "push-$target: relocate from $start_branch"
  stashed=1
fi

if [[ "$start_branch" != "$target" ]]; then
  git checkout "$target"
fi

git fetch origin "$target"
git pull --ff-only origin "$target"

if [[ "$stashed" == "1" ]]; then
  if ! git stash pop; then
    echo "error: your changes conflict with '$target' — resolve manually (your stash is" >&2
    echo "kept: run 'git stash list'), then commit and push yourself." >&2
    exit 1
  fi
fi

if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git commit -m "$msg"
fi

git push origin "$target"
echo "Pushed to $target."

if [[ "$start_branch" != "$target" ]]; then
  git checkout "$start_branch"
fi
