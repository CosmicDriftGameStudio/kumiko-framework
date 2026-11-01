// Text-rendering helpers shared by the scaffold renderers: import blocks formatted like Biome's
// output and the per-app derived tenant id.

export const MAX_LINE_WIDTH = 100;

// Mirrors Biome's import sort so generated files pass `biome check` untouched:
// packages alphabetically by specifier, relative paths last.
function compareImportKeys(a: string, b: string): number {
  const lowerA = a.replace(/^type /, "").toLowerCase();
  const lowerB = b.replace(/^type /, "").toLowerCase();
  if (lowerA !== lowerB) return lowerA < lowerB ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

export type ImportSpec = {
  readonly specifier: string;
  readonly names: readonly string[];
  readonly typeOnly?: boolean;
  readonly defaultName?: string;
};

function renderImportLine({ specifier, names, typeOnly, defaultName }: ImportSpec): string {
  if (defaultName !== undefined) return `import ${defaultName} from "${specifier}";`;
  const sorted = [...names].sort(compareImportKeys);
  const keyword = typeOnly === true ? "import type" : "import";
  const oneLine = `${keyword} { ${sorted.join(", ")} } from "${specifier}";`;
  if (sorted.length === 1 || oneLine.length <= MAX_LINE_WIDTH) return oneLine;
  return `${keyword} {\n${sorted.map((n) => `  ${n},`).join("\n")}\n} from "${specifier}";`;
}

export function renderSortedImports(imports: readonly ImportSpec[]): string {
  return [...imports]
    .sort((a, b) => {
      const relativeA = isRelativeSpecifier(a.specifier);
      const relativeB = isRelativeSpecifier(b.specifier);
      if (relativeA !== relativeB) return relativeA ? 1 : -1;
      return compareImportKeys(a.specifier, b.specifier);
    })
    .map(renderImportLine)
    .join("\n");
}

// Tiers mirror how Biome wraps the JSX as the name grows. The user spread
// is part of every tier so the line-width math covers it.
export function renderDefaultAppShellElement(appName: string): string {
  const spanOpen = '<span className="font-semibold tracking-tight">';
  const userSpread = "{...(user !== undefined && { user })}";
  // html-ok: appName is kebab-validated (a-z/0-9/-); this is generated .tsx source, not runtime HTML.
  const brandInline = `${spanOpen}${appName}</span>`;
  const singleLine = `    <DefaultAppShell brand={${brandInline}} schema={schema} ${userSpread}>`;
  if (singleLine.length <= MAX_LINE_WIDTH) return singleLine;
  const brandAttrInline = `      brand={${brandInline}}`;
  const brandAttribute =
    brandAttrInline.length <= MAX_LINE_WIDTH
      ? brandAttrInline
      : `${[
          "      brand={",
          ...(`        ${brandInline}`.length <= MAX_LINE_WIDTH
            ? [`        ${brandInline}`]
            : [`        ${spanOpen}`, `          ${appName}`, "        </span>"]),
          "      }",
        ].join("\n")}`;
  return [
    "    <DefaultAppShell",
    brandAttribute,
    "      schema={schema}",
    `      ${userSpread}`,
    "    >",
  ].join("\n");
}

// Deterministic tenant-ID from app-name. Format: UUID-v4 with the
// version-marker at the right spot. NOT cryptographically random —
// just a stable per-app default the user can change later.
export function deriveTenantId(name: string): string {
  let state = 2166136261;
  for (const ch of name) {
    state ^= ch.charCodeAt(0);
    state = Math.imul(state, 16777619) >>> 0;
  }
  // @wrapper-known semantic-alias
  const hex = (n: number, len: number): string => n.toString(16).padStart(len, "0").slice(0, len);
  const a = hex(state, 8);
  state ^= state << 13;
  state >>>= 0;
  const b = hex(state, 4);
  state ^= state >>> 17;
  state >>>= 0;
  const c = `4${hex(state, 3)}`;
  state ^= state << 5;
  state >>>= 0;
  const d4 = (0x8 | (state & 0x3)).toString(16);
  const d = `${d4}${hex(state >>> 4, 3)}`;
  state = Math.imul(state, 16777619) >>> 0;
  const e = hex(state, 12);
  return `${a}-${b}-${c}-${d}-${e}`;
}

export function renderAdminAuthBlock(appName: string, extraAdminLines: readonly string[]): string {
  const passwordAndExtras = extraAdminLines.map((l) => `      ${l}`).join("\n");
  return `  auth: {
    admin: {
      email: "admin@${appName}.local",
${passwordAndExtras}
      memberships: [
        {
          tenantId: DEFAULT_TENANT_ID,
          tenantKey: "${appName}",
          tenantName: "${appName}",
          roles: ["TenantAdmin"],
        },
      ],
    },
  },`;
}
