import { defineProbe } from "./registry";
import { run } from "./_lib";

export const staleBranchesProbe = defineProbe({
  id: "stale-branches",
  label: "Stale Branches",
  roles: ["maintainer"],
  collect: async () => {
    const r = await run(
      "git",
      ["branch", "--merged", "origin/main", "--format=%(refname:short)"],
      { timeoutMs: 3000 },
    );
    if (r.status !== 0) return { level: "warn", summary: "kein git" };
    const branches = r.stdout
      .split("\n")
      .map((b: string) => b.trim())
      .filter((b: string) => b.length > 0 && b !== "main" && b !== "master");
    if (branches.length === 0) return { level: "ok", summary: "clean" };
    if (branches.length <= 2) return { level: "warn", summary: `${branches.length} stale` };
    return { level: "action", summary: `${branches.length} stale` };
  },
});
