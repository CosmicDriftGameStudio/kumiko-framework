import { defineProbe } from "./registry";
import { run } from "./_lib";

const REQUIRED = ["postgres", "redis"] as const;

export const dockerProbe = defineProbe({
  id: "docker-services",
  label: "Docker",
  roles: ["maintainer", "app-dev"],
  collect: async () => {
    const r = await run(
      "docker",
      ["ps", "--filter", "status=running", "--format", "{{.Names}}\t{{.Image}}"],
      { timeoutMs: 3000 },
    );
    if (r.status !== 0) {
      return { level: "warn", summary: "docker?", detail: r.stderr.trim() };
    }
    const names = r.stdout
      .split("\n")
      .map((l: string) => l.split("\t")[0] ?? "")
      .filter(Boolean);
    const missing = REQUIRED.filter((req) => !names.some((n: string) => n.includes(req)));
    if (missing.length === 0) return { level: "ok", summary: `${REQUIRED.length}/${REQUIRED.length} up` };
    return { level: "action", summary: `${missing.join("+")} down` };
  },
});
