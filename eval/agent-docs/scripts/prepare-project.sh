#!/usr/bin/env bash
# Scaffolds one fresh, published Kumiko app for a single eval task and commits
# it as the `eval-baseline` tag, so the checks and the rule scan see exactly
# what the agent changed.
#
# Usage: prepare-project.sh <eval-root> <project-name> <version>
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: prepare-project.sh <eval-root> <project-name> <version>" >&2
  exit 2
fi

eval_root="$1"
project_name="$2"
version="$3"

if ! [[ "$project_name" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "project name must be kebab-case: $project_name" >&2
  exit 2
fi
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "version must be an exact x.y.z release: $version" >&2
  exit 2
fi

eval_root="$(cd "$eval_root" && pwd -P)"

# A package.json or bun.lock above the project would let bun resolve a
# workspace link instead of the npm tarball the eval is meant to measure.
dir="$eval_root"
while [ "$dir" != "/" ]; do
  if [ -e "$dir/package.json" ] || [ -e "$dir/bun.lock" ]; then
    echo "refusing: $dir holds a package.json or bun.lock; pick an eval root outside any JS workspace" >&2
    exit 1
  fi
  dir="$(dirname "$dir")"
done

project_dir="$eval_root/$project_name"
if [ -e "$project_dir" ]; then
  echo "refusing: $project_dir already exists" >&2
  exit 1
fi

cd "$eval_root"
bunx "create-kumiko-app@$version" "$project_name" --yes
cd "$project_dir"

# The scaffold writes caret ranges; pin them so a release published mid-run
# cannot slip into some projects and not others.
VERSION="$version" perl -pi -e 's/"\^\Q$ENV{VERSION}\E"/"$ENV{VERSION}"/g' package.json
bun install

framework_dir="node_modules/@cosmicdrift/kumiko-framework"
if [ -L "$framework_dir" ]; then
  echo "refusing: $framework_dir is a symlink, not the npm package" >&2
  exit 1
fi
installed_version="$(bun -e 'console.log(require(process.argv[1]).version)' "$PWD/$framework_dir/package.json")"
if [ "$installed_version" != "$version" ]; then
  echo "refusing: installed framework is $installed_version, expected $version" >&2
  exit 1
fi

# Versions up to 0.364.0 write no .gitignore, and biome.json's vcs.useIgnoreFile
# makes `bun run lint` fail without one.
[ -e .gitignore ] || cat >.gitignore <<'GITIGNORE'
node_modules/
dist/
dist-server/
.env
.kumiko/
test-results/
playwright-report/
GITIGNORE

# Versions up to 0.364.0: the scaffolded biome range resolves to a newer biome than the scaffolded
# files were formatted with; bring the baseline to green before the agent starts.
./node_modules/.bin/biome migrate --write
./node_modules/.bin/biome check --write .

cp .env.example .env
master_key="$(openssl rand -base64 32)"
MASTER_KEY="$master_key" perl -pi -e 's/^KUMIKO_SECRETS_MASTER_KEY_V1=.*$/KUMIKO_SECRETS_MASTER_KEY_V1=$ENV{MASTER_KEY}/' .env
unset master_key
# Only versions above 0.364.0 declare DEMO_ADMIN_PASSWORD (prod admin seed).
if grep -q '^DEMO_ADMIN_PASSWORD=' .env; then
  admin_password="$(openssl rand -hex 24)"
  ADMIN_PASSWORD="$admin_password" perl -pi -e 's/^DEMO_ADMIN_PASSWORD=.*$/DEMO_ADMIN_PASSWORD=$ENV{ADMIN_PASSWORD}/' .env
  unset admin_password
fi

git init -q
git add -A
git -c user.name=agent-eval -c user.email=agent-eval@localhost commit -qm "eval baseline"
git tag eval-baseline

echo "prepared $project_dir (framework $installed_version)"
