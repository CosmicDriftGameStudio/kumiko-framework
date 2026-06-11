import type { ConfigValueSource } from "@cosmicdrift/kumiko-framework/engine";
import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";

const SOURCE_CONFIG: Record<ConfigValueSource, { labelKey: string; bg: string; text: string }> = {
  "user-row": { labelKey: "kumiko.config.source.user", bg: "#dbeafe", text: "#1e40af" },
  "tenant-row": { labelKey: "kumiko.config.source.tenant", bg: "#dcfce7", text: "#166534" },
  "system-row": { labelKey: "kumiko.config.source.system", bg: "#f3e8ff", text: "#6b21a8" },
  "app-override": { labelKey: "kumiko.config.source.appOverride", bg: "#ffedd5", text: "#9a3412" },
  computed: { labelKey: "kumiko.config.source.computed", bg: "#ccfbf1", text: "#115e59" },
  default: { labelKey: "kumiko.config.source.default", bg: "#f3f4f6", text: "#4b5563" },
  missing: { labelKey: "kumiko.config.source.missing", bg: "#fee2e2", text: "#991b1b" },
};

export function ConfigSourceBadge({ source }: { readonly source: ConfigValueSource }): ReactNode {
  const t = useTranslation();
  const cfg = SOURCE_CONFIG[source];

  return (
    <span
      data-testid="config-source-badge"
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
      {t(cfg.labelKey)}
    </span>
  );
}
