import { defineProbe } from "./registry";
import { run } from "./_lib";

export const gitStateProbe = defineProbe({
  id: "git-state",
  label: "Working Tree",
  roles: ["maintainer", "app-dev"],
  collect: async () => {
    const status = await run("git", ["status", "--porcelain"], { timeoutMs: 3000 });
    if (status.status !== 0) return { level: "warn", summary: "kein git" };

    const lines = status.stdout.split("\n").filter((l: string) => l.length > 0);
    const modified = lines.filter((l: string) => l.startsWith(" M") || l.startsWith("M")).length;
    const untracked = lines.filter((l: string) => l.startsWith("??")).length;

    const ahead = await run("git", ["rev-list", "--count", "@{u}..HEAD"], { timeoutMs: 2000 });
    const aheadCount = ahead.status === 0 ? Number.parseInt(ahead.stdout.trim(), 10) || 0 : 0;

    if (lines.length === 0 && aheadCount === 0) return { level: "ok", summary: "clean" };

    const parts: string[] = [];
    if (modified > 0) parts.push(`${modified}M`);
    if (untracked > 0) parts.push(`${untracked}??`);
    if (aheadCount > 0) parts.push(`↑${aheadCount}`);

    return {
      level: aheadCount > 5 || modified > 10 ? "action" : "warn",
      summary: parts.join(" "),
    };
  },
});
