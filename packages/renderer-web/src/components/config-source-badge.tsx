import type { ConfigScope, ConfigValueSource } from "@cosmicdrift/kumiko-framework/engine";
import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

const SOURCE_LABEL_KEY: Record<ConfigValueSource, string> = {
  "user-row": "kumiko.config.source.user",
  "tenant-row": "kumiko.config.source.tenant",
  "system-row": "kumiko.config.source.system",
  "app-override": "kumiko.config.source.appOverride",
  computed: "kumiko.config.source.computed",
  default: "kumiko.config.source.default",
  missing: "kumiko.config.source.missing",
};

// Two states only: set on a scope row (accent) vs. inherited/default (neutral);
// a missing value is the one status colour.
const ROW_SOURCES: ReadonlySet<ConfigValueSource> = new Set([
  "user-row",
  "tenant-row",
  "system-row",
]);

function badgeToneClass(source: ConfigValueSource): string {
  if (source === "missing") return "bg-status-bad-surface text-status-bad";
  return ROW_SOURCES.has(source) ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground";
}

const SOURCE_ORDER: readonly ConfigValueSource[] = [
  "user-row",
  "tenant-row",
  "system-row",
  "app-override",
  "computed",
  "default",
  "missing",
];

function scopeToSource(scope: ConfigScope): ConfigValueSource {
  if (scope === "user") return "user-row";
  if (scope === "tenant") return "tenant-row";
  return "system-row";
}

export function ConfigSourceBadge({
  source,
  screenScope,
}: {
  readonly source: ConfigValueSource;
  readonly screenScope?: ConfigScope;
}): ReactNode {
  const t = useTranslation();
  // Gleiche Kollaps-Regel wie toDisplayLevels (config-cascade.tsx):
  // Operator-Quellen oberhalb des Screen-Scopes erscheinen für Nicht-
  // Operator-Screens als neutrales "Vorgabe"-Badge — sonst leakte das
  // Badge die System-Quelle, die die Cascade-View bewusst versteckt.
  let effective = source;
  if (screenScope !== undefined && screenScope !== "system") {
    const scopeIdx = SOURCE_ORDER.indexOf(scopeToSource(screenScope));
    if (SOURCE_ORDER.indexOf(source) > scopeIdx && source !== "missing") {
      effective = "default";
    }
  }

  return (
    <span
      data-testid="config-source-badge"
      className={cn(
        "ml-1.5 inline-flex items-center whitespace-nowrap rounded px-1.5 text-[11px] font-medium leading-[18px]",
        badgeToneClass(effective),
      )}
    >
      {t(SOURCE_LABEL_KEY[effective])}
    </span>
  );
}
