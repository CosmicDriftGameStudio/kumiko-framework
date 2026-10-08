#!/usr/bin/env bash
# Starts the Kumiko CI services requested via INPUT_* env (set by action.yml).
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
action_dir="${ACTION_DIR:-$script_dir}"

fail() {
  echo "::error::$1"
  exit 1
}

require_bool() {
  [[ ${2:-} =~ ^(true|false)$ ]] || fail "input $1 must be 'true' or 'false', got '${2:-}'"
}

require_port_or_empty() {
  [ -z "${2:-}" ] && return 0
  [[ $2 =~ ^[0-9]{1,5}$ ]] && [ "$2" -ge 1 ] && [ "$2" -le 65535 ] || fail "input $1 must be empty or a port in 1..65535, got '$2'"
}

require_bool postgres "${INPUT_POSTGRES:-}"
require_bool redis "${INPUT_REDIS:-}"
require_bool meilisearch "${INPUT_MEILISEARCH:-}"
require_bool object-storage "${INPUT_OBJECT_STORAGE:-}"
require_port_or_empty postgres-port "${INPUT_POSTGRES_PORT:-}"
require_port_or_empty redis-port "${INPUT_REDIS_PORT:-}"
require_port_or_empty meilisearch-port "${INPUT_MEILISEARCH_PORT:-}"
require_port_or_empty object-storage-port "${INPUT_OBJECT_STORAGE_PORT:-}"
: "${MIRROR_PREFIX:?MIRROR_PREFIX is required}"
: "${GITHUB_ENV:?}" "${GITHUB_OUTPUT:?}"

# Captured first: a failure inside a process substitution would not stop the script.
pins=$(bash "$script_dir/read-pins.sh" "$action_dir/service-images.txt")
declare -A pin_repo pin_digest
while read -r key repo _tag digest; do
  pin_repo[$key]=$repo
  pin_digest[$key]=$digest
done <<<"$pins"

# Prints the pulled reference. One mirror attempt only, so runs without a mirror do not wait.
pull_image() {
  local key=$1 digest mirror_ref upstream_ref delay=5 attempt
  digest=${pin_digest[$key]:?no pin for $key}
  mirror_ref="$MIRROR_PREFIX/$key@$digest"
  if docker pull --quiet "$mirror_ref" >/dev/null 2>&1; then
    echo "$mirror_ref"
    return 0
  fi
  echo "::warning::mirror pull of $key failed ($mirror_ref: not published, not public, or registry unreachable), falling back to upstream" >&2
  upstream_ref="${pin_repo[$key]}@$digest"
  for attempt in 1 2 3 4; do
    if docker pull --quiet "$upstream_ref" >/dev/null 2>&1; then
      echo "$upstream_ref"
      return 0
    fi
    if [ "$attempt" -lt 4 ]; then
      sleep "$delay"
      delay=$((delay * 2))
    fi
  done
  echo "::error::could not pull $key from mirror or upstream ($upstream_ref)" >&2
  exit 1
}

run_label="${GITHUB_RUN_ID:-0}-${GITHUB_RUN_ATTEMPT:-0}-${GITHUB_JOB:-local}"
run_label="${run_label//[^A-Za-z0-9_.-]/_}"
suffix="${run_label}-$(date +%s%N)"
suffix="${suffix//[^A-Za-z0-9_.-]/_}"

# host:container publish flag; an empty host port lets docker pick a random one
publish_arg() {
  if [ -n "$1" ]; then echo "$1:$2"; else echo "$2"; fi
}

published_port() {
  docker port "$1" "$2/tcp" | head -n1 | awk -F: '{print $NF}'
}

runner_broken() {
  echo "::error title=Runner infrastructure::$1 on 127.0.0.1:$2 is not reachable from runner ${RUNNER_NAME:-unknown}, although its container is healthy. Runner infrastructure (infra#866), not a test failure."
  exit 1
}

# Each probe runs in its own bash with the port as $1; timeout because `read -t` does not bound the TCP connect.
probe_postgres() {
  # SSLRequest (length 8, code 80877103): any live server answers one byte, N or S.
  timeout 5 bash -s "$1" 2>/dev/null <<'PROBE'
exec 3<>"/dev/tcp/127.0.0.1/$1" && printf "\000\000\000\010\004\322\026\057" >&3 && read -r -t 3 -n 1 reply <&3 && { [ "$reply" = N ] || [ "$reply" = S ]; }
PROBE
}

probe_redis() {
  timeout 5 bash -s "$1" 2>/dev/null <<'PROBE'
exec 3<>"/dev/tcp/127.0.0.1/$1" && printf "PING\r\n" >&3 && read -r -t 3 reply <&3 && [ "$(printf %s "$reply" | tr -d "\r")" = "+PONG" ]
PROBE
}

probe_object_storage() {
  timeout 5 bash -s "$1" 2>/dev/null <<'PROBE'
exec 3<>"/dev/tcp/127.0.0.1/$1" && printf "GET /minio/health/live HTTP/1.0\r\n\r\n" >&3 && read -r -t 3 status <&3 && case "$status" in *" 200"*) ;; *) exit 1 ;; esac
PROBE
}

run_label_args=(--label "kumiko-ci.run=$run_label")
pg_port="" redis_port="" meili_port="" minio_port=""
env_lines=()

if [ "${INPUT_POSTGRES}" = true ]; then
  image=$(pull_image postgres)
  pg_container="kumiko-ci-pg-$suffix"
  # Throwaway credentials, plain text on purpose: same values as docker-compose and the test defaults.
  # fsync/synchronous_commit/full_page_writes off: the container is ephemeral, and with durability on
  # DROP DATABASE forces a synchronous checkpoint that stalls test cleanup for seconds.
  # checkpoint_timeout keeps time-triggered checkpoints out of measured runs.
  docker run -d --name "$pg_container" "${run_label_args[@]}" -p "$(publish_arg "${INPUT_POSTGRES_PORT}" 5432)" \
    -e POSTGRES_USER=kumiko -e POSTGRES_PASSWORD=kumiko -e POSTGRES_DB=kumiko_dev \
    --health-cmd="pg_isready -U kumiko -d kumiko_dev -h 127.0.0.1" \
    --health-interval=2s --health-timeout=3s --health-retries=30 \
    "$image" \
    -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c checkpoint_timeout=1h >/dev/null
  pg_port=$(published_port "$pg_container" 5432)
  for _ in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$pg_container" 2>/dev/null)" = healthy ] && break
    sleep 2
  done
  if [ "$(docker inspect -f '{{.State.Health.Status}}' "$pg_container")" != healthy ]; then
    docker logs "$pg_container"
    exit 1
  fi
  if ! create_out=$(docker exec "$pg_container" psql -v ON_ERROR_STOP=1 -U kumiko -d kumiko_dev -c "CREATE DATABASE kumiko_test;" 2>&1); then
    case "$create_out" in
      *"already exists"*) ;;
      *)
        echo "$create_out"
        docker logs "$pg_container"
        exit 1
        ;;
    esac
  fi
  probe_postgres "$pg_port" || runner_broken postgres "$pg_port"
  env_lines+=("PG_CONTAINER=$pg_container"
    "DATABASE_URL=postgresql://kumiko:kumiko@localhost:$pg_port/kumiko_dev"
    "TEST_DATABASE_URL=postgresql://kumiko:kumiko@localhost:$pg_port/kumiko_test")
fi

if [ "${INPUT_REDIS}" = true ]; then
  image=$(pull_image redis)
  redis_container="kumiko-ci-redis-$suffix"
  docker run -d --name "$redis_container" "${run_label_args[@]}" -p "$(publish_arg "${INPUT_REDIS_PORT}" 6379)" "$image" >/dev/null
  redis_port=$(published_port "$redis_container" 6379)
  for _ in $(seq 1 30); do
    docker exec "$redis_container" redis-cli ping >/dev/null 2>&1 && break
    sleep 2
  done
  docker exec "$redis_container" redis-cli ping
  probe_redis "$redis_port" || runner_broken redis "$redis_port"
  env_lines+=("REDIS_CONTAINER=$redis_container" "REDIS_URL=redis://localhost:$redis_port")
fi

if [ "${INPUT_MEILISEARCH}" = true ]; then
  image=$(pull_image meilisearch)
  meili_container="kumiko-ci-meili-$suffix"
  docker run -d --name "$meili_container" "${run_label_args[@]}" -p "$(publish_arg "${INPUT_MEILISEARCH_PORT}" 7700)" \
    -e MEILI_MASTER_KEY=kumiko-dev-key -e MEILI_ENV=development \
    "$image" >/dev/null
  meili_port=$(published_port "$meili_container" 7700)
  meili_ready=false
  for _ in $(seq 1 60); do
    curl -fsS "http://127.0.0.1:${meili_port}/health" >/dev/null 2>&1 && meili_ready=true && break
    sleep 2
  done
  if [ "$meili_ready" != true ]; then
    docker logs "$meili_container"
    echo "::error title=Runner infrastructure::meilisearch on 127.0.0.1:${meili_port} did not answer /health from runner ${RUNNER_NAME:-unknown} within 120s. If the container log shows it listening, this is runner infrastructure (infra#866), not a test failure."
    exit 1
  fi
  env_lines+=("MEILI_CONTAINER=$meili_container" "MEILI_PORT=$meili_port"
    "MEILI_URL=http://localhost:$meili_port" "MEILI_MASTER_KEY=kumiko-dev-key")
fi

if [ "${INPUT_OBJECT_STORAGE}" = true ]; then
  image=$(pull_image rustfs)
  aws_image=$(pull_image aws-cli)
  minio_container="kumiko-ci-minio-$suffix"
  docker run -d --name "$minio_container" "${run_label_args[@]}" -p "$(publish_arg "${INPUT_OBJECT_STORAGE_PORT}" 9000)" \
    -e RUSTFS_ACCESS_KEY=kumiko -e RUSTFS_SECRET_KEY=kumiko-dev-secret \
    "$image" /data >/dev/null
  minio_port=$(published_port "$minio_container" 9000)
  # aws-cli joins the storage container's network namespace, so no shared docker network is needed.
  aws_ci() {
    docker run --rm --network "container:$minio_container" \
      -e AWS_ACCESS_KEY_ID=kumiko -e AWS_SECRET_ACCESS_KEY=kumiko-dev-secret -e AWS_DEFAULT_REGION=us-east-1 \
      "$aws_image" --endpoint-url http://127.0.0.1:9000 "$@"
  }
  bucket_created=false
  for _ in $(seq 1 30); do
    aws_ci s3 mb s3://kumiko-dev >/dev/null 2>&1 && bucket_created=true && break
    sleep 2
  done
  if [ "$bucket_created" != true ]; then
    docker logs "$minio_container"
    exit 1
  fi
  aws_ci s3 ls s3://kumiko-dev
  # The bucket call ran inside the container's namespace; tests connect over the published port.
  probe_object_storage "$minio_port" || runner_broken "object storage" "$minio_port"
  env_lines+=("MINIO_CONTAINER=$minio_container" "MINIO_ENDPOINT=http://localhost:$minio_port"
    "MINIO_REGION=us-east-1" "MINIO_BUCKET=kumiko-dev" "MINIO_ACCESS_KEY=kumiko" "MINIO_SECRET_KEY=kumiko-dev-secret")
fi

[ "${#env_lines[@]}" -eq 0 ] || printf '%s\n' "${env_lines[@]}" >>"$GITHUB_ENV"

url_or_empty() {
  if [ -n "$2" ]; then echo "$1$2$3"; fi
}
{
  echo "postgres-port=$pg_port"
  echo "redis-port=$redis_port"
  echo "meilisearch-port=$meili_port"
  echo "object-storage-port=$minio_port"
  echo "database-url=$(url_or_empty postgresql://kumiko:kumiko@localhost: "$pg_port" /kumiko_dev)"
  echo "test-database-url=$(url_or_empty postgresql://kumiko:kumiko@localhost: "$pg_port" /kumiko_test)"
  echo "redis-url=$(url_or_empty redis://localhost: "$redis_port" "")"
  echo "meili-url=$(url_or_empty http://localhost: "$meili_port" "")"
  echo "object-storage-endpoint=$(url_or_empty http://localhost: "$minio_port" "")"
} >>"$GITHUB_OUTPUT"

echo "kumiko-services up: postgres=${pg_port:--} redis=${redis_port:--} meilisearch=${meili_port:--} object-storage=${minio_port:--} run=$run_label"
