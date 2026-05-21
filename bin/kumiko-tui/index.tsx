import { Box, useApp, useInput, useStdout } from "ink";
import { type ReactNode, useEffect, useState } from "react";
import { CommandList } from "./command-list";
import { OutputPanel, type OutputState } from "./output-panel";
import { Sidebar, type SidebarState } from "./sidebar";
import { StatusBar, type Hotkey } from "./status-bar";
import { collectSystemInfo, type SystemInfo } from "./system-info";
import { TitleBar } from "./title-bar";
import type { Role, TuiCommand } from "./types";

type Screen = { kind: "browse" } | { kind: "run"; cmd: TuiCommand; output: OutputState };

const BROWSE_HOTKEYS: ReadonlyArray<Hotkey> = [
  { key: "↑↓", label: "navigate" },
  { key: "Enter", label: "run" },
  { key: "q", label: "quit" },
];

const RUN_HOTKEYS: ReadonlyArray<Hotkey> = [
  { key: "q/Esc", label: "cancel" },
  { key: "Enter", label: "back (after exit)" },
];

function detectRole(): Role {
  const cwd = process.cwd();
  if (cwd.includes("/cosmicdriftgamestudio")) return "maintainer";
  return "app-dev";
}

function App({ sys }: { readonly sys: SystemInfo }): ReactNode {
  const role = detectRole();
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    cols: stdout.columns ?? 80,
    rows: stdout.rows ?? 24,
  });
  const [screen, setScreen] = useState<Screen>({ kind: "browse" });
  const [hovered, setHovered] = useState<TuiCommand | undefined>(undefined);
  const { exit } = useApp();

  useEffect(() => {
    const onResize = (): void => {
      setSize({ cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  useInput((input, key) => {
    if (screen.kind === "browse" && (input === "q" || key.escape)) {
      exit();
    }
  });

  const sidebarState: SidebarState =
    screen.kind === "browse"
      ? { kind: "browse", hovered }
      : {
          kind: "run",
          cmd: screen.cmd,
          elapsedSec: screen.output.elapsedSec,
          status:
            screen.output.phase === "running"
              ? "running"
              : screen.output.exitCode === 0
                ? "done"
                : "fail",
          exitCode: screen.output.exitCode,
        };

  return (
    <Box flexDirection="column" padding={1} width={size.cols} height={size.rows}>
      <TitleBar role={role} />

      <Box flexDirection="row" marginTop={1} flexGrow={1} gap={1} minHeight={0}>
        <Box flexDirection="column" flexGrow={1} minWidth={0}>
          {screen.kind === "browse" ? (
            <CommandList
              role={role}
              onSelect={(cmd) =>
                setScreen({
                  kind: "run",
                  cmd,
                  output: { phase: "running", exitCode: null, elapsedSec: 0 },
                })
              }
              onHover={setHovered}
            />
          ) : (
            <OutputPanel
              cmd={screen.cmd}
              onBack={() => setScreen({ kind: "browse" })}
              onStateChange={(s) =>
                setScreen((prev) => (prev.kind === "run" ? { ...prev, output: s } : prev))
              }
            />
          )}
        </Box>

        <Sidebar state={sidebarState} sys={sys} role={role} />
      </Box>

      <Box marginTop={1}>
        <StatusBar hotkeys={screen.kind === "browse" ? BROWSE_HOTKEYS : RUN_HOTKEYS} />
      </Box>
    </Box>
  );
}

const ENTER_ALT_SCREEN = "\x1b[?1049h";
const LEAVE_ALT_SCREEN = "\x1b[?1049l";
const CLEAR_AND_HOME = "\x1b[2J\x1b[H";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

export async function runTui(): Promise<void> {
  const sys = collectSystemInfo();

  process.stdout.write(ENTER_ALT_SCREEN + CLEAR_AND_HOME + HIDE_CURSOR);

  const restore = (): void => {
    process.stdout.write(SHOW_CURSOR + LEAVE_ALT_SCREEN);
  };
  process.on("exit", restore);
  process.on("SIGINT", () => {
    restore();
    process.exit(130);
  });

  const { render } = await import("ink");
  const instance = render(<App sys={sys} />);
  try {
    await instance.waitUntilExit();
  } finally {
    restore();
  }
}
