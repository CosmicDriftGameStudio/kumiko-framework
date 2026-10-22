#!/usr/bin/env bash
# Release-job guard: when HEAD is the merge of the changesets Version PR, refuse a stale one
# before anything is published. Version PRs land as a merge commit (subject "Merge pull request
# ... from .../changeset-release/main", second parent "chore: version packages") or, when
# squashed, as a commit whose own subject is "chore: version packages".
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
version_subject="chore: version packages"

is_version_merge() {
  if git rev-parse -q --verify HEAD^2 >/dev/null; then
    case "$(git log -1 --format=%s HEAD^2)" in "$version_subject"*) return 0 ;; esac
    case "$(git log -1 --format=%s)" in *changeset-release/main*) return 0 ;; esac
    return 1
  fi
  case "$(git log -1 --format=%s)" in "$version_subject"*) return 0 ;; esac
  return 1
}

if ! is_version_merge; then
  echo "HEAD is not a version commit, nothing to check"
  exit 0
fi

if ! reason="$(bash "$script_dir/verify-version-pr-fresh.sh" HEAD HEAD^1)"; then
  echo "::error::Stale Version PR merged: ${reason}"
  # Exiting here also skips changesets/action, so no fresh Version PR is opened
  # until the next push to main runs this job again.
  echo "::error::Nothing was published. Merge any commit to main; its release run opens a fresh Version PR that consumes the leftover changesets."
  exit 1
fi
