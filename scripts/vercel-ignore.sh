#!/usr/bin/env bash
# Vercel "Ignored Build Step" (vercel.json ignoreCommand).
# Exit 1 = build the deployment, exit 0 = skip it.
#
# Rules (D31, owner approval in PR 1.1):
# - Preview deployments always build.
# - Production builds only from `main`; any other Production build is skipped.
# - A Production build from `main` is skipped when every file changed since the
#   last successful Production deployment is documentation: anything under docs/
#   or any Markdown file (*.md at any depth). Production keeps serving the
#   previous build, whose application code is identical.
# - Fail safe: if the comparison is impossible (no previous deployment, a commit
#   missing from the shallow clone, any git error), build.
set -u

env_name="${VERCEL_ENV:-}"
branch="${VERCEL_GIT_COMMIT_REF:-}"

if [ "$env_name" = "preview" ]; then
  echo "Build: Preview deployment."
  exit 1
fi

if [ "$env_name" != "production" ] || [ "$branch" != "main" ]; then
  echo "Skipped: only Preview or main builds (D31)."
  exit 0
fi

previous="${VERCEL_GIT_PREVIOUS_SHA:-}"
current="${VERCEL_GIT_COMMIT_SHA:-}"

if [ -z "$previous" ] || [ -z "$current" ]; then
  echo "Build: no previous Production deployment to compare with."
  exit 1
fi

git diff --quiet "$previous" "$current" -- . ':(exclude)docs' ':(exclude)*.md' 2>/dev/null
status=$?

if [ "$status" -eq 0 ]; then
  echo "Skipped: documentation-only change on main (docs/, *.md); Production keeps the previous build."
  exit 0
fi

if [ "$status" -eq 1 ]; then
  echo "Build: non-documentation files changed."
  exit 1
fi

echo "Build: could not compare commits (git exit ${status}); building to be safe."
exit 1
