import type {
  EntityDefinition,
  PageHelpSpec,
  PageHelpStatusSection,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { parseRefTarget } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useState } from "react";
import type { FeatureSchema } from "../app/feature-schema.ts";
import { fieldOptionHelpKey, fieldOptionLabelKey, type Translate } from "../headless/index.ts";
import { usePrimitives } from "../primitives.tsx";
import { statusToneForOption } from "../status-tone.ts";

type HelpEntity = Pick<EntityDefinition, "fields">;

export type ResolvedPageHelpSection =
  | {
      readonly kind: "status";
      readonly field: string;
      readonly entityName: string;
      readonly entity: HelpEntity;
      readonly featureName: string;
      /** i18n key of the card heading. */
      readonly titleKey: string;
    }
  | { readonly kind: "text"; readonly title: string; readonly text: string };

export type PageHelpButtonProps = {
  readonly sections: readonly ResolvedPageHelpSection[];
  readonly translate: Translate;
};

// A tint of the primary token (light and dark follow the theme) so the help stands out from the neutral
// "Bearbeiten"; below sm only the icon shows, in the same square as the header's "…" button.
const TRIGGER_CLASS =
  "h-10 shrink-0 border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary";
const SECTION_STACK_CLASS = "flex flex-col gap-4 px-6 py-4";

function StatusLegend({
  section,
  translate,
}: {
  readonly section: Extract<ResolvedPageHelpSection, { kind: "status" }>;
  readonly translate: Translate;
}): ReactNode {
  const { Text, StatusBadge, Grid } = usePrimitives();
  const { featureName, entityName, field: fieldName, entity } = section;
  const field = entity.fields[fieldName];
  if (field === undefined || field.type !== "select") return null;
  const rows = field.options.flatMap((value) => {
    const label = translate(fieldOptionLabelKey(featureName, entityName, fieldName, value));
    const tone = statusToneForOption(value, field.optionTones) ?? "muted";
    return [
      StatusBadge !== undefined ? (
        <StatusBadge
          key={`badge-${value}`}
          value={label}
          tone={tone}
          testId={`page-help-badge-${value}`}
        />
      ) : (
        <Text key={`badge-${value}`} testId={`page-help-badge-${value}`}>
          {label}
        </Text>
      ),
      <Text key={`text-${value}`} testId={`page-help-text-${value}`}>
        {translate(fieldOptionHelpKey(featureName, entityName, fieldName, value))}
      </Text>,
    ];
  });
  return (
    <Grid columns={2} legend ruled testId="page-help-options">
      {rows}
    </Grid>
  );
}

function PageHelpBody({ sections, translate }: PageHelpButtonProps): ReactNode {
  const { Section, Text, FillContainer } = usePrimitives();
  // Two tabs may share entity and field, two text sections a title: a repeat gets a counter.
  const seen = new Map<string, number>();
  const uniqueKey = (base: string): string => {
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return `${base}#${count}`;
  };
  const cards = sections.map((section, index) => (
    <Section
      key={uniqueKey(
        section.kind === "status"
          ? `${section.featureName}:${section.entityName}:${section.field}`
          : section.title,
      )}
      title={translate(section.kind === "status" ? section.titleKey : section.title)}
      testId={`page-help-section-${index}`}
      {...(section.kind === "status" && {
        subtitle: translate("kumiko.pageHelp.statusIntro"),
      })}
    >
      {section.kind === "status" ? (
        <StatusLegend section={section} translate={translate} />
      ) : (
        <Text>{translate(section.text)}</Text>
      )}
    </Section>
  ));
  return FillContainer !== undefined ? (
    <FillContainer className={SECTION_STACK_CLASS}>{cards}</FillContainer>
  ) : (
    cards
  );
}

export function PageHelpButton({ sections, translate }: PageHelpButtonProps): ReactNode {
  const { Button, Dialog, Drawer } = usePrimitives();
  const [open, setOpen] = useState(false);
  const title = translate("kumiko.pageHelp.button");
  const body = <PageHelpBody sections={sections} translate={translate} />;
  return (
    <>
      <Button
        variant="secondary"
        icon="help-circle"
        title={title}
        className={TRIGGER_CLASS}
        collapseLabel
        onClick={() => setOpen(true)}
        testId="page-help-button"
      >
        {translate("kumiko.pageHelp.buttonLabel")}
      </Button>
      {Drawer !== undefined ? (
        <Drawer open={open} onOpenChange={setOpen} title={title} testId="page-help-drawer">
          {body}
        </Drawer>
      ) : (
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title={title}
          confirmLabel={translate("kumiko.dialog.close")}
          hideCancel
          initialFocus="confirm"
          onConfirm={() => undefined}
          testId="page-help-drawer"
        >
          {body}
        </Dialog>
      )}
    </>
  );
}

/** A `pageHelp` plus the entity its status sections fall back to (empty where the screen has none). */
export type PageHelpSource = {
  readonly spec: PageHelpSpec | undefined;
  readonly defaultEntity: string;
  readonly scopeTitle?: string;
};

export type PageHelpContext = {
  readonly featureName: string;
  /** Short id of the screen the help belongs to; its title heads the screen's own status sections. */
  readonly screenId: string;
  /** Entities of the screen's own feature, used when `appFeatures` does not know the target. */
  readonly ownEntities: Readonly<Record<string, HelpEntity>>;
  readonly translate: Translate;
  readonly appFeatures: readonly FeatureSchema[];
};

function resolveStatusSection(
  rawEntity: string,
  section: PageHelpStatusSection,
  scopeTitle: string | undefined,
  context: PageHelpContext,
): ResolvedPageHelpSection | undefined {
  const target = parseRefTarget(rawEntity, context.featureName);
  const ownsTarget = target.featureName === context.featureName;
  const entity =
    context.appFeatures.find((f) => f.featureName === target.featureName)?.entities[
      target.entityName
    ] ?? (ownsTarget ? context.ownEntities[target.entityName] : undefined);
  if (entity === undefined) return undefined;
  return {
    kind: "status",
    field: section.field,
    entityName: target.entityName,
    entity,
    featureName: target.featureName,
    titleKey: section.title ?? scopeTitle ?? `screen:${context.screenId}.title`,
  };
}

/** The help button for the sections of all `sources`, in order; undefined when nothing resolves.
 *  A status entity is `section.entity` (bare or `<feature>:<entity>`), else the source's default entity;
 *  labels and help sentences come from the feature owning it. */
export function pageHelpButtonOf(
  sources: readonly PageHelpSource[],
  context: PageHelpContext,
): ReactNode {
  const sections: ResolvedPageHelpSection[] = [];
  for (const { spec, defaultEntity, scopeTitle } of sources) {
    for (const section of spec?.sections ?? []) {
      if (section.kind === "text") {
        sections.push(section);
        continue;
      }
      const resolved = resolveStatusSection(
        section.entity ?? defaultEntity,
        section,
        scopeTitle,
        context,
      );
      if (resolved !== undefined) sections.push(resolved);
    }
  }
  if (sections.length === 0) return undefined;
  return <PageHelpButton sections={sections} translate={context.translate} />;
}
