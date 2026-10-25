import { runWithTimeout } from "@cosmicdrift/kumiko-framework/api";
import {
  type ProbeContext,
  type ProbeDefinition,
  ProbeFailure,
  type ProbeTarget,
  type ProbeText,
} from "@cosmicdrift/kumiko-framework/engine";
import { probeTimeoutMs } from "./collect-probes.ts";
import { ProbeTextKeys } from "./constants.ts";
import type { ProbeResultRow } from "./schema/probe-run.ts";

type RunOutcome = Pick<ProbeResultRow, "status" | "durationMs" | "message">;

function baseRow(probe: ProbeDefinition, target: ProbeTarget | undefined) {
  return {
    probe: probe.qualifiedName,
    scope: probe.scope,
    area: probe.area,
    label: target ? target.label : { key: probe.label },
    ...(target && { targetId: target.id }),
    ...(target?.ownerUserId !== undefined && { ownerUserId: target.ownerUserId }),
    ...(probe.fixScreen !== undefined && { fixScreen: probe.fixScreen }),
  };
}

function rowOf(
  probe: ProbeDefinition,
  target: ProbeTarget | undefined,
  outcome: RunOutcome,
): ProbeResultRow {
  return { ...baseRow(probe, target), ...outcome };
}

// Raw error messages can carry secrets or addresses, so only ProbeFailure texts reach the run.
function failureText(
  ctx: ProbeContext,
  probe: ProbeDefinition,
  failure: { readonly error: unknown; readonly timedOut: boolean },
): ProbeText {
  if (failure.timedOut) {
    return { key: ProbeTextKeys.timeout, params: { seconds: probeTimeoutMs(probe) / 1000 } };
  }
  if (failure.error instanceof ProbeFailure) return failure.error.text;
  ctx.obs.log.warn("readiness probe failed", {
    probe: probe.qualifiedName,
    error: failure.error instanceof Error ? failure.error.message : String(failure.error),
  });
  return { key: ProbeTextKeys.failed };
}

async function runOne(
  ctx: ProbeContext,
  probe: ProbeDefinition,
  target: ProbeTarget | undefined,
): Promise<ProbeResultRow> {
  const result = await runWithTimeout(() => probe.run(ctx, target), probeTimeoutMs(probe));
  if (result.ok) {
    // A skipped probe did not run, so its row shows no duration like the runner's own skips.
    return rowOf(probe, target, {
      status: result.value.status,
      durationMs: result.value.status === "skipped" ? null : result.latencyMs,
      message: result.value.message,
    });
  }
  return rowOf(probe, target, {
    status: "failed",
    durationMs: result.latencyMs,
    message: failureText(ctx, probe, result),
  });
}

function skippedRow(probe: ProbeDefinition, messageKey: string): ProbeResultRow {
  return rowOf(probe, undefined, {
    status: "skipped",
    durationMs: null,
    message: { key: messageKey },
  });
}

async function runProbe(
  ctx: ProbeContext,
  probe: ProbeDefinition,
  includePaid: boolean,
): Promise<readonly ProbeResultRow[]> {
  if (probe.cost === "paid" && !includePaid) {
    return [skippedRow(probe, ProbeTextKeys.paidNotRequested)];
  }
  const { targets } = probe;
  if (targets === undefined) return [await runOne(ctx, probe, undefined)];

  const resolved = await runWithTimeout(() => targets(ctx), probeTimeoutMs(probe));
  if (!resolved.ok) {
    return [
      rowOf(probe, undefined, {
        status: "failed",
        durationMs: resolved.latencyMs,
        message: failureText(ctx, probe, resolved),
      }),
    ];
  }
  const ownTargets = resolved.value.filter(
    (target) => target.ownerUserId === undefined || target.ownerUserId === ctx.triggeredByUserId,
  );
  if (ownTargets.length === 0) return [skippedRow(probe, ProbeTextKeys.noTargets)];
  return Promise.all(ownTargets.map((target) => runOne(ctx, probe, target)));
}

export async function executeProbes(
  ctx: ProbeContext,
  probes: readonly ProbeDefinition[],
  includePaid: boolean,
): Promise<readonly ProbeResultRow[]> {
  const perProbe = await Promise.all(probes.map((probe) => runProbe(ctx, probe, includePaid)));
  return perProbe.flat();
}
