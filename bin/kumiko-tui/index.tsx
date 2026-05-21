import { Box, useApp, useInput } from "ink";
import { type ReactNode, useState } from "react";
import { CommandList } from "./command-list";
import { OutputPanel } from "./output-panel";
import type { TuiCommand } from "./types";

type Screen = { kind: "browse" } | { kind: "run"; cmd: TuiCommand };

function App(): ReactNode {
  const [screen, setScreen] = useState<Screen>({ kind: "browse" });
  const { exit } = useApp();

  useInput((input, key) => {
    if (screen.kind === "browse" && (input === "q" || key.escape)) {
      exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      {screen.kind === "browse" ? (
        <CommandList onSelect={(cmd) => setScreen({ kind: "run", cmd })} />
      ) : (
        <OutputPanel cmd={screen.cmd} onBack={() => setScreen({ kind: "browse" })} />
      )}
    </Box>
  );
}

export async function runTui(): Promise<void> {
  // Ink wird dynamic geladen damit der headless `kumiko <cmd>`-Pfad nicht
  // zwingend Ink + React laden muss (~2 MB Module).
  const { render } = await import("ink");
  const instance = render(<App />);
  await instance.waitUntilExit();
}
