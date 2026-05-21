import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { ReactNode } from "react";
import { ProbesBlock } from "./probes-block";
import type { SystemInfo } from "./system-info";
import { icons, theme } from "./theme";
import type { Role, TuiCommand } from "./types";

type BrowseState = {
  readonly kind: "browse";
  readonly hovered: TuiCommand | undefined;
};

type RunState = {
  readonly kind: "run";
  readonly cmd: TuiCommand;
  readonly elapsedSec: number;
  readonly status: "running" | "done" | "fail";
  readonly exitCode: number | null;
};

export type SidebarState = BrowseState | RunState;

export function Sidebar({
  state,
  sys,
  role,
}: {
  readonly state: SidebarState;
  readonly sys: SystemInfo;
  readonly role: Role;
}): ReactNode {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      borderDimColor
      paddingX={1}
      width={36}
      flexShrink={0}
    >
      <Box flexDirection="column" flexGrow={1}>
        {state.kind === "browse" ? (
          <BrowseSidebar hovered={state.hovered} />
        ) : (
          <RunSidebar state={state} />
        )}

        <ProbesBlock role={role} />
      </Box>

      <SystemBlock sys={sys} />
    </Box>
  );
}

function BrowseSidebar({ hovered }: { readonly hovered: TuiCommand | undefined }): ReactNode {
  if (!hovered) {
    return <Text dimColor>Wähle einen Command…</Text>;
  }
  return (
    <Box flexDirection="column">
      <Text color={theme.accent} bold>
        {hovered.label}
      </Text>
      <Text dimColor>{hovered.category}</Text>

      <Box marginTop={1} flexDirection="column">
        <Text>{hovered.description}</Text>
      </Box>

      {hovered.help ? (
        <Box marginTop={1} flexDirection="column">
          {hovered.help.split("\n").map((line, i) => (
            <Text key={i} dimColor>
              {line}
            </Text>
          ))}
        </Box>
      ) : null}

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>argv</Text>
        <Text color={theme.muted}>kumiko {hovered.argv.join(" ")}</Text>
      </Box>
    </Box>
  );
}

function RunSidebar({ state }: { readonly state: RunState }): ReactNode {
  const statusColor =
    state.status === "running"
      ? theme.warn
      : state.status === "done"
        ? theme.ok
        : theme.err;
  const statusIcon =
    state.status === "running" ? icons.running : state.status === "done" ? icons.done : icons.fail;
  const statusLabel =
    state.status === "running"
      ? "läuft"
      : state.status === "done"
        ? "fertig"
        : `failed (exit ${state.exitCode ?? "?"})`;

  return (
    <Box flexDirection="column">
      <Box>
        {state.status === "running" ? (
          <Text color={statusColor}>
            <Spinner />{" "}
          </Text>
        ) : (
          <Text color={statusColor}>{statusIcon} </Text>
        )}
        <Text color={statusColor} bold>
          {statusLabel}
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>command</Text>
        <Text color={theme.accent} bold>
          {state.cmd.label}
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>elapsed</Text>
        <Text>{state.elapsedSec.toFixed(1)}s</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>argv</Text>
        <Text color={theme.muted}>kumiko {state.cmd.argv.join(" ")}</Text>
      </Box>
    </Box>
  );
}

function SystemBlock({ sys }: { readonly sys: SystemInfo }): ReactNode {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text dimColor>── System ──</Text>
      </Box>

      <Row label="kumiko">
        <Text color={theme.accent}>v{sys.kumiko}</Text>
      </Row>
      {sys.bun !== undefined ? (
        <Row label="bun">
          <Text>v{sys.bun}</Text>
        </Row>
      ) : null}
      <Row label="node">
        <Text>v{sys.node}</Text>
      </Row>
      <Row label="features">
        <Text>{sys.featureCount} bundled</Text>
      </Row>

      {sys.gitBranch ? (
        <Row label="branch">
          <Text color={sys.gitDirty ? theme.warn : undefined}>
            {sys.gitBranch}
            {sys.gitDirty ? " •" : ""}
          </Text>
        </Row>
      ) : null}

      <Row label="cwd">
        <Text>{shortPath(process.cwd())}</Text>
      </Row>
    </Box>
  );
}

function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Box>
      <Box width={10}>
        <Text dimColor>{label}</Text>
      </Box>
      {children}
    </Box>
  );
}

function shortPath(p: string): string {
  const home = process.env["HOME"] ?? "";
  if (home && p.startsWith(home)) {
    return `~${p.slice(home.length)}`;
  }
  return p;
}
