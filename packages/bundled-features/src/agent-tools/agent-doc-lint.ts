import type {
  FeatureDefinition,
  QueryHandlerDef,
  WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { QnTypes, qn, resolveAgentExposure, toKebab } from "@cosmicdrift/kumiko-framework/engine";

export const AgentDocGapKinds = {
  handlerWithoutDescription: "handler-without-description",
  customScreenWithoutDescription: "custom-screen-without-description",
  exposedEntityWithoutDescription: "exposed-entity-without-description",
} as const;

export type AgentDocGapKind = (typeof AgentDocGapKinds)[keyof typeof AgentDocGapKinds];

export type AgentDocGap = {
  readonly qn: string;
  readonly feature: string;
  readonly kind: AgentDocGapKind;
  readonly reason: string;
};

// No shared screen-type union exists in the codebase to import (ScreenDefinition
// is a discriminated union keyed by inline string literals) — name the one
// value this lint cares about instead of comparing against a bare string.
const CUSTOM_SCREEN_TYPE = "custom";

const ENTITY_QN_SEGMENT = "entity";

// QNs contain `:`, so localeCompare's ICU punctuation rules would make sort
// order depend on runtime locale — compare by code point instead (same
// reasoning as agent-manifest.ts's compareIds).
function compareByCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function handlerDocGaps(
  feature: FeatureDefinition,
  handlers: Readonly<Record<string, WriteHandlerDef | QueryHandlerDef>>,
  handlerQnType: typeof QnTypes.write | typeof QnTypes.query,
  handlerNoun: string,
): readonly AgentDocGap[] {
  const gaps: AgentDocGap[] = [];
  for (const [name, def] of Object.entries(handlers)) {
    if (def.description !== undefined || def.agent?.expose === false) continue;
    gaps.push({
      qn: qn(toKebab(feature.name), handlerQnType, toKebab(name)),
      feature: feature.name,
      kind: AgentDocGapKinds.handlerWithoutDescription,
      reason: `This ${handlerNoun} has no description, so it stays invisible to the AI agent — set \`description\` to expose it, or \`agent: { expose: false }\` to opt out deliberately.`,
    });
  }
  return gaps;
}

function screenDocGaps(feature: FeatureDefinition): readonly AgentDocGap[] {
  const gaps: AgentDocGap[] = [];
  for (const [shortId, screen] of Object.entries(feature.screens ?? {})) {
    if (screen.type !== CUSTOM_SCREEN_TYPE || screen.description !== undefined) continue;
    gaps.push({
      qn: qn(toKebab(feature.name), QnTypes.screen, toKebab(shortId)),
      feature: feature.name,
      kind: AgentDocGapKinds.customScreenWithoutDescription,
      reason:
        "This custom screen has no description, so the AI agent can't tell what it's for — set `description` to explain it.",
    });
  }
  return gaps;
}

// The handlerEntityMappings record can't distinguish write from query
// namespaces (both share one short-name-keyed map), so both must be probed
// per mapped handler name.
function agentVisibleEntityNames(feature: FeatureDefinition): ReadonlySet<string> {
  const entityNames = new Set<string>();
  for (const [handlerName, entityName] of Object.entries(feature.handlerEntityMappings ?? {})) {
    const writeDef = feature.writeHandlers?.[handlerName];
    if (writeDef && resolveAgentExposure(writeDef, "write").expose) entityNames.add(entityName);
    const queryDef = feature.queryHandlers?.[handlerName];
    if (queryDef && resolveAgentExposure(queryDef, "query").expose) entityNames.add(entityName);
  }
  return entityNames;
}

function exposedEntityDocGaps(feature: FeatureDefinition): readonly AgentDocGap[] {
  const gaps: AgentDocGap[] = [];
  for (const entityName of agentVisibleEntityNames(feature)) {
    const entity = feature.entities?.[entityName];
    if (!entity || entity.description !== undefined) continue;
    gaps.push({
      // Registry keeps entities under their raw, non-kebab name (unlike
      // handlers/screens) — qn() would throw on a camelCase segment.
      qn: `${toKebab(feature.name)}:${ENTITY_QN_SEGMENT}:${entityName}`,
      feature: feature.name,
      kind: AgentDocGapKinds.exposedEntityWithoutDescription,
      reason:
        "This entity is reachable through an agent-visible handler, but the agent can't explain its schema — set `description` to describe it.",
    });
  }
  return gaps;
}

export function findAgentDocGaps(features: readonly FeatureDefinition[]): readonly AgentDocGap[] {
  const gaps: AgentDocGap[] = [];
  for (const feature of features) {
    gaps.push(
      ...handlerDocGaps(feature, feature.writeHandlers ?? {}, QnTypes.write, "write handler"),
    );
    gaps.push(
      ...handlerDocGaps(feature, feature.queryHandlers ?? {}, QnTypes.query, "query handler"),
    );
    gaps.push(...screenDocGaps(feature));
    gaps.push(...exposedEntityDocGaps(feature));
  }
  // Map/Record iteration follows feature-mount order; the result must not
  // depend on it (mirrors agent-manifest.ts's sortedByKey rationale).
  return [...gaps].sort((a, b) => compareByCodePoint(a.qn, b.qn));
}

export function formatAgentDocGap(gap: AgentDocGap): string {
  return `${gap.qn} — ${gap.reason}`;
}
