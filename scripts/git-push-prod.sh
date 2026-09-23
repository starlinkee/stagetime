#!/usr/bin/env bash
# `git push-prod "commit message"` — commits + pushes to main (Vercel production deploy).
# Works from either main or dev. See scripts/git-push-target.sh and AGENTS.md.
set -euo pipefail
exec "$(dirname "${BASH_SOURCE[0]}")/git-push-target.sh" main "$@"
