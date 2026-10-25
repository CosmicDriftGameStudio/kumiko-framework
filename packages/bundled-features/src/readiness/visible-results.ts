import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { PROBE_RUN_STATUS } from "./schema/probe-run.ts";

const probeTextSchema = z.object({
  key: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

const probeResultRowSchema = z.object({
  probe: z.string(),
  scope: z.enum(["tenant", "system"]),
  area: z.string(),
  label: probeTextSchema,
  targetId: z.string().optional(),
  ownerUserId: z.string().optional(),
  status: z.enum(["ok", "failed", "skipped"]),
  durationMs: z.number().nullable(),
  message: probeTextSchema,
  fixScreen: z.string().optional(),
});

const storedResultsSchema = z.object({ rows: z.array(probeResultRowSchema) });

export type StoredProbeResult = z.infer<typeof probeResultRowSchema>;

// Same shape as a dashboard text, so the result table renders it with the `i18nText` format.
export type ProbeText = {
  readonly i18nKey: string;
  readonly i18nParams?: Readonly<Record<string, string | number>>;
};

export type VisibleProbeResult = Omit<StoredProbeResult, "label" | "message" | "fixScreen"> & {
  readonly id: string;
  readonly label: ProbeText;
  readonly message: ProbeText;
  // Only on failed rows: the result table links the row to the screen that fixes it.
  readonly fixScreen?: string;
};

export type RunOutcome = "ok" | "failed" | "running";

export type ResultCounts = {
  readonly okCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly totalCount: number;
};

// A fresh run still holds the column default `{}`; anything unparsable counts as no results.
export function parseStoredResults(stored: unknown): readonly StoredProbeResult[] {
  const parsed = storedResultsSchema.safeParse(stored);
  return parsed.success ? parsed.data.rows : [];
}

export function resultId(result: StoredProbeResult): string {
  return `${result.probe}#${result.targetId ?? ""}`;
}

function canSee(result: StoredProbeResult, user: SessionUser): boolean {
  if (result.scope === "system" && !user.roles.includes("SystemAdmin")) return false;
  return result.ownerUserId === undefined || result.ownerUserId === user.id;
}

function toProbeText(text: StoredProbeResult["label"]): ProbeText {
  return text.params === undefined
    ? { i18nKey: text.key }
    : { i18nKey: text.key, i18nParams: text.params };
}

function toVisibleResult(result: StoredProbeResult): VisibleProbeResult {
  const { label, message, fixScreen, ...rest } = result;
  return {
    ...rest,
    id: resultId(result),
    label: toProbeText(label),
    message: toProbeText(message),
    ...(result.status === "failed" && fixScreen !== undefined && { fixScreen }),
  };
}

export function visibleResults(stored: unknown, user: SessionUser): readonly VisibleProbeResult[] {
  return parseStoredResults(stored)
    .filter((result) => canSee(result, user))
    .map(toVisibleResult);
}

export function countResults(results: readonly Pick<StoredProbeResult, "status">[]): ResultCounts {
  const count = (status: StoredProbeResult["status"]) =>
    results.filter((result) => result.status === status).length;
  return {
    okCount: count("ok"),
    failedCount: count("failed"),
    skippedCount: count("skipped"),
    totalCount: results.length,
  };
}

export function isRunActive(status: string): boolean {
  return status === PROBE_RUN_STATUS.Pending || status === PROBE_RUN_STATUS.Running;
}

export function outcomeOf(status: string, counts: ResultCounts): RunOutcome {
  if (isRunActive(status)) return "running";
  return status === PROBE_RUN_STATUS.Done && counts.failedCount === 0 ? "ok" : "failed";
}
