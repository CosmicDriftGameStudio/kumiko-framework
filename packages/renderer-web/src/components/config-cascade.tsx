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
  "user-row": "config.source.user",
  "tenant-row": "config.source.tenant",
  "system-row": "config.source.system",
  "app-override": "config.source.appOverride",
  computed: "config.source.computed",
  default: "config.source.default",
  missing: "config.source.missing",
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

function SourceBadge({ source }: { source: ConfigValueSource }): ReactNode {
  const t = useTranslation();
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${SOURCE_COLORS[source]}`}
    >
      {t(SOURCE_I18N_KEY[source])}
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

type ConfigCascadeViewProps = {
  readonly cascade: ConfigCascade;
  readonly screenScope: ConfigScope;
  readonly onReset?: (key: string, scope: ConfigScope) => void;
  readonly qualifiedKey?: string;
};

export function ConfigCascadeView({
  cascade,
  screenScope,
  onReset,
  qualifiedKey,
}: ConfigCascadeViewProps): ReactNode {
  const t = useTranslation();
  const [expanded, setExpanded] = useState(false);

  // Safety net: callers should already filter malformed cascades, but
  // a missing levels-array (e.g. from a partial mock) shouldn't crash
  // the screen.
  if (!Array.isArray(cascade?.levels)) return null;

  const activeLevel = cascade.levels.find((l) => l.isActive);
  const screenScopeSource = scopeToSource(screenScope);
  const hasOverride = activeLevel?.source === screenScopeSource;

  return (
    <div className="mt-1 text-xs">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-gray-500 hover:text-gray-700 cursor-pointer"
      >
        <span className="text-[10px]">{expanded ? "▼" : "▶"}</span>
        {activeLevel ? (
          <>
            <SourceBadge source={activeLevel.source} />
            <span className="text-gray-400">{formatValue(activeLevel.value, activeLevel.hasValue)}</span>
          </>
        ) : (
          <span className="text-gray-400">{t("config.cascade.noValue")}</span>
        )}
      </button>

      {expanded ? (
        <div className="mt-1 flex flex-col gap-0.5 pl-3 border-l-2 border-gray-100">
          {cascade.levels.map((level) => (
            <CascadeLevelRow key={level.source} level={level} />
          ))}

          {hasOverride && onReset && qualifiedKey ? (
            <button
              type="button"
              onClick={() => onReset(qualifiedKey, screenScope)}
              className="mt-1 self-start text-[10px] text-orange-500 hover:text-orange-700 cursor-pointer underline"
            >
              {t("config.cascade.resetTo", { scope: t(SOURCE_I18N_KEY[screenScopeSource]) })}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CascadeLevelRow({ level }: { level: ConfigCascadeLevel }): ReactNode {
  const t = useTranslation();
  return (
    <div className={`flex items-center gap-1.5 ${level.isActive ? "font-medium" : "text-gray-400"}`}>
      <SourceBadge source={level.source} />
      <span>{formatValue(level.value, level.hasValue)}</span>
      {level.isActive ? (
        <span className="text-[10px] text-gray-400">{t("config.cascade.activeMarker")}</span>
      ) : null}
    </div>
  );
}
