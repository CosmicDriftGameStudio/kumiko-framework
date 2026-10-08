#!/usr/bin/env bash
# Prints validated pins as "<key> <repo-without-tag> <tag> <digest>", one per line.
set -euo pipefail

pins_file="${1:-$(dirname "${BASH_SOURCE[0]}")/service-images.txt}"
key_pattern='^[a-z0-9-]+$'
ref_pattern='^[a-z0-9.-]+(/[a-z0-9._-]+)+:[A-Za-z0-9._-]+$'
digest_pattern='^sha256:[0-9a-f]{64}$'

while read -r key ref digest extra || [ -n "${key:-}" ]; do
  case "${key:-}" in '' | '#'*) continue ;; esac
  if [ -n "${extra:-}" ] || ! [[ $key =~ $key_pattern ]] || ! [[ ${ref:-} =~ $ref_pattern ]] || ! [[ ${digest:-} =~ $digest_pattern ]]; then
    echo "::error::invalid line in $pins_file: ${key:-} ${ref:-} ${digest:-}" >&2
    exit 1
  fi
  echo "$key ${ref%:*} ${ref##*:} $digest"
done <"$pins_file"
