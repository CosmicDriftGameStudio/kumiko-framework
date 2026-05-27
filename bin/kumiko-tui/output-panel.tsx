import { spawn, type ChildProcess } from "node:child_process";
import { resolve as resolvePath } from "node:path";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { theme } from "./theme";
import type { TuiCommand } from "./types";

const SCROLLBACK_LINES = 2000;
// Reserved rows for TitleBar (~11), StatusBar (~2), borders, footer.
// Used to derive the viewport-size from `stdout.rows` so the scroll
// position aligns with what's actually visible.
const CHROME_ROWS = 18;

// kumiko.ts liegt im Geschwister-Verzeichnis (bin/kumiko.ts). Direkter
// Aufruf via process.execPath statt `bun kumiko <cmd>`, damit spawn
// vom cwd des Users unabhängig ist — wenn er `kumiko` global aufruft,
// ist sein cwd irgendwo, und `bun kumiko` würde dort scheitern.
const KUMIKO_SCRIPT = resolvePath(import.meta.dir, "..", "kumiko.ts");

type Phase = "running" | "exited";

export type OutputState = {
  readonly phase: Phase;
  readonly exitCode: number | null;
  readonly elapsedSec: number;
};

export function OutputPanel({
  cmd,
  onBack,
  onStateChange,
}: {
  readonly cmd: TuiCommand;
  readonly onBack: () => void;
  readonly onStateChange: (s: OutputState) => void;
}): ReactNode {
  const [lines, setLines] = useState<readonly string[]>([]);
  const [phase, setPhase] = useState<Phase>("running");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // scrollOffset = number of lines hidden below the viewport. 0 = follow
  // tail, >0 = user scrolled up. Auto-follow stays on while at 0.
  const [scrollOffset, setScrollOffset] = useState(0);
  const childRef = useRef<ChildProcess | null>(null);
  const { exit } = useApp();
  const { stdout } = useStdout();
  const viewport = Math.max(8, (stdout.rows ?? 30) - CHROME_ROWS);

  // Spawn the child + wire its output. Re-spawns when `cmd` changes.
  useEffect(() => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [KUMIKO_SCRIPT, ...cmd.argv], {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "1" },
    });
    childRef.current = child;
    setLines([]);
    setScrollOffset(0);
    setPhase("running");
    setExitCode(null);
    onStateChange({ phase: "running", exitCode: null, elapsedSec: 0 });

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString("utf-8");
      // Split on newlines, drop empty trailing chunk. Preserve ANSI
      // escape codes — Ink's <Text> renders them as-is which is what
      // we want for chalk-coloured tool output.
      const newLines = text.split("\n");
      if (newLines.length > 0 && newLines[newLines.length - 1] === "") newLines.pop();
      setLines((prev) => {
        const next = [...prev, ...newLines];
        return next.length > SCROLLBACK_LINES ? next.slice(-SCROLLBACK_LINES) : next;
      });
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => {
      const final = Math.max(0, (Date.now() - startedAt) / 1000);
      setPhase("exited");
      setExitCode(code);
      setElapsed(final);
      onStateChange({ phase: "exited", exitCode: code, elapsedSec: final });
    });

    // Tick elapsed counter while running.
    const tick = setInterval(() => {
      if (child.exitCode === null) {
        const seconds = (Date.now() - startedAt) / 1000;
        setElapsed(seconds);
        onStateChange({ phase: "running", exitCode: null, elapsedSec: seconds });
      }
    }, 200);

    return () => {
      clearInterval(tick);
      if (child.exitCode === null) child.kill("SIGTERM");
    };
  }, [cmd]);

  const maxOffset = Math.max(0, lines.length - viewport);

  // Pin scroll position while user has scrolled up. Without this, every
  // new chunk of stdout would drag the visible region down and the
  // reader would lose their place.
  const prevLinesLen = useRef(lines.length);
  useEffect(() => {
    const delta = lines.length - prevLinesLen.current;
    prevLinesLen.current = lines.length;
    if (delta > 0 && scrollOffset > 0) {
      setScrollOffset((o) => Math.min(maxOffset, o + delta));
    }
  }, [lines.length, scrollOffset, maxOffset]);

  useInput((input, key) => {
    // Scroll handling — works in both running and exited phases.
    if (key.upArrow || input === "k") {
      setScrollOffset((o) => Math.min(maxOffset, o + 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setScrollOffset((o) => Math.max(0, o - 1));
      return;
    }
    if (key.pageUp || input === "u") {
      setScrollOffset((o) => Math.min(maxOffset, o + Math.floor(viewport / 2)));
      return;
    }
    if (key.pageDown || input === "d") {
      setScrollOffset((o) => Math.max(0, o - Math.floor(viewport / 2)));
      return;
    }
    if (input === "g") {
      setScrollOffset(maxOffset);
      return;
    }
    if (input === "G") {
      setScrollOffset(0);
      return;
    }
    // Cancel / back keys come last so scroll keys don't fall through.
    if (phase === "exited") {
      if (key.return || input === "q" || key.escape) onBack();
    } else if (input === "q" || key.escape) {
      childRef.current?.kill("SIGTERM");
      exit();
    }
  });

  // viewport-sized slice ending `scrollOffset` lines above the tail.
  const end = lines.length - scrollOffset;
  const start = Math.max(0, end - viewport);
  const visible = lines.slice(start, end);
  const isTail = scrollOffset === 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={phase === "running" ? theme.warn : exitCode === 0 ? theme.ok : theme.err}
      paddingX={1}
      flexGrow={1}
    >
      {visible.map((line, idx) => (
        <Text key={start + idx}>{line}</Text>
      ))}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          {phase === "running"
            ? `⏱  ${elapsed.toFixed(1)}s — q/Esc to cancel`
            : `done in ${elapsed.toFixed(1)}s — Enter/q to go back`}
        </Text>
        <Text dimColor>
          {isTail
            ? `↑/↓ k/j scroll · u/d page · g top · ${lines.length} line${lines.length === 1 ? "" : "s"}`
            : `line ${start + 1}-${end} / ${lines.length}  ·  G to follow tail`}
        </Text>
      </Box>
    </Box>
  );
}
