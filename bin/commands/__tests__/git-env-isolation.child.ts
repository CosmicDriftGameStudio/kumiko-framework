// Runs inside a child process whose OS environment carries a hostile git location, the way a
// git hook's does. Prints the observed state as JSON for git-env-isolation.test.ts.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanGitEnv, runGit } from "../../_git-test-helpers";
import { run } from "../_spawn";

const victim = process.argv[2] ?? "";

function commitCount(dir: string): number {
  const result = spawnSync("git", ["-C", dir, "rev-list", "--count", "HEAD"], {
    env: cleanGitEnv(),
    encoding: "utf-8",
  });
  return Number.parseInt(result.stdout.trim(), 10);
}

const victimBefore = commitCount(victim);
const work = mkdtempSync(join(tmpdir(), "kumiko-work-"));
runGit(["init", "-b", "main"], work);
runGit(["config", "user.email", "test@test"], work);
runGit(["config", "user.name", "Test"], work);
runGit(["commit", "--allow-empty", "-m", "init"], work);
writeFileSync(join(work, "file.txt"), "hello");
const status = await run("git", ["status", "--short"], { cwd: work });

console.log(
  JSON.stringify({
    victimBefore,
    victimAfter: commitCount(victim),
    workCommits: commitCount(work),
    status: status.stdout.trim(),
  }),
);
