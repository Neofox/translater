#!/bin/sh
set -eu

project_root=$(cd "$(dirname "$0")/.." && pwd)
cd "$project_root"
tools_dir="$project_root/.vercel/tools"
mkdir -p "$tools_dir"

# Bootstrap a pinned mise without changing the build machine's global tools.
curl -fsSL https://mise.run -o "$tools_dir/install-mise.sh"
MISE_VERSION=2026.10.10 MISE_INSTALL_PATH="$tools_dir/mise" sh "$tools_dir/install-mise.sh"

"$tools_dir/mise" --locked exec -- aube install --frozen-lockfile
