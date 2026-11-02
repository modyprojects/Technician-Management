#!/usr/bin/env bash
# Local secret scan before every push (docs/security.md, owner answer 6A).
# Same pinned Gitleaks release and SHA-256 as .github/workflows/ci.yml; values are redacted.
set -euo pipefail

VERSION="8.30.1"
SHA256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -sSfL -o "$TMP/gitleaks.tar.gz" \
  "https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_linux_x64.tar.gz"
echo "${SHA256}  $TMP/gitleaks.tar.gz" | sha256sum -c -
tar -xzf "$TMP/gitleaks.tar.gz" -C "$TMP" gitleaks

# Full history (all refs) plus the files that would be published but are not committed yet.
"$TMP/gitleaks" git --redact --no-banner --exit-code 1 .
mkdir -p "$TMP/worktree"
git ls-files -co --exclude-standard -z | xargs -0 -I{} cp --parents {} "$TMP/worktree/"
"$TMP/gitleaks" dir --redact --no-banner --exit-code 1 "$TMP/worktree"
