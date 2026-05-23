#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: CLI-Script, console ist Feature.
//
// Regeneriert schema.generated.ts (Entity-Tables) für die use-all-bundled
// Smoke-App. Pattern aus kumiko-studio/drizzle/generate.ts adaptiert auf
// die 29 bundled-features die hier gemountet sind (siehe ../src/run-config.ts).
//
// Usage:
//   bun run drizzle/generate.ts
//
// Output: drizzle/schema.generated.ts.
// Erweitern wenn use-all-bundled ein neues bundled-Feature mountet:
// FEATURE_IMPORT_REGISTRY hier ergänzen. Memory-würdig dass die Liste
// mit run-config.ts in Sync bleibt — wird in M5 als Lint-Guard verdrahtet.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { composeFeatures } from "@cosmicdrift/kumiko-dev-server/compose-features";
import { APP_FEATURES } from "../src/run-config";

type FeatureImport = (
	| {
			readonly kind: "factory";
			readonly path: string;
			readonly factory: string;
	  }
	| {
			readonly kind: "named";
			readonly path: string;
			readonly exportName: string;
	  }
) & {
	readonly projectionTables?: readonly string[];
};

const FEATURE_IMPORT_REGISTRY: Record<string, FeatureImport> = {
	config: {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/config",
		factory: "createConfigFeature",
	},
	user: {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/user",
		factory: "createUserFeature",
	},
	tenant: {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/tenant",
		factory: "createTenantFeature",
	},
	secrets: {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/secrets",
		factory: "createSecretsFeature",
	},
	sessions: {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/sessions",
		factory: "createSessionsFeature",
	},
	delivery: {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/delivery",
		factory: "createDeliveryFeature",
		projectionTables: ["deliveryAttemptsTable"],
	},
	"channel-in-app": {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/channel-in-app",
		factory: "createChannelInAppFeature",
	},
	"mail-foundation": {
		kind: "named",
		path: "@cosmicdrift/kumiko-bundled-features/mail-foundation",
		exportName: "mailFoundationFeature",
	},
	"mail-transport-inmemory": {
		kind: "named",
		path: "@cosmicdrift/kumiko-bundled-features/mail-transport-inmemory",
		exportName: "mailTransportInMemoryFeature",
	},
	"file-foundation": {
		kind: "named",
		path: "@cosmicdrift/kumiko-bundled-features/file-foundation",
		exportName: "fileFoundationFeature",
	},
	"file-provider-inmemory": {
		kind: "named",
		path: "@cosmicdrift/kumiko-bundled-features/file-provider-inmemory",
		exportName: "fileProviderInMemoryFeature",
	},
	files: {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/files",
		factory: "createFilesFeature",
	},
	"billing-foundation": {
		kind: "named",
		path: "@cosmicdrift/kumiko-bundled-features/billing-foundation",
		exportName: "billingFoundationFeature",
		projectionTables: ["subscriptionsProjectionTable"],
	},
	"tier-engine": {
		kind: "named",
		path: "@cosmicdrift/kumiko-bundled-features/tier-engine",
		exportName: "tierEngineFeature",
	},
	"cap-counter": {
		kind: "named",
		path: "@cosmicdrift/kumiko-bundled-features/cap-counter",
		exportName: "capCounterFeature",
	},
	jobs: {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/jobs",
		factory: "createJobsFeature",
		projectionTables: ["jobRunsTable", "jobRunLogsTable"],
	},
	"step-dispatcher": {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/step-dispatcher",
		factory: "createStepDispatcherFeature",
	},
	"compliance-profiles": {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/compliance-profiles",
		factory: "createComplianceProfilesFeature",
	},
	"data-retention": {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/data-retention",
		factory: "createDataRetentionFeature",
	},
	"user-data-rights": {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/user-data-rights",
		factory: "createUserDataRightsFeature",
	},
	"user-data-rights-defaults": {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/user-data-rights-defaults",
		factory: "createUserDataRightsDefaultsFeature",
	},
	"text-content": {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/text-content",
		factory: "createTextContentFeature",
	},
	"legal-pages": {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/legal-pages",
		factory: "createLegalPagesFeature",
	},
	"template-resolver": {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/template-resolver",
		factory: "createTemplateResolverFeature",
	},
	"renderer-foundation": {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/renderer-foundation",
		factory: "createRendererFoundationFeature",
	},
	"renderer-simple": {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/renderer-simple",
		factory: "createRendererSimpleFeature",
	},
	"rate-limiting": {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/rate-limiting",
		factory: "createRateLimitingFeature",
	},
	audit: {
		kind: "factory",
		path: "@cosmicdrift/kumiko-bundled-features/audit",
		factory: "createAuditFeature",
	},
	"custom-fields": {
		kind: "named",
		path: "@cosmicdrift/kumiko-bundled-features/custom-fields",
		exportName: "customFieldsFeature",
	},
};

const features = composeFeatures([...APP_FEATURES], {
	includeBundled: true,
});

const importLines: string[] = [
	'import { buildDrizzleTable } from "@cosmicdrift/kumiko-framework/db";',
];
const constLines: string[] = [];
const seenFeature = new Set<string>();
const featureVarNames = new Map<string, string>();
const projectionTableReexports: Array<{
	readonly path: string;
	readonly tables: readonly string[];
}> = [];

for (const feature of features) {
	const hasEntities = Object.keys(feature.entities).length > 0;
	const entry = FEATURE_IMPORT_REGISTRY[feature.name];
	const hasProjectionTables =
		entry !== undefined && (entry.projectionTables?.length ?? 0) > 0;
	if (!hasEntities && !hasProjectionTables) continue;
	if (seenFeature.has(feature.name)) continue;
	seenFeature.add(feature.name);

	if (!entry) {
		throw new Error(
			`drizzle/generate.ts: feature "${feature.name}" has no import entry. ` +
				`Add it to FEATURE_IMPORT_REGISTRY at the top of this file.`,
		);
	}

	if (hasEntities) {
		const varName = toIdent(`_${feature.name}`);
		featureVarNames.set(feature.name, varName);
		if (entry.kind === "factory") {
			importLines.push(`import { ${entry.factory} } from "${entry.path}";`);
			constLines.push(`const ${varName} = ${entry.factory}();`);
		} else {
			importLines.push(`import { ${entry.exportName} } from "${entry.path}";`);
			constLines.push(`const ${varName} = ${entry.exportName};`);
		}
	}

	if (hasProjectionTables && entry.projectionTables) {
		projectionTableReexports.push({
			path: entry.path,
			tables: entry.projectionTables,
		});
	}
}

const lines: string[] = [
	"// Auto-generated by drizzle/generate.ts — DO NOT EDIT",
	"// Re-run: bun run drizzle/generate.ts",
	"// biome-ignore-all format: generated output",
	"// biome-ignore-all assist/source/organizeImports: generated output",
	"// biome-ignore-all lint/style/noNonNullAssertion: generated output — entity-lookup ist immer present per registry-contract",
	"",
	...importLines,
	"",
	...constLines,
	"",
];

let entityCount = 0;
for (const feature of features) {
	const varName = featureVarNames.get(feature.name);
	if (!varName) continue;
	for (const entityName of Object.keys(feature.entities)) {
		const exportName = `${toIdent(entityName)}Table`;
		lines.push(
			`export const ${exportName} = buildDrizzleTable("${entityName}", ${varName}.entities["${entityName}"]!);`,
		);
		entityCount++;
	}
}

let projectionTableCount = 0;
for (const { path, tables } of projectionTableReexports) {
	lines.push(`export { ${tables.join(", ")} } from "${path}";`);
	projectionTableCount += tables.length;
}

lines.push("");

const outPath = resolve(import.meta.dir, "schema.generated.ts");
writeFileSync(outPath, lines.join("\n"), "utf-8");
console.log(
	`  Entity-Tables: ${entityCount} + Projection-Tables: ${projectionTableCount} → schema.generated.ts`,
);

function toIdent(name: string): string {
	return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}
