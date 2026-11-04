import type { RowAction, SelectOptionTone } from "@cosmicdrift/kumiko-framework/ui-types";
import { Fragment, type ReactNode } from "react";
import { RenderEditActionButton } from "../components/render-edit-action-button.tsx";
import type { RenderEditAction } from "../components/render-edit-types.ts";
import type { BannerProps } from "../primitives.tsx";
import {
  isRecordProgressArray,
  readBreadcrumbItems,
  readNotice,
  readSteps,
  readTone,
} from "./projection-detail-guidance-data.ts";
import type { DetailHeaderModel } from "./projection-detail-header.tsx";
import type { ReferenceLinkResolver } from "./reference-link.ts";
import { uniqueLabelKeys } from "./unique-label-keys.ts";

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

// The app layer may not render DOM tags, so layout classes ride on FillContainer; hosts without it (native) fall back to plain stacking.
export function wrapLayout(
  primitives: DetailGuidanceModel["primitives"],
  className: string,
  node: ReactNode,
): ReactNode {
  const { FillContainer } = primitives;
  return FillContainer !== undefined ? (
    <FillContainer className={className}>{node}</FillContainer>
  ) : (
    node
  );
}

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
  const keys = uniqueLabelKeys(items.map((item) => item.label));
  const { RecordBreadcrumb, Text, Link } = model.primitives;
  const ariaLabel = model.effectiveTranslate("kumiko.detail.breadcrumb");
  const testId = "kumiko-screen-projection-detail-breadcrumb";
  if (RecordBreadcrumb !== undefined) {
    return <RecordBreadcrumb items={items} ariaLabel={ariaLabel} testId={testId} />;
  }
  return (
    <Text testId={testId}>
      {items.map((item, index) => (
        <Fragment key={keys[index]}>
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
  return wrapLayout(
    model.primitives,
    GUIDANCE_INSET,
    <Banner
      variant={BANNER_VARIANT[notice.tone ?? "neutral"]}
      title={notice.title}
      {...(actions !== undefined && { actions })}
      testId="kumiko-screen-projection-detail-banner"
    >
      {notice.text}
    </Banner>,
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

function renderProgress(model: DetailGuidanceModel, stacked: boolean): ReactNode {
  const spec = model.screen.progress;
  if (spec === undefined) return undefined;
  const chains = model.record[spec.field];
  const { StepBar, Card, Text } = model.primitives;
  if (StepBar === undefined || !isRecordProgressArray(chains) || chains.length === 0) {
    return undefined;
  }
  const t = model.effectiveTranslate;
  const cards = chains.flatMap((chain, index) => {
    if (chain.steps.length === 0) return [];
    const currentIndex = Math.min(
      Math.max(Math.trunc(chain.currentIndex), 0),
      chain.steps.length - 1,
    );
    const current = chain.steps[currentIndex];
    const testId = `record-progress-${index}`;
    return [
      <Card key={testId} slots={{ title: chain.title }} testId={testId}>
        <StepBar
          steps={chain.steps.map((step) => step.label)}
          currentIndex={currentIndex}
          doneSteps={chain.steps.map((step) => step.done)}
          narrowLayout="steps"
          {...(stacked && {
            orientation: "stacked" as const,
            subtitles: chain.steps.map((step) => step.detail),
          })}
          compactLabel={t("kumiko.wizard.step-with-title", {
            current: currentIndex + 1,
            total: chain.steps.length,
            title: current?.label ?? "",
          })}
          testId={`${testId}-bar`}
        />
        {!stacked && current !== undefined && (
          <Text variant="muted" testId={`${testId}-up-next`}>
            {t("kumiko.wizard.up-next")}: {current.label}
            {current.detail !== undefined ? ` · ${current.detail}` : ""}
          </Text>
        )}
      </Card>,
    ];
  });
  return cards.length === 0 ? undefined : cards;
}

// RecordSteps and the summary carry their own px-6; the progress cards and the banner are bare, so they need the same inset to line up with the metric tiles.
const GUIDANCE_INSET = "px-6";
const PROGRESS_INSET = "flex min-w-0 flex-col gap-4 px-6 py-2";

/** Summary, banner, progress and steps in reading order; blocks whose record field holds nothing drop out. */
export function renderDetailGuidance(model: DetailGuidanceModel): ReactNode {
  const { progress, steps } = model.screen;
  const beside = progress?.placement === "beside-steps" && steps !== undefined;
  const progressNode = renderProgress(model, beside);
  return (
    <>
      {renderSummary(model)}
      {renderBanner(model)}
      {beside ? (
        wrapLayout(
          model.primitives,
          "grid grid-cols-1 gap-4 lg:grid-cols-12",
          <>
            {wrapLayout(
              model.primitives,
              progressNode !== undefined ? "min-w-0 lg:col-span-8" : "min-w-0 lg:col-span-12",
              renderSteps(model),
            )}
            {progressNode !== undefined &&
              wrapLayout(model.primitives, `${PROGRESS_INSET} lg:col-span-4 lg:pl-0`, progressNode)}
          </>,
        )
      ) : (
        <>
          {progressNode !== undefined && wrapLayout(model.primitives, PROGRESS_INSET, progressNode)}
          {renderSteps(model)}
        </>
      )}
    </>
  );
}
