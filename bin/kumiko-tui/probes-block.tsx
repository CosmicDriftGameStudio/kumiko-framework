import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { type ReactNode, useEffect, useState } from "react";
import { getProbes, type ProbeLevel, type ProbeReport, type StatusProbe } from "./probes";
import { icons, theme } from "./theme";
import type { Role } from "./types";

const LEVEL_COLOR: Record<ProbeLevel, string> = {
  ok: theme.ok,
  warn: theme.warn,
  action: theme.err,
};
const LEVEL_ICON: Record<ProbeLevel, string> = {
  ok: icons.done,
  warn: "⚠",
  action: "!",
};

const REFRESH_INTERVAL_MS = 60_000;

type Cell = { readonly report: ProbeReport | undefined; readonly loading: boolean };

export function ProbesBlock({ role }: { readonly role: Role }): ReactNode {
  const probes = getProbes(role);
  const [cells, setCells] = useState<ReadonlyMap<string, Cell>>(
    () => new Map(probes.map((p) => [p.id, { report: undefined, loading: true }])),
  );

  useEffect(() => {
    let cancelled = false;

    const refresh = (): void => {
      setCells((prev) => {
        const next = new Map(prev);
        for (const p of probes) {
          const old = prev.get(p.id);
          next.set(p.id, { report: old?.report, loading: true });
        }
        return next;
      });
      for (const probe of probes) {
        probe
          .collect()
          .then((report) => {
            if (cancelled) return;
            setCells((prev) => new Map(prev).set(probe.id, { report, loading: false }));
          })
          .catch((e: unknown) => {
            if (cancelled) return;
            setCells((prev) =>
              new Map(prev).set(probe.id, {
                loading: false,
                report: {
                  level: "warn",
                  summary: "error",
                  detail: e instanceof Error ? e.message : String(e),
                },
              }),
            );
          });
      }
    };

    refresh();
    const id = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>── Health ──</Text>
      {probes.map((probe) => (
        <ProbeRow key={probe.id} probe={probe} cell={cells.get(probe.id)} />
      ))}
    </Box>
  );
}

function ProbeRow({
  probe,
  cell,
}: {
  readonly probe: StatusProbe;
  readonly cell: Cell | undefined;
}): ReactNode {
  const loading = cell?.loading ?? true;
  const report = cell?.report;
  return (
    <Box>
      <Box width={3}>
        {loading && !report ? (
          <Text color={theme.muted}>
            <Spinner />
          </Text>
        ) : report ? (
          <Text color={LEVEL_COLOR[report.level]} bold>
            {LEVEL_ICON[report.level]}
          </Text>
        ) : (
          <Text dimColor>—</Text>
        )}
      </Box>
      <Box flexGrow={1}>
        <Text dimColor>{probe.label}</Text>
      </Box>
      <Box>
        {report ? (
          <Text color={LEVEL_COLOR[report.level]}>{report.summary}</Text>
        ) : (
          <Text dimColor>{loading ? "…" : "—"}</Text>
        )}
      </Box>
    </Box>
  );
}
