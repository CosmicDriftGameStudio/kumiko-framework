// The committed api-docs/ is the golden of what `kumiko api-docs` generates for this app.
// Regenerate it with KUMIKO_UPDATE_API_DOCS_GOLDEN=1 after changing the feature, the
// translations, the config or the recordings in api-examples/.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  ApiExampleFileSchema,
  diffApiDocsOutput,
  generateApiDocs,
  type NamedApiExample,
  type NamedWebhookExample,
  WebhookExampleFileSchema,
} from "@cosmicdrift/kumiko-bundled-features/agent-tools";
import { allAppFeatures } from "@cosmicdrift/kumiko-framework/config";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime";
import { z } from "zod";
import config from "../../kumiko.config";

const ROOT = join(import.meta.dir, "../..");
const GOLDEN_DIR = join(ROOT, "api-docs");
const EXAMPLES_DIR = join(ROOT, "api-examples");
const UPDATE_FLAG = "KUMIKO_UPDATE_API_DOCS_GOLDEN";

const PackageNameSchema = z.object({ name: z.string() });

function readExamples(): NamedApiExample[] {
  return readdirSync(EXAMPLES_DIR)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName) => ({
      fileName,
      file: ApiExampleFileSchema.parse(
        JSON.parse(readFileSync(join(EXAMPLES_DIR, fileName), "utf8")),
      ),
    }));
}

function readWebhookExamples(): NamedWebhookExample[] {
  const dir = join(EXAMPLES_DIR, "webhooks");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName) => ({
      fileName,
      file: WebhookExampleFileSchema.parse(JSON.parse(readFileSync(join(dir, fileName), "utf8"))),
    }));
}

function readGolden(dir: string): Map<string, string> {
  if (!existsSync(dir)) return new Map();
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) =>
    entry.isFile(),
  );
  return new Map(
    files.map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return [relative(dir, path).split("\\").join("/"), readFileSync(path, "utf8")];
    }),
  );
}

describe("api-docs golden", () => {
  const appName = PackageNameSchema.parse(
    JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")),
  ).name;
  const generated = generateApiDocs({
    registry: createRegistry(
      composeFeatures(allAppFeatures(config), { includeBundled: config.includeBundled === true }),
    ),
    config: {
      ...config.apiDocs,
      locales: config.apiDocs?.locales ?? ["en"],
      baseUrl: config.apiDocs?.baseUrl ?? "",
      appName: config.apiDocs?.appName ?? appName,
    },
    // Fixed so that a release does not turn the golden red.
    source: { framework: "0.0.0-recipe", app: { name: appName, version: "0.0.0" } },
    examples: readExamples(),
    webhookExamples: readWebhookExamples(),
  });

  if (process.env[UPDATE_FLAG] === "1") {
    rmSync(GOLDEN_DIR, { recursive: true, force: true });
    for (const [path, content] of generated.files) {
      mkdirSync(dirname(join(GOLDEN_DIR, path)), { recursive: true });
      writeFileSync(join(GOLDEN_DIR, path), content);
    }
  }

  test("every documented handler is complete", () => {
    expect(generated.problems).toEqual([]);
  });

  test("the committed output equals what the generator produces", () => {
    expect(diffApiDocsOutput(generated.files, readGolden(GOLDEN_DIR))).toEqual({
      missing: [],
      changed: [],
      extra: [],
    });
  });
});
