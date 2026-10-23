import type {
  MetricNavigate,
  RecordHeaderSubtitlePart,
  RowActionNavigate,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { isSafeHref } from "../headless/index.ts";
import { requestLeave } from "../leave-guard.ts";
import type { FeatureSchema } from "./feature-schema.ts";
import type { NavApi } from "./nav.tsx";
import type { ReturnHost } from "./return-to.tsx";
import { runProjectionRowNavigate } from "./row-actions.ts";
import { navigateTargetAllows } from "./screen-access.ts";

// Reuses runProjectionRowNavigate (row-actions.ts) instead of re-deriving
// navigate execution — a metric click has the same entity/screen/params
// shape as a RowActionNavigate, minus the fields (id, label, style) that
// function never reads.
export function runMetricNavigate(
  nav: NavApi,
  navigate: MetricNavigate,
  record: Readonly<Record<string, unknown>>,
  host: ReturnHost | undefined,
): void {
  // tab alone (no screen/entity) stays on the current record and just
  // activates that tab — no route change, so runProjectionRowNavigate
  // (which always navigates) doesn't apply here.
  if (navigate.screen === undefined && navigate.entity === undefined) {
    const { tab } = navigate;
    if (tab !== undefined) requestLeave(() => nav.setSearchParams({ tab }));
    // skip: tab-only metric navigation never leaves the record
    return;
  }
  const base = { kind: "navigate" as const, id: "metric-navigate", label: "" };
  const action: RowActionNavigate | undefined =
    navigate.entity !== undefined
      ? {
          ...base,
          entity: navigate.entity,
          ...(navigate.entityId !== undefined && { entityId: navigate.entityId }),
          ...(navigate.params !== undefined && { params: navigate.params }),
          ...(navigate.tab !== undefined && { tab: navigate.tab }),
        }
      : navigate.screen !== undefined
        ? {
            ...base,
            screen: navigate.screen,
            ...(navigate.entityId !== undefined && { entityId: navigate.entityId }),
            ...(navigate.params !== undefined && { params: navigate.params }),
            ...(navigate.tab !== undefined && { tab: navigate.tab }),
          }
        : undefined;
  // skip: a navigate without entity or screen target has nothing to open
  if (action === undefined) return;
  runProjectionRowNavigate(nav, action, { id: "", values: record }, host);
}

// Absolute http(s) check for RecordHeaderSpec.subtitleHref — deliberately
// stricter than isSafeHref (which also allows relative paths and mailto:),
// since a relative/mailto value here should render as plain text, not a
// "_blank" external link.
export function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) && isSafeHref(value);
}

export type SubtitlePartView = {
  readonly field: string;
  readonly text: string;
  readonly href?: string;
  readonly onPress?: () => void;
};

// hrefFor throws for an entity without a detailFor screen; outside
// createKumikoApp the feature list is empty, so navigateTargetAllows can't
// rule that out beforehand. The NavApi owns target resolution, so asking it
// and falling back to plain text covers both cases.
function hrefForNavigate(
  nav: NavApi,
  navigate: MetricNavigate,
  record: Readonly<Record<string, unknown>>,
): string | undefined {
  const entityId =
    navigate.entityId !== undefined ? String(record[navigate.entityId] ?? "") : undefined;
  try {
    if (navigate.entity !== undefined) {
      return entityId === undefined || entityId === ""
        ? undefined
        : nav.hrefFor({ entity: navigate.entity, id: entityId });
    }
    if (navigate.screen !== undefined) {
      return nav.hrefFor({
        screenId: navigate.screen,
        ...(entityId !== undefined && entityId !== "" && { entityId }),
      });
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function buildSubtitleParts(
  parts: readonly RecordHeaderSubtitlePart[],
  record: Readonly<Record<string, unknown>>,
  nav: NavApi,
  appFeatures: readonly FeatureSchema[],
  userRoles: readonly string[] | undefined,
  host: ReturnHost | undefined,
): SubtitlePartView[] {
  return parts.flatMap((part): SubtitlePartView[] => {
    const field = typeof part === "string" ? part : part.field;
    const text = String(record[field] ?? "");
    // skip: empty subtitle parts render nothing
    if (text === "") return [];
    const navigate = typeof part === "string" ? undefined : part.navigate;
    if (navigate === undefined || !navigateTargetAllows(navigate, appFeatures, userRoles)) {
      return [{ field, text }];
    }
    const href = hrefForNavigate(nav, navigate, record);
    // skip: unresolvable targets fall back to plain text
    if (href === undefined) return [{ field, text }];
    return [{ field, text, href, onPress: () => runMetricNavigate(nav, navigate, record, host) }];
  });
}
