import type { ReactNode } from "react";
import type { FormValues } from "../headless/index.ts";
import { renderAllRequiredHint } from "./render-edit-banners.tsx";
import { renderFieldGrid } from "./render-edit-field-grid.tsx";
import { sectionNavAnchorId } from "./render-edit-helpers.tsx";
import type { FieldsSection, SectionRenderContext } from "./render-edit-render-model.ts";

function renderTabbedGroupsSection<TValues extends FormValues, TCtx>(
  rc: SectionRenderContext<TValues, TCtx>,
  section: FieldsSection,
  sectionKey: string,
): ReactNode {
  const { Grid, Card } = rc.model.engine.state.primitives;
  const groupsGrid = (
    <Grid key={`${sectionKey}-groups`} columns={1}>
      {section.groups?.map((group, groupIndex) => (
        <Card
          key={group.title}
          slots={{ title: group.title }}
          testId={`section-${sectionKey}-group-${groupIndex}`}
        >
          {renderFieldGrid(
            rc.model,
            section,
            group.fields,
            group.columns,
            `${sectionKey}-group-${groupIndex}-grid`,
          )}
        </Card>
      ))}
    </Grid>
  );
  // `actions` on a `groups` section has no group of its own to
  // sit in and would need an extra title-less Card around the
  // group cards (Card-in-Card) — the boot-validator rejects that
  // combination in tabs mode, so `sectionActionsEl` is always
  // undefined here at runtime.
  return rc.wrapWizardStep(
    sectionKey,
    <Card
      key={sectionKey}
      options={{ framed: false }}
      {...(section.description !== undefined && { slots: { subtitle: section.description } })}
    >
      {groupsGrid}
    </Card>,
  );
}

function renderTabbedFieldsSection<TValues extends FormValues, TCtx>(
  rc: SectionRenderContext<TValues, TCtx>,
  section: FieldsSection,
  sectionKey: string,
): ReactNode {
  if (section.groups !== undefined) return renderTabbedGroupsSection(rc, section, sectionKey);
  const { Card } = rc.model.engine.state.primitives;
  const { sectionActionsEl } = rc;
  // No section title here — the Tab strip right above
  // already names this panel, so a repeated Card title would just
  // duplicate it. The header row only exists to carry the section
  // description and actions, never the title text.
  const cardEl = (
    <Card
      key={sectionKey}
      options={{ framed: false }}
      {...((sectionActionsEl !== undefined || section.description !== undefined) && {
        slots: {
          ...(section.description !== undefined && { subtitle: section.description }),
          ...(sectionActionsEl !== undefined && { headerActions: sectionActionsEl }),
        },
      })}
      testId={`section-${sectionKey}`}
    >
      {renderFieldGrid(rc.model, section, section.fields, section.columns, `${sectionKey}-grid`)}
    </Card>
  );
  return rc.wrapWizardStep(sectionKey, cardEl);
}

// Suppress the section header when it would just repeat the form
// title verbatim (typical for single-section actionForms), or the
// tab label right above it. Without a Tabs primitive the sections
// render stacked, and then the titles are what tells them apart.
function resolveSectionTitle<TValues extends FormValues, TCtx>(
  { model, sectionIndex }: SectionRenderContext<TValues, TCtx>,
  section: FieldsSection,
): string | undefined {
  const { titles } = model;
  const { state } = model.engine;
  const repeatsTabLabel = state.isTabs && state.isStepped;
  if (titles.titleInSettingsHeader && sectionIndex === 0) return section.title ?? titles.formTitle;
  return section.title === titles.formTitle || repeatsTabLabel ? undefined : section.title;
}

function resolveSectionSubtitle<TValues extends FormValues, TCtx>(
  { model, sectionIndex }: SectionRenderContext<TValues, TCtx>,
  section: FieldsSection,
): ReactNode {
  const headerFallback = model.titles.titleInSettingsHeader && sectionIndex === 0;
  // Below lg the rail is CSS-hidden, so the header copy stands in for it.
  const description =
    model.titles.stepRail && section.description !== undefined ? (
      <span className="lg:hidden" data-testid="render-edit-step-description-narrow">
        {section.description}
      </span>
    ) : (
      section.description
    );
  return description ?? (headerFallback ? model.titles.formSubtitle : undefined);
}

function renderDefaultFieldsSection<TValues extends FormValues, TCtx>(
  rc: SectionRenderContext<TValues, TCtx>,
  section: FieldsSection,
  sectionKey: string,
): ReactNode {
  const { model, sectionIndex, sectionActionsEl } = rc;
  const { Section } = model.engine.state.primitives;
  const anchorId = sectionNavAnchorId(model.titles.sectionNavItems, sectionIndex);
  const sectionTitle = resolveSectionTitle(rc, section);
  const sectionSubtitle = resolveSectionSubtitle(rc, section);
  const sectionEl = (
    <Section
      key={sectionKey}
      {...(anchorId !== undefined && { id: anchorId })}
      {...(sectionTitle !== undefined && { title: sectionTitle })}
      {...(sectionSubtitle !== undefined && { subtitle: sectionSubtitle })}
      {...(section.icon !== undefined && { icon: section.icon })}
      {...(sectionActionsEl !== undefined && { actions: sectionActionsEl })}
      {...(model.footer.isSettingsList && { layout: "settings-list" as const })}
      testId={`section-${sectionKey}`}
    >
      {model.engine.sections.showsAllRequiredHint &&
        model.engine.state.insideDrawer &&
        sectionIndex === 0 &&
        renderAllRequiredHint(model)}
      {renderFieldGrid(model, section, section.fields, section.columns, `${sectionKey}-grid`)}
    </Section>
  );
  return rc.wrapWizardStep(sectionKey, sectionEl);
}

export function renderFieldsSection<TValues extends FormValues, TCtx>(
  rc: SectionRenderContext<TValues, TCtx>,
  section: FieldsSection,
): ReactNode {
  if (!section.visible) return null;
  // Title-less sections would otherwise collide on key/testId, so use the index
  // as a fallback.
  const sectionKey = section.title ?? `section-${rc.sectionIndex}`;
  // Tabs mode: the tab panel is the surface, so field sections render
  // as unframed padded panels; group cards inside stay framed.
  // Stays `Card`, not `Section` — Section always flattens to a
  // borderless divider when rendered inside this component's own
  // `<Form>` (InsideFormContext), even with `chromeless` set, so it
  // cannot stand in for the tabs-mode card here.
  return rc.model.engine.props.hideSectionTitles === true
    ? renderTabbedFieldsSection(rc, section, sectionKey)
    : renderDefaultFieldsSection(rc, section, sectionKey);
}
