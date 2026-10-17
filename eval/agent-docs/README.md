# Agent docs eval

Checks whether a coding agent that knows nothing about Kumiko can build
features in a fresh app using only the docs that ship with the npm packages
(`AGENTS.md` and `agents/` in `@cosmicdrift/kumiko-framework`). It is a manual
run, not a CI job.

Nothing here is published: the folder is outside every workspace package, and
biome, `kumiko.json` and the test globs do not reach it. Keep it out of
`samples/`; agents read samples through `agents/examples/`.

| Path | Content |
| --- | --- |
| `tasks/*.md` | One task each: the text the agent gets, what it measures, the acceptance criteria |
| `acceptance/*.integration.test.ts.tmpl` | Hidden acceptance test per task, copied into the project only for grading |
| `scripts/prepare-project.sh` | Scaffolds one fresh app from npm and commits it as `eval-baseline` |
| `scripts/check-project.sh` | Copies the acceptance test in, runs all checks, scans the agent's diff |

## Prerequisites

- `bun`, `git`, `openssl`, `perl`, Docker.
- An eval root outside this repo and outside any directory that holds a
  `package.json` or `bun.lock`. `prepare-project.sh` refuses otherwise,
  because bun would resolve workspace links instead of the npm tarball.
- The framework version under test is published on npm, including
  `create-kumiko-app`.

## Run

Set the variables once. `EVAL_REPO` is this repo checkout, `EVAL_ROOT` the
empty eval root.

```sh
EVAL_REPO=/path/to/kumiko-framework
EVAL_ROOT=/path/outside/any/workspace/agent-eval
VERSION=0.364.0
```

1. Prepare one project per task. Each one is a fresh scaffold; never reuse a
   project for a second task.

   ```sh
   for task in 01-entity-crud 02-custom-handlers 03-overview-screen 04-bundled-tags; do
     "$EVAL_REPO/eval/agent-docs/scripts/prepare-project.sh" "$EVAL_ROOT" "eval-$task" "$VERSION"
   done
   ```

   The script deviates from a raw scaffold in four places, all
   because of the environment, not to help the agent: dependency ranges are
   pinned to `VERSION`, a `.gitignore` is added (the scaffold writes none and
   `bun run lint` fails without it), biome's config and formatting are
   migrated to the installed biome so lint starts green, and `.env` gets a
   random local master key.

2. Start Postgres and Redis once for all projects, from any prepared project,
   under a fixed compose project name so the ports are not claimed twice:

   ```sh
   (cd "$EVAL_ROOT/eval-01-entity-crud" && docker compose -p agent-eval up -d)
   ```

3. Run one fresh agent per project with the prompt below (variants below).

4. Grade each project after its agent has finished. Do not trust the agent's
   own report.

   ```sh
   "$EVAL_REPO/eval/agent-docs/scripts/check-project.sh" \
     "$EVAL_ROOT/eval-01-entity-crud" 01-entity-crud "$EVAL_ROOT/logs/01-entity-crud"
   ```

   It prints `PASS`/`FAIL` for typecheck, lint, unit tests, boot validation,
   `kumiko-schema validate`, integration tests (the agent's plus the
   acceptance test), `kumiko-guards guards` and `kumiko-guards ui`, then
   hit counts of a pattern scan over the agent's added lines (`any`,
   `createTestDispatcher`, raw SQL writes, inline styles, `fetch`). Read every
   hit in `logs/<task>/agent.diff` before calling it a rule break, and go
   through the "Review by hand" list of the task.

5. Record the result as a table: task, passed yes/no, failed checks, rule
   breaks, docs the agent read, information it missed. A task passes when
   every check is green and the review finds no rule break.

## Agent prompt

Send the environment note, then the task text from `tasks/<task>.md`, then
the rules. Replace `<project>` with the absolute project path. Add nothing
else: no hints about Kumiko internals, no solution, no link to framework
sources.

```text
Environment: <project> is a freshly scaffolded Kumiko app. Dependencies are
installed, .env exists, and Postgres and Redis already run on the default
local ports. Do not start or stop containers.

<task text>

Rules: Work only in <project>. Read only files in this project and in its
node_modules. Read nothing outside it, use no skills, no memory files and no
web search. Use the project's AGENTS.md / CLAUDE.md and the package docs as
your source. When you are done, report in at most 15 lines what you built,
which doc files you read, and where information was missing.
```

## Variant A: isolated CLI run

The run the eval is designed for. Start Claude Code in the project directory
with an empty configuration directory, so no user-wide `CLAUDE.md`, skills,
memory, hooks or MCP servers leak in. The project's own `CLAUDE.md` imports
the package `AGENTS.md`, which is exactly the context under test.

```sh
cd "$EVAL_ROOT/eval-01-entity-crud"
CLAUDE_CONFIG_DIR="$(mktemp -d)" claude
```

Log in inside that session, paste the prompt, and let it run to the end.
Because the eval root is outside every workspace, no parent `CLAUDE.md` is
picked up.

## Variant B: subagents

Faster to run from an existing Claude Code session: one fresh subagent per
project (`subagent_type: "general-purpose"`, one model for all tasks), each
with the prompt above. Results from this variant need these caveats:

- The subagent inherits the parent session's user-wide and workspace
  `CLAUDE.md` and memory index. If those state the same rules the review
  checks (no `any`, no `createTestDispatcher`, no direct event-store writes),
  a clean rule-break column does not prove the package docs taught them. Only
  "docs read" and "information missing" isolate the package docs.
- It inherits the parent's tool policy and hooks, for example a shell
  allowlist or a hook that blocks reading `.env`.
- Its working directory starts in the parent's repo, not in the project. The
  prompt's rules are the only fence, so check its report for paths outside
  the project.
