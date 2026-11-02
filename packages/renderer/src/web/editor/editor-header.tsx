import type { ReactNode } from "react";
import { useTranslation } from "../../i18n.tsx";
import { usePrimitives } from "../../primitives.tsx";
import { ModeSwitch } from "../widgets/index.ts";

export type EditorMode = "edit" | "preview";

export function EditorModeSwitch({
  testIdPrefix,
  mode,
  onMode,
}: {
  readonly testIdPrefix: string;
  readonly mode: EditorMode;
  readonly onMode: (mode: EditorMode) => void;
}): ReactNode {
  const t = useTranslation();
  return (
    <ModeSwitch<EditorMode>
      value={mode}
      onChange={onMode}
      ariaLabel={t("kumiko.editor.modeSwitch")}
      testId={`${testIdPrefix}-mode-switch`}
      options={[
        { value: "edit", label: t("kumiko.contentEditor.editMode") },
        { value: "preview", label: t("kumiko.contentEditor.preview") },
      ]}
    />
  );
}

export function EditorLocaleSwitch({
  testIdPrefix,
  locales,
  locale,
  onLocale,
}: {
  readonly testIdPrefix: string;
  readonly locales: readonly string[];
  readonly locale: string;
  readonly onLocale: (locale: string) => void;
}): ReactNode {
  const t = useTranslation();
  return (
    <ModeSwitch<string>
      value={locale}
      onChange={onLocale}
      ariaLabel={t("kumiko.editor.localeSwitch")}
      testId={`${testIdPrefix}-locale-switch`}
      options={locales.map((code) => ({ value: code, label: code }))}
    />
  );
}

export type EditorSaveActions = {
  readonly busy: boolean;
  readonly canSave: boolean;
  readonly onSave: () => void;
  /** Replaces "Save", e.g. "Create" for a record that does not exist yet. */
  readonly saveLabel?: string;
  /** Without them the header has no publish button. */
  readonly canPublish?: boolean;
  readonly onPublish?: () => void;
};

export type EditorHeaderTestIds = { readonly save: string; readonly publish: string };

const DEFAULT_HEADER_TEST_IDS: EditorHeaderTestIds = {
  save: "editor-header-save",
  publish: "editor-header-publish",
};

// Title, status and the save/publish actions live in the shell header. The origin badge, the
// locale switch and the secondary action sit in the info bar below: at 1280px next to the
// sidebar, assistant and theme toggle the header has no room for them and the title would clip.
export function EditorHeader({
  title,
  status,
  actions,
  testIds = DEFAULT_HEADER_TEST_IDS,
  children,
}: {
  readonly title: string;
  /** Badge next to the title, e.g. the stored version's state. */
  readonly status?: ReactNode;
  readonly actions: EditorSaveActions;
  readonly testIds?: EditorHeaderTestIds;
  /** View controls left of the save actions (mode or kind switch). */
  readonly children: ReactNode;
}): ReactNode {
  const t = useTranslation();
  const { Button, PageHeader } = usePrimitives();
  if (PageHeader === undefined) return null;
  const { onPublish } = actions;
  return (
    <PageHeader
      title={title}
      status={status}
      actions={
        <span className="flex items-center gap-2 [&_button]:px-2.5 [&_button]:text-sm">
          {children}
          {/* The footer carries the same buttons; below 1280px the header leaves them to it so
              the title keeps its room. */}
          <span className="hidden items-center gap-2 xl:flex">
            <Button
              variant={onPublish === undefined ? "primary" : "secondary"}
              size="sm"
              disabled={!actions.canSave}
              loading={actions.busy}
              onClick={actions.onSave}
              testId={testIds.save}
            >
              {actions.saveLabel ?? t("kumiko.actions.save")}
            </Button>
            {onPublish !== undefined && (
              <Button
                size="sm"
                disabled={actions.canPublish !== true}
                onClick={onPublish}
                testId={testIds.publish}
              >
                {t("kumiko.editor.publish")}
              </Button>
            )}
          </span>
        </span>
      }
    />
  );
}
