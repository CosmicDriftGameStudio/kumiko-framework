import { spawn } from "node:child_process";
import { Box, Static, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { TuiCommand } from "./types";

const SCROLLBACK_LINES = 200;

type Phase = "running" | "exited";

export function OutputPanel({
  cmd,
  onBack,
}: {
  readonly cmd: TuiCommand;
  readonly onBack: () => void;
}): ReactNode {
  const [lines, setLines] = useState<readonly string[]>([]);
  const [phase, setPhase] = useState<Phase>("running");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const pidRef = useRef<number | null>(null);
  const { exit } = useApp();

  useEffect(() => {
    // Spawn yarn kumiko <cmd>. cwd = process.cwd() — der User hat den
    // TUI von dort gestartet, also dort soll der Child laufen.
    const child = spawn("yarn", ["kumiko", ...cmd.argv], {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "1" },
    });
    pidRef.current = child.pid ?? null;

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString("utf-8");
      const newLines = text.split("\n").filter((l) => l.length > 0);
      setLines((prev) => {
        const next = [...prev, ...newLines];
        return next.length > SCROLLBACK_LINES ? next.slice(-SCROLLBACK_LINES) : next;
      });
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      setPhase("exited");
      setExitCode(code);
    });

    return () => {
      // Caller-cleanup beim Unmount — wenn User vorzeitig zurück geht,
      // den Child-Process killen damit kein Zombie bleibt.
      if (child.exitCode === null) {
        child.kill("SIGTERM");
      }
    };
  }, [cmd]);

  useInput((input, key) => {
    if (phase === "exited") {
      if (key.return || input === "q" || key.escape) onBack();
    } else {
      if (input === "q" || key.escape) {
        // Während-Lauf: SIGTERM dem Child schicken, dann beenden.
        if (pidRef.current !== null) {
          try {
            process.kill(pidRef.current, "SIGTERM");
          } catch {
            // Race: child already exited
          }
        }
        exit();
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ▶ kumiko {cmd.argv.join(" ")}
        </Text>
        <Text dimColor> — {cmd.description}</Text>
      </Box>

      <Static items={lines as string[]}>
        {(line, idx) => (
          <Text key={idx} dimColor={line.startsWith("  ") && !line.includes("PASS") && !line.includes("FAIL")}>
            {line}
          </Text>
        )}
      </Static>

      <Box marginTop={1}>
        {phase === "running" ? (
          <Text color="yellow">
            <Spinner /> läuft… (q oder Esc zum Abbrechen)
          </Text>
        ) : exitCode === 0 ? (
          <Text color="green">✓ Done — Enter/q zurück zur Liste</Text>
        ) : (
          <Text color="red">✗ Exit {exitCode ?? "?"} — Enter/q zurück zur Liste</Text>
        )}
      </Box>
    </Box>
  );
}
