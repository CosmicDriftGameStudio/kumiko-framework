import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { theme } from "./theme";

export type Hotkey = { readonly key: string; readonly label: string };

export function StatusBar({ hotkeys }: { readonly hotkeys: ReadonlyArray<Hotkey> }): ReactNode {
  return (
    <Box paddingX={1}>
      {hotkeys.map((hk, idx) => (
        <Box key={hk.key} marginRight={idx === hotkeys.length - 1 ? 0 : 2}>
          <Text color={theme.accent} bold>
            {hk.key}
          </Text>
          <Text dimColor> {hk.label}</Text>
        </Box>
      ))}
    </Box>
  );
}
