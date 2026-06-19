#!/usr/bin/env bash
# Wrap a CI command with periodic memory snapshots (Linux /proc/meminfo + bun RSS).
# Logs are prefixed [kumiko-mem] so they are easy to grep in GitHub Actions output.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: ci-memlog-run.sh <command...>" >&2
  exit 2
fi

if [[ ! -r /proc/meminfo ]]; then
  echo "[kumiko-mem] /proc/meminfo unavailable — running command without sampling"
  exec "$@"
fi

LABEL="${KUMIKO_MEMLOG_LABEL:-ci}"
INTERVAL="${KUMIKO_MEMLOG_INTERVAL_SEC:-5}"
PEAK_FILE="$(mktemp)"
trap 'rm -f "$PEAK_FILE"' EXIT

mem_available_kb() {
  awk '/MemAvailable:/ { print $2 }' /proc/meminfo
}

bun_rss_kb() {
  ps -o rss= -C bun 2>/dev/null | awk '{ s += $1 } END { print s + 0 }'
}

log_snapshot() {
  local phase="$1"
  local avail_kb bun_rss_kb
  avail_kb="$(mem_available_kb)"
  bun_rss_kb="$(bun_rss_kb)"
  printf '[kumiko-mem] %-8s avail=%4sMiB bun_rss=%4sMiB %s\n' \
    "$phase" "$((avail_kb / 1024))" "$((bun_rss_kb / 1024))" "$(date -u +%H:%M:%SZ)"
}

init_avail="$(mem_available_kb)"
echo "0 ${init_avail}" >"$PEAK_FILE"

sampler() {
  while true; do
    local avail_kb bun_rss_kb max_bun min_avail
    avail_kb="$(mem_available_kb)"
    bun_rss_kb="$(bun_rss_kb)"
    read -r max_bun min_avail <"$PEAK_FILE"
    if ((bun_rss_kb > max_bun)); then max_bun=$bun_rss_kb; fi
    if ((avail_kb < min_avail)); then min_avail=$avail_kb; fi
    echo "${max_bun} ${min_avail}" >"$PEAK_FILE"
    log_snapshot "sample"
    sleep "$INTERVAL"
  done
}

echo "[kumiko-mem] === ${LABEL} start (interval=${INTERVAL}s) ==="
log_snapshot "start"

sampler &
SAMPLER_PID=$!

cleanup() {
  local code=$?
  kill "$SAMPLER_PID" 2>/dev/null || true
  wait "$SAMPLER_PID" 2>/dev/null || true
  local max_bun min_avail
  read -r max_bun min_avail <"$PEAK_FILE"
  log_snapshot "end"
  echo "[kumiko-mem] === ${LABEL} summary: min_avail=$((min_avail / 1024))MiB peak_bun_rss=$((max_bun / 1024))MiB exit=${code} ==="
  exit "$code"
}
trap cleanup EXIT

"$@"
