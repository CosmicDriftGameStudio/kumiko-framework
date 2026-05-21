import { spawn } from "node:child_process";
import { defineCommand, getCommand } from "./registry";

const DOCS_BASE = "https://docs.kumiko.so";
const CLI_BASE = `${DOCS_BASE}/cli`;

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
  help: "Usage:\n  kumiko docs                 Open docs.kumiko.so/cli/\n  kumiko docs <command>       Open docs.kumiko.so/cli/<command>/\n\n  --print                     Print the URL instead of opening it (CI / SSH friendly)",
  category: "help",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    const printOnly = ctx.argv.includes("--print");
    const positional = ctx.argv.filter((a) => !a.startsWith("--"));
    const target = positional[0];

    let url = CLI_BASE + "/";
    if (target) {
      const cmd = getCommand(target);
      if (!cmd) {
        ctx.out.err("");
        ctx.out.err(`  Unknown command: "${target}". Try: kumiko help`);
        ctx.out.err("");
        return 1;
      }
      const slug = target.replace(/:/g, "-");
      url = `${CLI_BASE}/${slug}/`;
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
