// @runtime client
import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { cn, SectionCard, UploadZone } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import type { VariableInfo, VariableType } from "./types.js";

const TYPE_GLYPHS: Readonly<Record<VariableType, string>> = {
  text: "T",
  money: "€",
  date: "D",
  link: "↗",
  list: "≡",
};

// unsubscribeUrl belongs to mail; the PDF designer never offers it.
const HIDDEN_SYSTEM_PLACEHOLDERS: ReadonlySet<string> = new Set(["unsubscribeUrl"]);

export type SystemPlaceholderRow = {
  readonly name: string;
  readonly label: string;
  readonly status: "used" | "layout" | "unused";
};

export type PlaceholderPanelProps = {
  readonly variables: Readonly<Record<string, VariableInfo>>;
  readonly used: readonly string[];
  readonly missingRequired: readonly string[];
  readonly systemRows: readonly SystemPlaceholderRow[];
  readonly resourceKeys: readonly string[];
  readonly canUpload: boolean;
  readonly layoutName: string;
  readonly onInsert: (name: string) => void;
  readonly onInsertResource: (key: string) => void;
  readonly onUpload: (file: File) => Promise<void>;
};

export function visibleSystemPlaceholders(names: readonly string[]): readonly string[] {
  return names.filter((name) => !HIDDEN_SYSTEM_PLACEHOLDERS.has(name));
}

export function PlaceholderPanel(props: PlaceholderPanelProps): ReactNode {
  const t = useTranslation();
  const { Button } = usePrimitives();
  const names = Object.keys(props.variables);

  return (
    <div className="flex flex-col gap-4" data-testid="document-designer-placeholders">
      <SectionCard title={t("documentDesigner.placeholders.title")}>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {names.map((name) => {
            const info = props.variables[name];
            if (info === undefined) return null;
            const missing = props.missingRequired.includes(name);
            const isUsed = props.used.includes(name);
            return (
              <li key={name}>
                <button
                  type="button"
                  data-testid={`placeholder-${name}`}
                  onClick={() => props.onInsert(name)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-sm",
                    missing
                      ? "border-status-bad bg-status-bad-surface"
                      : "border-border bg-background hover:bg-muted",
                  )}
                >
                  <span className="w-4 text-center text-xs text-muted-foreground">
                    {TYPE_GLYPHS[info.type]}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {info.label ?? name}
                    {info.required === true ? " *" : ""}
                  </span>
                  <span
                    className={cn(
                      "text-xs",
                      missing ? "font-medium text-status-bad" : "text-muted-foreground",
                    )}
                  >
                    {missing ? t("documentDesigner.placeholders.missing") : isUsed ? "✓" : "–"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </SectionCard>

      <SectionCard title={t("documentDesigner.placeholders.system")}>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {props.systemRows.map((row) => (
            <li key={row.name}>
              <button
                type="button"
                data-testid={`system-placeholder-${row.name}`}
                onClick={() => props.onInsert(row.name)}
                className="flex w-full items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-left text-sm text-primary"
              >
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                <span className="text-xs">
                  {row.status === "used"
                    ? "✓"
                    : row.status === "layout"
                      ? t("documentDesigner.placeholders.fromLayout")
                      : "–"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title={t("documentDesigner.resources.title")}>
        {props.resourceKeys.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("documentDesigner.resources.empty")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 font-mono text-xs">
            {props.resourceKeys.map((key) => (
              <li key={key} className="flex items-center justify-between gap-2">
                <span className="truncate">{key}</span>
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => props.onInsertResource(key)}
                  ariaLabel={t("documentDesigner.resources.insertNamed", { key })}
                >
                  {t("documentDesigner.resources.insert")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {props.canUpload ? (
          <UploadZone
            multiple={false}
            accept={["image/png", "image/jpeg", "image/gif", "image/webp"]}
            title={t("documentDesigner.resources.upload")}
            onUpload={props.onUpload}
            testId="document-designer-upload"
          />
        ) : (
          <Button variant="secondary" size="sm" disabled>
            {t("documentDesigner.resources.upload")}
          </Button>
        )}
        {!props.canUpload && (
          <p className="text-xs text-muted-foreground">
            {t("documentDesigner.resources.saveFirst")}
          </p>
        )}
      </SectionCard>

      <p className="text-xs text-muted-foreground">
        {t("documentDesigner.placeholders.layoutHint", { layout: props.layoutName })}
      </p>
    </div>
  );
}
