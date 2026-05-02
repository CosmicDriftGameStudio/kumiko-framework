#!/usr/bin/env bash
# prod-version.sh — zeigt welche Version aktuell auf prod läuft.
#
# Drei Quellen:
#   1) OCI-Image-Label (org.opencontainers.image.revision) vom Master-
#      Node — das ist die SHA des Commits aus dem das Image gebaut wurde
#   2) Letzter erfolgreicher CI-Build (gh run list) — die SHA die
#      AKTUELL als :latest in GHCR sein SOLLTE
#   3) Diff zwischen beiden — wenn !=, ist der neuste Build noch nicht
#      ausgerollt (keel-Polling-Window oder Auto-Update broken)
#
# Voraussetzungen: ssh-key-Access zu root@10.10.0.1 (via Wireguard),
# gh-CLI authenticated, jq oder python3 für JSON-parse.

set -euo pipefail

APP="${1:-publicstatus}"
WORKFLOW="deploy-${APP}.yml"
MASTER_HOST="${MASTER_HOST:-root@10.10.0.1}"

# Farben (no-op wenn nicht-tty)
if [[ -t 1 ]]; then
  GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; DIM='\033[2m'; RESET='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; DIM=''; RESET=''
fi

# 1) Pod-Image-Reference (repo:tag) aus K8s
echo "${DIM}→ Reading running pod image…${RESET}"
IMAGE=$(kubectl --kubeconfig ~/.kube/kumiko.yaml get pods \
  -n "$APP" -l "app=$APP" \
  -o jsonpath='{.items[0].status.containerStatuses[0].image}' 2>/dev/null)
DIGEST=$(kubectl --kubeconfig ~/.kube/kumiko.yaml get pods \
  -n "$APP" -l "app=$APP" \
  -o jsonpath='{.items[0].status.containerStatuses[0].imageID}' 2>/dev/null | sed 's/.*@//')

if [[ -z "$IMAGE" ]]; then
  echo "${RED}✗ Kein Pod gefunden für app=$APP in namespace=$APP${RESET}" >&2
  exit 1
fi

# 2) OCI-Label aus dem Image — crictl auf master indexiert nach repo:tag,
#    nicht nach registry-digest. Wir nutzen das Image-Reference + parsen
#    das revision-Label aus dem Manifest.
echo "${DIM}→ Reading OCI revision-label via SSH master…${RESET}"
RUNNING_SHA=$(ssh -o ConnectTimeout=10 "$MASTER_HOST" \
  "crictl inspecti '$IMAGE' 2>/dev/null" \
  | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    labels = d.get('info', {}).get('imageSpec', {}).get('config', {}).get('Labels', {}) or {}
    print(labels.get('org.opencontainers.image.revision', ''))
except Exception:
    pass
")

# 3) Letzter erfolgreicher CI-Build — SHA aus gh, Subject aus git-log
echo "${DIM}→ Reading latest successful CI build…${RESET}"
LATEST_RAW=$(gh run list --workflow="$WORKFLOW" --status=success --limit=1 \
  --json headSha,createdAt 2>/dev/null \
  | python3 -c "
import json, sys
runs = json.load(sys.stdin)
if runs:
    r = runs[0]
    print(f\"{r['headSha']}|{r['createdAt']}\", end='')
")

LATEST_SHA="${LATEST_RAW%|*}"
LATEST_TIME="${LATEST_RAW#*|}"
# Commit-subject aus lokalem git lesen — sollte alle main-commits haben
if [[ -n "$LATEST_SHA" ]]; then
  LATEST_TITLE=$(git log --format=%s -n 1 "$LATEST_SHA" 2>/dev/null || echo "(commit nicht lokal — ggf. git fetch)")
else
  LATEST_TITLE=""
fi

# 4) Output
echo
echo "${DIM}════════════════════════════════════════${RESET}"
printf "  Running:    "
if [[ -z "$RUNNING_SHA" ]]; then
  echo "${YELLOW}? (kein Label)${RESET}"
else
  printf "%s  ${DIM}(${DIGEST:7:12}…)${RESET}\n" "${RUNNING_SHA:0:8}"
fi

printf "  Latest CI:  "
if [[ -z "$LATEST_SHA" ]]; then
  echo "${RED}kein erfolgreicher Run${RESET}"
else
  printf "%s  ${DIM}(${LATEST_TIME})${RESET}\n" "${LATEST_SHA:0:8}"
  echo "  Subject:    $LATEST_TITLE"
fi
echo "${DIM}════════════════════════════════════════${RESET}"

# Drift-Detection
if [[ -n "$RUNNING_SHA" && "$LATEST_SHA" != "NONE" ]]; then
  if [[ "${RUNNING_SHA:0:8}" == "${LATEST_SHA:0:8}" ]]; then
    echo "  ${GREEN}✓ Synced${RESET}"
  else
    echo "  ${YELLOW}⚠ Drift: prod ist hinter dem letzten Build${RESET}"
    echo "    ${DIM}https://github.com/CosmicDriftGameStudio/kumiko/compare/${RUNNING_SHA:0:8}...${LATEST_SHA:0:8}${RESET}"
    echo "    ${DIM}Manuell rollen: kubectl --kubeconfig ~/.kube/kumiko.yaml rollout restart deployment/$APP -n $APP${RESET}"
  fi
fi
echo
