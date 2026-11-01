import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "./scaffold-deploy.ts";

export const FRAMEWORK_AGENTS_IMPORT = "@node_modules/@cosmicdrift/kumiko-framework/AGENTS.md";

const SCRIPT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  dev: "run the app with demo data",
  boot: "boot validation without serving, needs no database",
  typecheck: "type-check",
  lint: "Biome check",
  test: "unit tests",
  "test:integration": "integration tests, need `docker compose up -d`",
  "test:real": "tests against real providers, local only",
  e2e: "browser tests, need `docker compose up -d`",
  "e2e:real": "browser tests against real providers, local only",
  "schema:generate": "new migration after an entity change or a newly mounted bundled feature",
  "schema:apply": "apply the checked-in migrations",
  build: "production build",
  start: "run the production build",
};

const DEMO_TASKS_FEATURE_LINE = "- `tasks` (demo — list + edit screens)";

const FOUNDATION_FEATURE_LINES = ["- `secrets` (foundation)", "- `sessions` (foundation)"];

export function renderMountedFeatureList(
  features: ReadonlyArray<{ readonly name: string }> | undefined,
  starter: "demo" | "blank" = "demo",
): string {
  const lines =
    features && features.length > 0
      ? features.map((f) => `- \`${f.name}\``)
      : FOUNDATION_FEATURE_LINES;
  return (starter === "demo" ? [...lines, DEMO_TASKS_FEATURE_LINE] : lines).join("\n");
}

function renderCommandList(scriptNames: readonly string[]): string {
  return scriptNames
    .map((name) => {
      const description = SCRIPT_DESCRIPTIONS[name];
      return description === undefined
        ? `- \`bun run ${name}\``
        : `- \`bun run ${name}\`: ${description}`;
    })
    .join("\n");
}

function agentsTemplatePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "AGENTS.app.md");
}

export type AgentsMdOptions = {
  readonly productName: string;
  readonly features: ReadonlyArray<{ readonly name: string }> | undefined;
  readonly scriptNames: readonly string[];
  readonly starter?: "demo" | "blank";
};

export function renderAgentsMd(options: AgentsMdOptions): string {
  return render(
    readFileSync(agentsTemplatePath(), "utf-8"),
    {
      productName: options.productName,
      featureList: renderMountedFeatureList(options.features, options.starter),
      commands: renderCommandList(options.scriptNames),
    },
    {},
  );
}

export function renderClaudeMd(): string {
  return `${FRAMEWORK_AGENTS_IMPORT}\n@AGENTS.md\n`;
}
