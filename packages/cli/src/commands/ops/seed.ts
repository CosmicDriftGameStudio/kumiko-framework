import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CliCommandContext } from "../types";

function fail(ctx: CliCommandContext, ...lines: readonly string[]): number {
  ctx.out.err("");
  for (const line of lines) ctx.out.err(`  ${line}`);
  ctx.out.err("");
  return 1;
}

function seedsDirOf(ctx: CliCommandContext): string {
  const index = ctx.argv.indexOf("--seeds-dir");
  const value = index === -1 ? undefined : ctx.argv[index + 1];
  return resolve(ctx.cwd, value ?? "seeds");
}

function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function listSeedIds(seedsDir: string): readonly string[] {
  if (!existsSync(seedsDir)) return [];
  return readdirSync(seedsDir)
    .filter((name) => name.endsWith(".ts") || name.endsWith(".mts") || name.endsWith(".js"))
    .filter((name) => !name.startsWith("_") && !name.startsWith("."))
    .sort()
    .map((name) => name.replace(/\.(ts|mts|js)$/, ""));
}

function renderSeedTemplate(filename: string): string {
  return `// ${filename}
//
// Seed migration. Runs automatically on the next app boot (unless
// KUMIKO_SKIP_ES_OPS = "1") and is marked as applied in kumiko_es_operations.
// A failure aborts the boot; the next boot retries it.
//
// ctx.systemWriteAs(<handlerQualifiedName>, payload) calls an existing
// write handler as the system user: the same path a UI click would take,
// only without the access check.

import type { SeedMigration } from "@cosmicdrift/kumiko-framework/es-ops";

export default {
  description: "TODO: short description of what this migration does",
  run: async (_ctx) => {
    // TODO: implement the migration.
    //
    // Read helpers: ctx.findUserByEmail, ctx.findMembershipsOfUser, ctx.findTenants,
    // ctx.findTemplateResources({ slug?, kind?, status?, locale? }).
    //
    // Example (admin-roles-fix):
    //   const admin = await ctx.findUserByEmail("admin@example.com");
    //   if (!admin) return;
    //   for (const m of await ctx.findMembershipsOfUser(admin.id)) {
    //     if (m.roles.includes("TenantAdmin")) continue;
    //     await ctx.systemWriteAs("tenant:write:updateMemberRoles", {
    //       userId: admin.id,
    //       tenantId: m.tenantId,
    //       roles: [...m.roles, "TenantAdmin"],
    //     });
    //   }
  },
} satisfies SeedMigration;
`;
}

export const seedNewOp = {
  id: "seed:new",
  description: "Scaffold seeds/<date>-<slug>.ts",
  run: async (ctx: CliCommandContext): Promise<number> => {
    const slug = ctx.argv[0];
    if (!slug || slug.startsWith("-")) {
      return fail(ctx, "Usage: kumiko ops seed:new <slug> [--seeds-dir <path>]");
    }
    const sanitized = sanitizeSlug(slug);
    if (!sanitized) return fail(ctx, "Invalid slug: only a-z, 0-9 and - are allowed.");

    const { ensureTemporalPolyfill } = await import("@cosmicdrift/kumiko-framework/time");
    await ensureTemporalPolyfill();
    const filename = `${Temporal.Now.instant().toString().slice(0, 10)}-${sanitized}.ts`;
    const seedsDir = seedsDirOf(ctx);
    mkdirSync(seedsDir, { recursive: true });
    const filePath = join(seedsDir, filename);
    if (existsSync(filePath)) return fail(ctx, `${filePath} already exists, not overwriting it.`);

    writeFileSync(filePath, renderSeedTemplate(filename));
    ctx.out.log(`  ✓ ${filePath}`);
    ctx.out.log("  Edit and commit it; the next app boot applies it.");
    return 0;
  },
};

export const seedStatusOp = {
  id: "seed:status",
  description: "List applied and pending seed migrations",
  run: async (ctx: CliCommandContext): Promise<number> => {
    const seedsDir = seedsDirOf(ctx);
    const ids = listSeedIds(seedsDir);
    if (ids.length === 0) {
      ctx.out.log(`  ${seedsDir}: no seeds found.`);
      return 0;
    }
    const databaseUrl = process.env["DATABASE_URL"];
    if (!databaseUrl) return fail(ctx, "DATABASE_URL not set. Run against the app env.");

    const { createDbConnection, selectMany, tableExists } = await import(
      "@cosmicdrift/kumiko-framework/db"
    );
    const { esOperationsTable } = await import("@cosmicdrift/kumiko-framework/es-ops");
    const { runInSystemRowLevelSecurityScope } = await import(
      "@cosmicdrift/kumiko-framework/internal/row-level-security"
    );
    const { db, close } = createDbConnection({ url: databaseUrl });
    try {
      const applied = await runInSystemRowLevelSecurityScope(
        "seed status reads the global es-operations bookkeeping table",
        async () =>
          (await tableExists(db, "public.kumiko_es_operations"))
            ? new Set(
                (
                  await selectMany<{ readonly id: string }>(db, esOperationsTable, {
                    operationType: "seed-migration",
                  })
                ).map((row) => row.id),
              )
            : new Set<string>(),
      );
      for (const id of ids) {
        const isApplied = applied.has(id);
        ctx.out.log(`  ${isApplied ? "✓" : "⏳"} ${id} (${isApplied ? "applied" : "pending"})`);
      }
      return 0;
    } finally {
      await close();
    }
  },
};
