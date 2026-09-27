import { defineCommand } from "./registry";

export const initDeployCommand = defineCommand({
  id: "init-deploy",
  label: "init-deploy",
  description: "Scaffold deploy/{Dockerfile,Dockerfile.dockerignore,migrate-step.sh}",
  help: [
    "Usage: kumiko init-deploy --app <name> [--port <n>] [--github-org <org>] [--out <dir>] [--force | --check]",
    "",
    "Substitutes {{appName}}, {{port}}, {{githubOrg}} into the canonical",
    "deploy templates shipped with @cosmicdrift/kumiko-dev-server.",
    "",
    "Refuses to overwrite existing files unless --force is set — guards",
    "against clobbering a tuned Dockerfile.",
    "",
    "--check: reports drift against the current templates (exit 1 if any",
    "file is missing or differs) without writing anything; does not",
    "combine with --force.",
  ].join("\n"),
  category: "code",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    const { runInitDeployCli } = await import("@cosmicdrift/kumiko-dev-server");
    return runInitDeployCli({ argv: ctx.argv, cwd: ctx.cwd, out: ctx.out });
  },
});
