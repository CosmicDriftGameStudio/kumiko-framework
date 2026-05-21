// Charm.sh-inspired palette for the TUI. Sparingly used accent colors
// (cyan = identity, yellow = active/running, green = success, red =
// error). Borders rounded, inactive panes dimmed. Emojis as visual
// anchors — keep them few so they don't compete with the content.

export const theme = {
  accent: "cyan",
  warn: "yellow",
  ok: "green",
  err: "red",
  muted: "gray",
} as const;

export const icons = {
  brand: "✨",
  cursor: "▸",
  running: "⚡",
  done: "✓",
  fail: "✗",
  back: "◂",
} as const;

export type Theme = typeof theme;
