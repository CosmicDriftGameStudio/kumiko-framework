#!/bin/sh
# Wrap a CI command with periodic memory snapshots (Linux /proc).
# POSIX sh — the build container has no bash and procps `ps -C` is unavailable.
set -eu

if [ "$#" -lt 1 ]; then
  echo "usage: ci-memlog-run.sh <command...>" >&2
  exit 2
fi

if [ ! -r /proc/meminfo ]; then
  echo "[kumiko-mem] /proc/meminfo unavailable — running command without sampling"
  exec "$@"
fi

LABEL="${KUMIKO_MEMLOG_LABEL:-ci}"
INTERVAL="${KUMIKO_MEMLOG_INTERVAL_SEC:-5}"
PEAK_FILE="$(mktemp)"

mem_available_kb() {
  awk '/MemAvailable:/ { print $2 }' /proc/meminfo
}

mem_used_kb() {
  awk '/MemTotal:|MemAvailable:/ {
    if ($1 == "MemTotal:") total = $2
    if ($1 == "MemAvailable:") avail = $2
  } END { print total - avail }' /proc/meminfo
}

# Sum VmRSS for kumiko-check toolchain processes via /proc (portable).
check_rss_kb() {
  total=0
  for status in /proc/[0-9]*/status; do
    [ -r "$status" ] || continue
    name=$(awk '/^Name:/ { print $2; exit }' "$status")
    case $name in
      bun | node | biome | tsc | esbuild)
        rss=$(awk '/^VmRSS:/ { print $2; exit }' "$status")
        total=$((total + ${rss:-0}))
        ;;
    esac
  done
  echo "$total"
}

log_snapshot() {
  phase="$1"
  used_kb="$(mem_used_kb)"
  check_kb="$(check_rss_kb)"
  avail_kb="$(mem_available_kb)"
  printf '[kumiko-mem] %-8s used=%4sMiB check_rss=%4sMiB avail=%4sMiB %s\n' \
    "$phase" \
    "$((used_kb / 1024))" \
    "$((check_kb / 1024))" \
    "$((avail_kb / 1024))" \
    "$(date -u +%H:%M:%SZ)"
}

init_avail="$(mem_available_kb)"
init_used="$(mem_used_kb)"
echo "0 0 ${init_avail}" >"$PEAK_FILE"

sampler() {
  while true; do
    used_kb="$(mem_used_kb)"
    check_kb="$(check_rss_kb)"
    avail_kb="$(mem_available_kb)"
    read -r max_check max_used min_avail <"$PEAK_FILE"
    if [ "$check_kb" -gt "$max_check" ]; then
      max_check=$check_kb
    fi
    if [ "$used_kb" -gt "$max_used" ]; then
      max_used=$used_kb
    fi
    if [ "$avail_kb" -lt "$min_avail" ]; then
      min_avail=$avail_kb
    fi
    echo "${max_check} ${max_used} ${min_avail}" >"$PEAK_FILE"
    log_snapshot "sample"
    sleep "$INTERVAL"
  done
}

echo "[kumiko-mem] === ${LABEL} start (interval=${INTERVAL}s) ==="
log_snapshot "start"

sampler &
SAMPLER_PID=$!

cleanup() {
  code=$?
  kill "$SAMPLER_PID" 2>/dev/null || true
  wait "$SAMPLER_PID" 2>/dev/null || true
  read -r max_check max_used min_avail <"$PEAK_FILE"
  log_snapshot "end"
  echo "[kumiko-mem] === ${LABEL} summary: peak_used=$((max_used / 1024))MiB peak_check_rss=$((max_check / 1024))MiB min_avail=$((min_avail / 1024))MiB exit=${code} ==="
  exit "$code"
}
trap cleanup EXIT

"$@"
