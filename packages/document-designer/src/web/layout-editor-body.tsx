import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { ModeSwitch } from "@cosmicdrift/kumiko-renderer/web";
import type { ReactNode } from "react";
import { EditorHeader } from "./editor-header.tsx";
import { EditorBody, EditorFooter, EditorFrame } from "./editor-shell.tsx";
import { renderCenter } from "./layout-editor-center.tsx";
import type { Translate } from "./layout-editor-logic.ts";
import {
  AppearanceRail,
  BrandingRail,
  MjmlSourceRail,
  PlaceholderRail,
  RendererRail,
  UsedByRail,
} from "./layout-rails.tsx";
import type { LayoutKind } from "./layout-types.ts";
import { OriginBar } from "./origin-bar.tsx";
import {
  type LayoutEditorBodyProps,
  type LayoutEditorModel,
  useLayoutEditorState,
} from "./use-layout-editor-state.ts";

function renderLeftRail(props: LayoutEditorBodyProps, m: LayoutEditorModel): ReactNode {
  const { branding } = m;
  return (
    <>
      <BrandingRail
        data={branding.data}
        unavailable={branding.error !== null || (branding.data === null && !branding.loading)}
      />
      <PlaceholderRail validation={m.checked} />
      <RendererRail kind={props.kind} />
    </>
  );
}

function renderRightRail(props: LayoutEditorBodyProps, m: LayoutEditorModel): ReactNode {
  return (
    <>
      {m.isMail && (
        <AppearanceRail
          appearance={m.appearance}
          onChange={m.setAppearance}
          fromMjml={m.appearanceFromMjml}
        />
      )}
      {m.isMail && !m.mjmlMode && <MjmlSourceRail mjmlSource={props.source.mjmlSource} />}
      <UsedByRail layoutSlug={props.slug} kind={props.kind} rows={props.overviewRows} />
    </>
  );
}

function renderKindSwitch(t: Translate, props: LayoutEditorBodyProps, m: LayoutEditorModel) {
  return (
    <ModeSwitch<LayoutKind>
      value={props.kind}
      onChange={m.requestKind}
      ariaLabel={t("documentDesigner.editor.kindSwitch")}
      testId="document-designer-kind-switch"
      options={[
        { value: "mail-layout", label: t("documentDesigner.editor.kind.mail") },
        { value: "pdf-layout", label: t("documentDesigner.editor.kind.pdf") },
      ]}
    />
  );
}

export function LayoutEditorBody(props: LayoutEditorBodyProps): ReactNode {
  const { kind, isSystemAdmin, source, overrides, onKindChange, onReload } = props;
  const t = useTranslation();
  const { Banner, Dialog } = usePrimitives();
  const m = useLayoutEditorState(props, t);
  const { pendingKind, setPendingKind } = m;

  return (
    <EditorFrame testId="document-designer-layout-editor">
      <EditorHeader
        title={t(
          kind === "mail-layout"
            ? "documentDesigner.editor.title.mail"
            : "documentDesigner.editor.title.pdf",
        )}
        stored={m.shownRow}
        actions={{
          busy: m.busy,
          canSave: m.canSave,
          canPublish: m.canPublish,
          onSave: () => void m.save(false),
          onPublish: () => void m.save(true),
        }}
      >
        {renderKindSwitch(t, props, m)}
      </EditorHeader>
      <OriginBar
        isSystemAdmin={isSystemAdmin}
        source={source}
        kind={kind}
        userCount={m.userCount}
        overrides={overrides}
        onReset={() => void onReload()}
        onResetError={m.setSaveError}
      />
      <EditorBody
        left={renderLeftRail(props, m)}
        center={renderCenter(Banner, t, props, m)}
        right={renderRightRail(props, m)}
      />
      <EditorFooter
        testIdPrefix="document-designer"
        message={m.footerMessage}
        saveError={m.saveError}
        modifiedAt={null}
        dirty={m.dirty}
        busy={m.busy}
        canSave={m.canSave}
        canPublish={m.canPublish}
        onDiscard={m.discard}
        onSave={() => void m.save(false)}
        onPublish={() => void m.save(true)}
      />
      <Dialog
        open={pendingKind !== null}
        onOpenChange={(open) => {
          if (!open) setPendingKind(null);
        }}
        title={t("documentDesigner.editor.dirtySwitch.title")}
        description={t("documentDesigner.editor.dirtySwitch.description")}
        confirmLabel={t("documentDesigner.editor.dirtySwitch.confirm")}
        variant="danger"
        onConfirm={() => {
          if (pendingKind !== null) onKindChange(pendingKind);
        }}
      />
    </EditorFrame>
  );
}
