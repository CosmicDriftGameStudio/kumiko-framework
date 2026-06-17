import type {
  ConfigCascade,
  ConfigCascadeLevel,
  ConfigScope,
  ConfigValueSource,
} from "@cosmicdrift/kumiko-framework/engine";
import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { useState } from "react";

const SOURCE_I18N_KEY: Record<ConfigValueSource, string> = {
  "user-row": "kumiko.config.source.user",
  "tenant-row": "kumiko.config.source.tenant",
  "system-row": "kumiko.config.source.system",
  "app-override": "kumiko.config.source.appOverride",
  computed: "kumiko.config.source.computed",
  default: "kumiko.config.source.default",
  missing: "kumiko.config.source.missing",
};

const SOURCE_COLORS: Record<ConfigValueSource, string> = {
  "user-row": "text-blue-600 bg-blue-50 border-blue-200",
  "tenant-row": "text-green-600 bg-green-50 border-green-200",
  "system-row": "text-purple-600 bg-purple-50 border-purple-200",
  "app-override": "text-orange-600 bg-orange-50 border-orange-200",
  computed: "text-teal-600 bg-teal-50 border-teal-200",
  default: "text-gray-500 bg-gray-50 border-gray-200",
  missing: "text-red-500 bg-red-50 border-red-200",
};

// Fallback-Reihenfolge der Cascade, spezifischste Quelle zuerst.
// Index-Vergleich gegen die Screen-Scope-Quelle entscheidet, welche
// Ebenen ein Nicht-Operator sehen darf.
const SOURCE_ORDER: readonly ConfigValueSource[] = [
  "user-row",
  "tenant-row",
  "system-row",
  "app-override",
  "computed",
  "default",
  "missing",
];

function SourceBadge({
  source,
  labelKey,
}: {
  source: ConfigValueSource;
  labelKey?: string;
}): ReactNode {
  const t = useTranslation();
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${SOURCE_COLORS[source]}`}
    >
      {t(labelKey ?? SOURCE_I18N_KEY[source])}
    </span>
  );
}

function formatValue(value: string | number | boolean | undefined, hasValue: boolean): string {
  if (!hasValue || value === undefined) return "—";
  return String(value);
}

function scopeToSource(scope: ConfigScope): ConfigValueSource {
  if (scope === "user") return "user-row";
  if (scope === "tenant") return "tenant-row";
  return "system-row";
}

// Eine Cascade-Zeile in Anzeige-Form: Ebenen oberhalb des Screen-Scopes
// werden für Nicht-Operator-Screens zu EINER neutralen "Vorgabe"-Zeile
// kollabiert — der Wert bleibt sichtbar, die Operator-Quelle nicht.
type DisplayLevel = {
  readonly level: ConfigCascadeLevel;
  readonly badgeSource: ConfigValueSource;
  readonly badgeLabelKey?: string;
};

function toDisplayLevels(
  levels: readonly ConfigCascadeLevel[],
  screenScopeSource: ConfigValueSource,
): readonly DisplayLevel[] {
  // System-Screens sind Operator-Sicht — volle Cascade inkl.
  // app-override/computed/default bleibt sichtbar.
  if (screenScopeSource === "system-row") {
    return levels.map((level) => ({ level, badgeSource: level.source }));
  }
  const scopeIdx = SOURCE_ORDER.indexOf(screenScopeSource);
  const own = levels.filter((l) => SOURCE_ORDER.indexOf(l.source) <= scopeIdx);
  const higher = levels.filter((l) => SOURCE_ORDER.indexOf(l.source) > scopeIdx);
  // Genau eine Fallback-Zeile: die aktive höhere Ebene (deren Wert der
  // User effektiv bekommt), sonst der deklarierte Default/Missing.
  const fallback =
    higher.find((l) => l.isActive) ??
    higher.find((l) => l.source === "default" || l.source === "missing");
  const ownRows: DisplayLevel[] = own.map((level) => ({ level, badgeSource: level.source }));
  if (fallback === undefined) return ownRows;
  return [
    ...ownRows,
    {
      level: fallback,
      badgeSource: "default",
      // Ein durchgängiger Begriff "Standard" (DE) / "Default" (EN) — derselbe
      // Key wie das Feld-Label-Badge (kumiko.config.source.default), damit
      // Badge + Cascade-Disclosure NICHT zwei verschiedene Wörter zeigen
      // (Bug-Bash 3 #11). Der Screen-Scope kann die Operator-Ebenen
      // (System/Override/Computed) weder setzen noch zurücksetzen, deshalb
      // erscheinen sie hier neutral als "Standard".
      badgeLabelKey: "kumiko.config.source.default",
    },
  ];
}

type ConfigCascadeViewProps = {
  readonly cascade: ConfigCascade;
  readonly screenScope: ConfigScope;
  readonly onReset?: (key: string, scope: ConfigScope) => void;
  readonly qualifiedKey?: string;
  // Component-Split (#429): "trigger" rendert nur die collapsed-Zeile
  // (▶ + Quelle + Wert) für die Label-Row, "panel" nur die aufgeklappte
  // Cascade + Reset für unter den Input. Im Split-Modus hält der Screen den
  // expanded-State (beide Slots teilen ihn). Ohne `slot` rendert die
  // Komponente beides mit eigenem State (Backward-Compat).
  readonly slot?: "trigger" | "panel";
  readonly expanded?: boolean;
  readonly onToggle?: () => void;
};

export function ConfigCascadeView({
  cascade,
  screenScope,
  onReset,
  qualifiedKey,
  slot,
  expanded: expandedProp,
  onToggle,
}: ConfigCascadeViewProps): ReactNode {
  const t = useTranslation();
  const [localExpanded, setLocalExpanded] = useState(false);

  // Safety net: callers should already filter malformed cascades, but
  // a missing levels-array (e.g. from a partial mock) shouldn't crash
  // the screen.
  if (!Array.isArray(cascade?.levels)) return null;

  const expanded = slot === undefined ? localExpanded : (expandedProp ?? false);
  const toggle = slot === undefined ? () => setLocalExpanded((v) => !v) : onToggle;

  const screenScopeSource = scopeToSource(screenScope);
  const displayLevels = toDisplayLevels(cascade.levels, screenScopeSource);
  const activeDisplay = displayLevels.find((d) => d.level.isActive);
  const hasOverride = activeDisplay?.level.source === screenScopeSource;
  // Aufklappbar nur wenn das Panel echten Mehrwert bringt: ein eigener
  // Override (→ Reset) oder mehr als eine Ebene MIT Wert. Leere Ebenen
  // (z.B. die ungesetzte tenant-row eines reinen Default-Felds) zählen
  // nicht — sonst wäre ein Feld, das nur seinen Standard zeigt, fälschlich
  // aufklappbar und das Panel nur eine Wiederholung des Triggers.
  const valuedLevels = displayLevels.filter((d) => d.level.hasValue);
  const expandable = hasOverride || valuedLevels.length > 1;

  const triggerInner = activeDisplay ? (
    <>
      <SourceBadge
        source={activeDisplay.badgeSource}
        {...(activeDisplay.badgeLabelKey !== undefined && {
          labelKey: activeDisplay.badgeLabelKey,
        })}
      />
      <span className="text-gray-400">
        {formatValue(activeDisplay.level.value, activeDisplay.level.hasValue)}
      </span>
    </>
  ) : (
    <span className="text-gray-400">{t("kumiko.config.cascade.noValue")}</span>
  );

  const trigger = expandable ? (
    <button
      type="button"
      onClick={toggle}
      className="flex items-center gap-1 text-gray-500 hover:text-gray-700 cursor-pointer"
    >
      <span className="text-[10px]">{expanded ? "▼" : "▶"}</span>
      {triggerInner}
    </button>
  ) : (
    <div className="flex items-center gap-1 text-gray-500">{triggerInner}</div>
  );

  const panel =
    expanded && expandable ? (
      <div className="mt-1 flex flex-col gap-0.5 pl-3 border-l-2 border-gray-100">
        {displayLevels.map((display) => (
          <CascadeLevelRow key={display.level.source} display={display} />
        ))}

        {hasOverride && onReset && qualifiedKey ? (
          <button
            type="button"
            onClick={() => onReset(qualifiedKey, screenScope)}
            className="mt-1 self-start text-[10px] text-orange-500 hover:text-orange-700 cursor-pointer underline"
          >
            {t("kumiko.config.cascade.resetTo", {
              scope: t(SOURCE_I18N_KEY[screenScopeSource]),
            })}
          </button>
        ) : null}
      </div>
    ) : null;

  if (slot === "trigger") {
    return (
      <div className="text-xs font-normal" data-testid="config-cascade">
        {trigger}
      </div>
    );
  }
  if (slot === "panel") return panel;

  // Backward-Compat (ungeteilt): Trigger + Panel zusammen unter dem Input.
  return (
    <div className="mt-1 text-xs" data-testid="config-cascade">
      {trigger}
      {panel}
    </div>
  );
}

function CascadeLevelRow({ display }: { display: DisplayLevel }): ReactNode {
  const t = useTranslation();
  const { level } = display;
  return (
    <div
      className={`flex items-center gap-1.5 ${level.isActive ? "font-medium" : "text-gray-400"}`}
    >
      <SourceBadge
        source={display.badgeSource}
        {...(display.badgeLabelKey !== undefined && { labelKey: display.badgeLabelKey })}
      />
      <span>{formatValue(level.value, level.hasValue)}</span>
      {level.isActive ? (
        <span className="text-[10px] text-gray-400">{t("kumiko.config.cascade.activeMarker")}</span>
      ) : null}
    </div>
  );
}
