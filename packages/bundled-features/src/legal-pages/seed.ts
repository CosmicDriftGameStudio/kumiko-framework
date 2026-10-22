import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type LegalContentBlock,
  seedLegalContentFromJson,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/seeding";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import * as z from "zod";

export type { LegalContentBlock };

// `path` is resolved against the process cwd (the app root for `bun bin/main.ts`),
// not against this module, so apps can keep their generated JSON where it is.
export type LegalContentSeedSource =
  | { readonly blocks: readonly LegalContentBlock[] }
  | { readonly path: string };

export type LegalContentSeedFn = (deps: { readonly db: DbConnection }) => Promise<void>;

const legalContentBlocksSchema = z.array(
  z.object({
    slug: z.string().min(1),
    locale: z.string().min(1),
    title: z.string(),
    content: z.string(),
  }),
);

const jsonModuleSchema = z.object({ default: z.unknown() });

async function loadBlocksFromJson(path: string): Promise<readonly LegalContentBlock[]> {
  const url = pathToFileURL(resolve(process.cwd(), path)).href;
  const module = jsonModuleSchema.parse(await import(url, { with: { type: "json" } }));
  const parsed = legalContentBlocksSchema.safeParse(module.default);
  if (!parsed.success) {
    throw new Error(
      `legal-pages: ${path} is not a list of { slug, locale, title, content } blocks: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

// Boot seed for runProdApp's `seeds: [...]`. The JSON template is authoritative
// (ifExists "update"), so legally required text changes reach rows seeded once.
export function legalContentSeed(
  source: LegalContentSeedSource,
  options?: { readonly folder?: string },
): LegalContentSeedFn {
  return async ({ db }) => {
    const blocks =
      "blocks" in source
        ? legalContentBlocksSchema.parse(source.blocks)
        : await loadBlocksFromJson(source.path);
    await seedLegalContentFromJson(db, blocks, options);
  };
}
