import type { ConfigValueSource } from "@cosmicdrift/kumiko-framework/engine";
import type { ReactNode } from "react";
import { usePrimitives } from "../primitives";

const SOURCE_CONFIG: Record<
  ConfigValueSource,
  { label: string; bg: string; text: string }
> = {
  "user-row": { label: "User", bg: "#dbeafe", text: "#1e40af" },
  "tenant-row": { label: "Tenant", bg: "#dcfce7", text: "#166534" },
  "system-row": { label: "System", bg: "#f3e8ff", text: "#6b21a8" },
  "app-override": { label: "Override", bg: "#ffedd5", text: "#9a3412" },
  computed: { label: "Computed", bg: "#ccfbf1", text: "#115e59" },
  default: { label: "Default", bg: "#f3f4f6", text: "#4b5563" },
  missing: { label: "Missing", bg: "#fee2e2", text: "#991b1b" },
};

export function ConfigSourceBadge({
  source,
}: {
  readonly source: ConfigValueSource;
}): ReactNode {
  const { Text } = usePrimitives();
  const cfg = SOURCE_CONFIG[source] ?? SOURCE_CONFIG.default;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0 6px",
        fontSize: "11px",
        fontWeight: 500,
        lineHeight: "18px",
        borderRadius: "4px",
        backgroundColor: cfg.bg,
        color: cfg.text,
        marginLeft: "6px",
        whiteSpace: "nowrap",
      }}
    >
      {cfg.label}
    </span>
  );
}
