#!/usr/bin/env bash
# `git push-preview "commit message"` — commits + pushes to dev (Vercel preview deploy).
# Works from either main or dev. See scripts/git-push-target.sh and AGENTS.md.
set -euo pipefail
exec "$(dirname "${BASH_SOURCE[0]}")/git-push-target.sh" dev "$@"
