#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <base-branch> <head-branch>" >&2
  exit 2
fi

base=$1
head=$2
version_branch='^v[0-9]+\.[0-9]{2}$'

if [[ "$base" == "main" ]]; then
  [[ "$head" =~ $version_branch ]] || {
    echo "main only accepts version branches (vX.XX)." >&2
    exit 1
  }
elif [[ "$base" =~ $version_branch ]]; then
  [[ "$head" != "main" && ! "$head" =~ $version_branch ]] || {
    echo "Version branches accept temporary development branches." >&2
    exit 1
  }
else
  echo "Unsupported PR base: $base" >&2
  exit 1
fi

echo "Allowed branch flow: $head -> $base"
