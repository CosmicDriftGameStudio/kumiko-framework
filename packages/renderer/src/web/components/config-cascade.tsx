import type {
  ConfigCascade,
  ConfigCascadeLevel,
  ConfigScope,
  ConfigValueSource,
} from "@cosmicdrift/kumiko-framework/engine";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import { usePrimitives, useTranslation } from "../../index.ts";
import { Icon } from "../icons.tsx";
import { cn } from "../lib/cn.ts";

const SOURCE_I18N_KEY: Record<ConfigValueSource, string> = {
  "user-row": "kumiko.config.source.user",
  "tenant-row": "kumiko.config.source.tenant",
  "system-row": "kumiko.config.source.system",
  "app-override": "kumiko.config.source.appOverride",
  computed: "kumiko.config.source.computed",
  default: "kumiko.config.source.default",
  missing: "kumiko.config.source.missing",
};

// Fallback order of the cascade, with the most specific source first.
// Comparing indices with the screen-scope source determines which
// levels a non-operator may see.
const SOURCE_ORDER: readonly ConfigValueSource[] = [
  "user-row",
  "tenant-row",
  "system-row",
  "app-override",
  "computed",
  "default",
  "missing",
];

type CascadeValueRenderer = (value: string | number | boolean) => ReactNode;

function formatValue(
  value: string | number | boolean | undefined,
  hasValue: boolean,
  t: (key: string) => string,
  renderValue?: CascadeValueRenderer,
): ReactNode {
  if (!hasValue || value === undefined) return t("kumiko.config.cascade.noValue");
  if (renderValue !== undefined) return renderValue(value);
  if (typeof value === "boolean")
    return t(value ? "kumiko.config.cascade.on" : "kumiko.config.cascade.off");
  return String(value);
}

// The origin sentence interpolates the fallback value, which can be a node (a
// select's option label resolved by a query), so the translated template is
// split at a marker instead of interpolating a string.
const VALUE_MARKER = "\u0000";

function interpolateValue(template: string, value: ReactNode): ReactNode {
  const markerIndex = template.indexOf(VALUE_MARKER);
  if (markerIndex === -1) return template;
  return (
    <>
      {template.slice(0, markerIndex)}
      {value}
      {template.slice(markerIndex + VALUE_MARKER.length)}
    </>
  );
}

function scopeToSource(scope: ConfigScope): ConfigValueSource {
  if (scope === "user") return "user-row";
  if (scope === "tenant") return "tenant-row";
  return "system-row";
}

// In the displayed cascade, levels above the screen scope are collapsed
// into a single neutral "Default" row for non-operator screens—the value
// remains visible, but not the operator source.
type DisplayLevel = {
  readonly level: ConfigCascadeLevel;
  readonly badgeSource: ConfigValueSource;
  readonly badgeLabelKey?: string;
};

function toDisplayLevels(
  levels: readonly ConfigCascadeLevel[],
  screenScopeSource: ConfigValueSource,
): readonly DisplayLevel[] {
  // System screens have operator visibility, so the full cascade, including
  // app-override/computed/default, remains visible.
  if (screenScopeSource === "system-row") {
    return levels.map((level) => ({ level, badgeSource: level.source }));
  }
  const scopeIdx = SOURCE_ORDER.indexOf(screenScopeSource);
  const own = levels.filter((l) => SOURCE_ORDER.indexOf(l.source) <= scopeIdx);
  const higher = levels.filter((l) => SOURCE_ORDER.indexOf(l.source) > scopeIdx);
  // Exactly one fallback row: the active higher level (whose value the user
  // effectively receives), or the declared default/missing level.
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
      // Use one consistent term, "Standard" (DE) / "Default" (EN)—the same
      // key as the field-label badge (kumiko.config.source.default), so the
      // badge and cascade disclosure do not show two different words. The
      // screen scope cannot set or reset the operator levels (System/Override/
      // Computed), so they appear here neutrally as "Standard".
      badgeLabelKey: "kumiko.config.source.default",
    },
  ];
}

const OWN_LEVEL_ORIGIN_KEY: Record<ConfigScope, string> = {
  tenant: "kumiko.config.cascade.origin.tenant",
  user: "kumiko.config.cascade.origin.user",
  system: "kumiko.config.cascade.origin.system",
};

// A missing or empty default reads as "Default is ." — drop the clause instead.
const OWN_LEVEL_ORIGIN_NO_DEFAULT_KEY: Record<ConfigScope, string> = {
  tenant: "kumiko.config.cascade.originNoDefault.tenant",
  user: "kumiko.config.cascade.originNoDefault.user",
  system: "kumiko.config.cascade.originNoDefault.system",
};

type ConfigCascadeViewProps = {
  readonly cascade: ConfigCascade;
  readonly screenScope: ConfigScope;
  readonly onReset?: (key: string, scope: ConfigScope) => void;
  readonly qualifiedKey?: string;
  readonly required?: boolean;
  readonly renderValue?: CascadeValueRenderer;
};

export function ConfigCascadeView({
  cascade,
  screenScope,
  onReset,
  qualifiedKey,
  required = false,
  renderValue,
}: ConfigCascadeViewProps): ReactNode {
  const t = useTranslation();
  const { Button } = usePrimitives();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  // Safety net: callers should already filter malformed cascades, but
  // a missing levels-array (e.g. from a partial mock) shouldn't crash
  // the screen.
  if (!Array.isArray(cascade?.levels)) return null;

  const screenScopeSource = scopeToSource(screenScope);
  const displayLevels = toDisplayLevels(cascade.levels, screenScopeSource);
  const activeDisplay = displayLevels.find((d) => d.level.isActive);
  const hasOverride = activeDisplay?.level.source === screenScopeSource;
  // Expandable only when the panel provides meaningful additional information:
  // an own override (→ Reset) or more than one level with a value. Empty levels
  // (e.g. the unset tenant-row of a field using only its default) do not count;
  // otherwise a field showing only its default would incorrectly be expandable,
  // making the panel merely repeat the trigger.
  const valuedLevels = displayLevels.filter((d) => d.level.hasValue);
  const expandable = hasOverride || valuedLevels.length > 1;
  const isUnset = activeDisplay === undefined || !activeDisplay.level.hasValue;

  // The value the field falls back to if this level is reset: the next level
  // below the active one that holds a value.
  const activeIndex = activeDisplay === undefined ? -1 : displayLevels.indexOf(activeDisplay);
  const fallbackLevel = displayLevels.slice(activeIndex + 1).find((d) => d.level.hasValue)?.level;
  const fallbackValue =
    fallbackLevel === undefined || fallbackLevel.value === ""
      ? undefined
      : formatValue(fallbackLevel.value, true, t, renderValue);

  const origin = hasOverride
    ? {
        text:
          fallbackValue === undefined
            ? t(OWN_LEVEL_ORIGIN_NO_DEFAULT_KEY[screenScope])
            : interpolateValue(
                t(OWN_LEVEL_ORIGIN_KEY[screenScope], { value: VALUE_MARKER }),
                fallbackValue,
              ),
        className: "text-status-active",
      }
    : isUnset
      ? required
        ? {
            text: t("kumiko.config.cascade.notSetRequired"),
            className: "text-status-bad",
          }
        : {
            text: t("kumiko.config.cascade.noValue"),
            className: "text-muted-foreground",
          }
      : {
          text:
            screenScope === "system"
              ? t(SOURCE_I18N_KEY[activeDisplay.badgeSource])
              : t("kumiko.config.cascade.origin.default"),
          className: "text-muted-foreground",
        };

  return (
    <div className="flex flex-col gap-1 text-xs" data-testid="config-cascade">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        <span className={cn("inline-flex items-center gap-1.5", origin.className)}>
          {origin.text}
        </span>
        {hasOverride && onReset !== undefined && qualifiedKey !== undefined ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onReset(qualifiedKey, screenScope)}
            testId="config-cascade-reset"
            className="h-auto px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
          >
            {t(
              screenScope === "system"
                ? "kumiko.config.cascade.resetToApp"
                : "kumiko.config.cascade.resetTo",
            )}
          </Button>
        ) : null}
      </div>
      {expandable && (cascade.levels.length > 2 || screenScope === "system") ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          {...(expanded && { "aria-controls": panelId })}
          className="inline-flex cursor-pointer items-center gap-1 self-start rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon
            name="chevron-right"
            className={cn(
              "size-3.5 transition-transform motion-reduce:transition-none",
              expanded && "rotate-90",
            )}
          />
          {t(expanded ? "kumiko.config.cascade.hideLevels" : "kumiko.config.cascade.showLevels")}
        </button>
      ) : null}
      {expanded && expandable && (cascade.levels.length > 2 || screenScope === "system") ? (
        <ul id={panelId} className="flex flex-col gap-0.5 border-l border-border pl-3">
          {displayLevels.map((display) => (
            <CascadeLevelRow
              key={display.level.source}
              display={display}
              {...(renderValue !== undefined && { renderValue })}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CascadeLevelRow({
  display,
  renderValue,
}: {
  display: DisplayLevel;
  renderValue?: CascadeValueRenderer;
}): ReactNode {
  const t = useTranslation();
  const { level } = display;
  return (
    <li
      className={cn(
        "flex items-baseline gap-3",
        level.isActive ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <span className="w-28 shrink-0">
        {t(display.badgeLabelKey ?? SOURCE_I18N_KEY[display.badgeSource])}
      </span>
      <span className={cn(level.isActive && "font-medium")}>
        {formatValue(level.value, level.hasValue, t, renderValue)}
      </span>
      {level.isActive ? (
        <span className="text-primary">{t("kumiko.config.cascade.activeMarker")}</span>
      ) : null}
    </li>
  );
}
