import { Box, Text, useInput } from "ink";
import { type ReactNode, useEffect, useState } from "react";
import { icons, theme } from "./theme";
import { type Category, type Role, SPIKE_COMMANDS, type TuiCommand } from "./types";

const CATEGORY_LABEL: Record<Category, string> = {
  lifecycle: "Lifecycle",
  quality: "Quality",
  code: "Code",
  ops: "Ops",
};

const CATEGORY_ORDER: ReadonlyArray<Category> = ["lifecycle", "quality", "code", "ops"];

export function CommandList({
  role,
  onSelect,
  onHover,
}: {
  readonly role: Role;
  readonly onSelect: (cmd: TuiCommand) => void;
  readonly onHover: (cmd: TuiCommand | undefined) => void;
}): ReactNode {
  // Filter by role + group by category. Stable flat index across groups
  // so ↑↓ navigation feels continuous (no reset between sections).
  const visible = SPIKE_COMMANDS.filter((c) => c.roles.includes(role));
  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: visible.filter((c) => c.category === cat),
  })).filter((g) => g.items.length > 0);

  const flat: ReadonlyArray<TuiCommand> = grouped.flatMap((g) => g.items);
  const [cursor, setCursor] = useState(0);

  // Initial hover-broadcast — sidebar populates on mount.
  useEffect(() => {
    onHover(flat[0]);
  }, []);

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      const next = cursor === 0 ? flat.length - 1 : cursor - 1;
      setCursor(next);
      onHover(flat[next]);
    } else if (key.downArrow || input === "j") {
      const next = (cursor + 1) % flat.length;
      setCursor(next);
      onHover(flat[next]);
    } else if (key.return) {
      const cmd = flat[cursor];
      if (cmd) onSelect(cmd);
    }
  });

  let runningIndex = 0;
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={1}
      flexGrow={1}
    >
      {grouped.map((group) => (
        <Box key={group.cat} flexDirection="column" marginBottom={1}>
          <Text dimColor>── {CATEGORY_LABEL[group.cat]} ──</Text>
          {group.items.map((item) => {
            const i = runningIndex++;
            const isSelected = i === cursor;
            return (
              <Box key={item.id}>
                <Text color={isSelected ? theme.accent : undefined} bold={isSelected}>
                  {isSelected ? `${icons.cursor} ` : "  "}
                  {item.label}
                </Text>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
