import { spawn } from "node:child_process";
import { cliCommandDocUrl, cliIndexUrl } from "../docs-urls";
import { defineCommand, getCommand } from "./registry";

function openUrl(url: string): void {
  const platform = process.platform;
  const opener = platform === "darwin" ? "open" : platform === "win32" ? "explorer" : "xdg-open";
  const child = spawn(opener, [url], { stdio: "ignore", detached: true });
  child.on("error", () => {
    // ignore — user can copy the URL manually
  });
  child.unref();
}

export const docsCommand = defineCommand({
  id: "docs",
  label: "docs",
  description: "Open the Kumiko docs (overall or per command) in your browser",
  help: [
    "Usage:",
    "  kumiko docs                 Open docs.kumiko.rocks/en/cli/",
    "  kumiko docs <command>       Open docs.kumiko.rocks/en/cli/commands/<command>/",
    "",
    "  --print                     Print the URL instead of opening it (CI / SSH friendly)",
  ].join("\n"),
  category: "help",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    const printOnly = ctx.argv.includes("--print");
    const positional = ctx.argv.filter((a) => !a.startsWith("--"));
    const target = positional[0];

    let url = cliIndexUrl();
    if (target) {
      const cmd = getCommand(target);
      if (!cmd) {
        ctx.out.err("");
        ctx.out.err(`  Unknown command: "${target}". Try: kumiko help`);
        ctx.out.err("");
        return 1;
      }
      url = cliCommandDocUrl(target);
    }

    if (printOnly) {
      ctx.out.log(url);
      return 0;
    }

    ctx.out.log("");
    ctx.out.log(`  Opening ${url}`);
    ctx.out.log("");
    openUrl(url);
    return 0;
  },
});
