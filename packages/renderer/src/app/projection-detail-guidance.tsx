import type { RowAction, SelectOptionTone } from "@cosmicdrift/kumiko-framework/ui-types";
import { Fragment, type ReactNode } from "react";
import { RenderEditActionButton } from "../components/render-edit-action-button.tsx";
import type { RenderEditAction } from "../components/render-edit-types.ts";
import type { BannerProps } from "../primitives.tsx";
import {
  readBreadcrumbItems,
  readNotice,
  readSteps,
  readTone,
} from "./projection-detail-guidance-data.ts";
import type { DetailHeaderModel } from "./projection-detail-header.tsx";
import type { ReferenceLinkResolver } from "./reference-link.ts";

export type DetailGuidanceModel = DetailHeaderModel & {
  readonly resolveReference: ReferenceLinkResolver;
  readonly buildItemActions: (
    actions: readonly RowAction[],
    item: Readonly<Record<string, unknown>>,
  ) => readonly RenderEditAction[] | undefined;
};

const BANNER_VARIANT: Record<SelectOptionTone, NonNullable<BannerProps["variant"]>> = {
  neutral: "info",
  accent: "primary",
  ok: "ok",
  warn: "warning",
  bad: "error",
  critical: "error",
};

function renderItemActions(
  model: DetailGuidanceModel,
  actions: readonly RowAction[] | undefined,
  item: Readonly<Record<string, unknown>>,
): ReactNode {
  if (actions === undefined || actions.length === 0) return undefined;
  const resolved = model.buildItemActions(actions, item);
  if (resolved === undefined || resolved.length === 0) return undefined;
  const { Button, Dialog, Grid } = model.primitives;
  return (
    <Grid columns="auto">
      {resolved.map((action) => (
        <RenderEditActionButton
          key={action.id}
          action={action}
          Button={Button}
          Dialog={Dialog}
          onError={model.setActionError}
        />
      ))}
    </Grid>
  );
}

export function renderDetailBreadcrumb(model: DetailGuidanceModel): ReactNode {
  const spec = model.screen.breadcrumb;
  if (spec === undefined) return undefined;
  const raw = readBreadcrumbItems(model.record[spec.field]);
  if (raw.length === 0) return undefined;
  const items = raw.map((item) => {
    const link =
      item.entity !== undefined && item.id !== undefined
        ? model.resolveReference(item.entity, item.id)
        : undefined;
    return { label: item.label, ...(link !== undefined && { link }) };
  });
  const { RecordBreadcrumb, Text, Link } = model.primitives;
  const ariaLabel = model.effectiveTranslate("kumiko.detail.breadcrumb");
  const testId = "kumiko-screen-projection-detail-breadcrumb";
  if (RecordBreadcrumb !== undefined) {
    return <RecordBreadcrumb items={items} ariaLabel={ariaLabel} testId={testId} />;
  }
  return (
    <Text testId={testId}>
      {items.map((item, index) => (
        <Fragment key={`${item.label}|${item.link?.href ?? ""}`}>
          {index > 0 && (
            <Text variant="muted" decorative>
              {" / "}
            </Text>
          )}
          {item.link !== undefined ? (
            <Link
              href={item.link.href}
              {...(item.link.onPress !== undefined && { onPress: item.link.onPress })}
            >
              {item.label}
            </Link>
          ) : (
            <Text>{item.label}</Text>
          )}
        </Fragment>
      ))}
    </Text>
  );
}

function renderSummary(model: DetailGuidanceModel): ReactNode {
  const spec = model.screen.summary;
  if (spec === undefined) return undefined;
  const text = model.record[spec.field];
  if (typeof text !== "string" || text === "") return undefined;
  const toneRaw = spec.toneField !== undefined ? model.record[spec.toneField] : undefined;
  const tone = readTone(toneRaw);
  const { RecordSummary, Text } = model.primitives;
  const testId = "kumiko-screen-projection-detail-summary";
  if (RecordSummary !== undefined) {
    return <RecordSummary text={text} {...(tone !== undefined && { tone })} testId={testId} />;
  }
  return <Text testId={testId}>{text}</Text>;
}

function renderBanner(model: DetailGuidanceModel): ReactNode {
  const spec = model.screen.banner;
  if (spec === undefined) return undefined;
  const notice = readNotice(model.record[spec.field]);
  if (notice === undefined) return undefined;
  const { Banner } = model.primitives;
  const actions = renderItemActions(model, spec.actions, notice);
  return (
    <Banner
      variant={BANNER_VARIANT[notice.tone ?? "neutral"]}
      title={notice.title}
      {...(actions !== undefined && { actions })}
      testId="kumiko-screen-projection-detail-banner"
    >
      {notice.text}
    </Banner>
  );
}

function renderSteps(model: DetailGuidanceModel): ReactNode {
  const spec = model.screen.steps;
  if (spec === undefined) return undefined;
  const { effectiveTranslate: t, record } = model;
  const steps = readSteps(record[spec.field]);
  const title = t(spec.title ?? "kumiko.detail.steps.title");
  const subtitleRaw = spec.subtitleField !== undefined ? record[spec.subtitleField] : undefined;
  const subtitle = typeof subtitleRaw === "string" && subtitleRaw !== "" ? subtitleRaw : undefined;
  const emptyLabel = t(spec.emptyLabel ?? "kumiko.detail.steps.empty");
  const items = steps.map((step) => {
    const actions = renderItemActions(model, spec.actions, step);
    return {
      id: step.id,
      title: step.title,
      ...(step.detail !== undefined && { detail: step.detail }),
      ...(step.tone !== undefined && { tone: step.tone }),
      ...(step.why !== undefined && { reason: step.why }),
      ...(actions !== undefined && { actions }),
    };
  });
  const { RecordSteps, Card, Text } = model.primitives;
  const testId = "kumiko-screen-projection-detail-steps";
  if (RecordSteps !== undefined) {
    return (
      <RecordSteps
        title={title}
        {...(subtitle !== undefined && { subtitle })}
        emptyLabel={emptyLabel}
        reasonLabel={t("kumiko.detail.steps.reason")}
        items={items}
        testId={testId}
      />
    );
  }
  return (
    <Card slots={{ title, ...(subtitle !== undefined && { subtitle }) }} testId={testId}>
      {items.length === 0 ? (
        <Text variant="muted">{emptyLabel}</Text>
      ) : (
        items.map((item) => (
          <Fragment key={item.id}>
            <Text>{item.title}</Text>
            {item.detail !== undefined && <Text variant="muted">{item.detail}</Text>}
            {item.reason !== undefined && <Text variant="muted">{item.reason}</Text>}
            {item.actions}
          </Fragment>
        ))
      )}
    </Card>
  );
}

/** Summary, banner and steps in reading order; blocks whose record field holds nothing drop out. */
export function renderDetailGuidance(model: DetailGuidanceModel): ReactNode {
  return (
    <>
      {renderSummary(model)}
      {renderBanner(model)}
      {renderSteps(model)}
    </>
  );
}
