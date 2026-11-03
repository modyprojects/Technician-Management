#!/usr/bin/env bash
# Installs the pinned Supabase CLI (Linux x86-64) into the given directory after verifying
# the release checksum. Used by CI; the owner does not need a local installation.
# To upgrade: pick a release at least 7 days old (same cooldown as .npmrc), take the
# sha256 of supabase_<version>_linux_amd64.tar.gz from that release's checksums.txt,
# update both values below and record the change in docs/WORKLOG.md.
set -euo pipefail

VERSION="2.122.0"
SHA256="59ed066847b98d7461c60e9109d40cab6b9756177ce06ebb05b51338519f5136"

dest="${1:?usage: install-supabase-cli.sh <destination directory>}"
mkdir -p "$dest"
tarball="$dest/supabase_${VERSION}_linux_amd64.tar.gz"

curl -sSfL -o "$tarball" \
  "https://github.com/supabase/cli/releases/download/v${VERSION}/supabase_${VERSION}_linux_amd64.tar.gz"
echo "${SHA256}  ${tarball}" | sha256sum -c -
tar -xzf "$tarball" -C "$dest" supabase
rm -f "$tarball"
"$dest/supabase" --version
