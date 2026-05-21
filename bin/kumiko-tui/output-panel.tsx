import { spawn, type ChildProcess } from "node:child_process";
import { resolve as resolvePath } from "node:path";
import { Box, Text, useApp, useInput } from "ink";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { theme } from "./theme";
import type { TuiCommand } from "./types";

const SCROLLBACK_LINES = 500;

// kumiko.ts liegt im Geschwister-Verzeichnis (bin/kumiko.ts). Direkter
// Aufruf via process.execPath statt `yarn kumiko <cmd>`, damit spawn
// vom cwd des Users unabhängig ist — wenn er `kumiko` global aufruft,
// ist sein cwd irgendwo, und `yarn run kumiko` würde dort scheitern.
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
  const childRef = useRef<ChildProcess | null>(null);
  const { exit } = useApp();

  // Spawn the child + wire its output. Re-spawns when `cmd` changes.
  useEffect(() => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [KUMIKO_SCRIPT, ...cmd.argv], {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "1" },
    });
    childRef.current = child;
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

  useInput((input, key) => {
    if (phase === "exited") {
      if (key.return || input === "q" || key.escape) onBack();
    } else if (input === "q" || key.escape) {
      childRef.current?.kill("SIGTERM");
      exit();
    }
  });

  // Render only the last N lines visually — bigger buffer in memory
  // for scrollback-history, but viewport stays terminal-sized.
  const visible = lines.slice(-40);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={phase === "running" ? theme.warn : exitCode === 0 ? theme.ok : theme.err}
      paddingX={1}
      flexGrow={1}
    >
      {visible.map((line, idx) => (
        <Text key={idx}>{line}</Text>
      ))}
      <Box marginTop={1}>
        <Text dimColor>
          {phase === "running"
            ? `⏱  ${elapsed.toFixed(1)}s — q/Esc abbrechen`
            : `done in ${elapsed.toFixed(1)}s — Enter/q zurück`}
        </Text>
      </Box>
    </Box>
  );
}
