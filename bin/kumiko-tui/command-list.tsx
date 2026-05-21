import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type { ReactNode } from "react";
import { SPIKE_COMMANDS, type TuiCommand } from "./types";

type Item = { label: string; value: string };

export function CommandList({
  onSelect,
}: {
  readonly onSelect: (cmd: TuiCommand) => void;
}): ReactNode {
  const items: Item[] = SPIKE_COMMANDS.map((c) => ({ label: c.label, value: c.id }));
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>kumiko</Text>
        <Text dimColor> — wähle einen Command (↑↓ + Enter, q zum Beenden)</Text>
      </Box>
      <SelectInput
        items={items}
        onSelect={(item) => {
          const cmd = SPIKE_COMMANDS.find((c) => c.id === item.value);
          if (cmd) onSelect(cmd);
        }}
        itemComponent={({ isSelected, label }) => {
          const item = items.find((i) => i.label === label);
          const cmd = item ? SPIKE_COMMANDS.find((c) => c.id === item.value) : undefined;
          return (
            <Box>
              <Text color={isSelected ? "cyan" : undefined}>
                {isSelected ? "▶ " : "  "}
                {label}
              </Text>
              {cmd && isSelected ? (
                <Box marginLeft={2}>
                  <Text dimColor>{cmd.description}</Text>
                </Box>
              ) : null}
            </Box>
          );
        }}
      />
    </Box>
  );
}
