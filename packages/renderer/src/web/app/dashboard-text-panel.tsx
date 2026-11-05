import type {
  DashboardText,
  DashboardTextBlock,
  DashboardTextPanel,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import { navigateTargetAllows } from "../../app/screen-access.ts";
import type { Translate } from "../../headless/index.ts";
import { lastSegment, useAppFeatures, useNav, usePrimitives, useUserRoles } from "../../index.ts";
import { useIsBelowSmViewport } from "../primitives/use-narrow-viewport.ts";
import {
  type DashboardFormats,
  PanelError,
  PanelShell,
  PanelSkeleton,
  panelPayload,
  type ScreenParams,
  useDashboardFormats,
  useDashboardQuery,
  useReportPanelLoaded,
} from "./dashboard-shared.tsx";
import { isDashboardI18nText, isRecord, resolveDashboardText } from "./dashboard-text.ts";

function isDashboardText(value: unknown): value is DashboardText {
  return typeof value === "string" || isDashboardI18nText(value);
}

function isRoleList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((role) => typeof role === "string");
}

type ParagraphBlock = Extract<DashboardTextBlock, { readonly kind: "paragraph" }>;

type RawBlock = Readonly<Record<string, unknown>>;

function readParagraphBlock(raw: RawBlock): DashboardTextBlock | undefined {
  const { text, emphasis } = raw;
  if (!isDashboardText(text)) return undefined;
  return {
    kind: "paragraph",
    text,
    ...((emphasis === "muted" || emphasis === "strong" || emphasis === "lead") && { emphasis }),
  };
}

function readLinkBlock(raw: RawBlock): DashboardTextBlock | undefined {
  const { text, screen, roles } = raw;
  if (!isDashboardText(text) || typeof screen !== "string" || screen === "") return undefined;
  return { kind: "link", text, screen, ...(isRoleList(roles) && { roles }) };
}

// A query answers untyped JSON: one guard per block kind, so a malformed block is dropped
// instead of crashing the panel.
const QUERY_BLOCK_READERS: Readonly<
  Record<DashboardTextBlock["kind"], (raw: RawBlock) => DashboardTextBlock | undefined>
> = {
  heading: ({ text }) => (isDashboardText(text) ? { kind: "heading", text } : undefined),
  hint: ({ text }) => (isDashboardText(text) ? { kind: "hint", text } : undefined),
  paragraph: readParagraphBlock,
  list: ({ items }) =>
    Array.isArray(items) && items.every(isDashboardText) ? { kind: "list", items } : undefined,
  code: ({ code }) => (typeof code === "string" ? { kind: "code", code } : undefined),
  link: readLinkBlock,
};

function isBlockKind(value: unknown): value is DashboardTextBlock["kind"] {
  return typeof value === "string" && Object.hasOwn(QUERY_BLOCK_READERS, value);
}

function readQueryBlock(raw: unknown): DashboardTextBlock | undefined {
  if (!isRecord(raw) || !isBlockKind(raw["kind"])) return undefined;
  return QUERY_BLOCK_READERS[raw["kind"]](raw);
}

function readQueryBlocks(
  data: unknown,
  key: "blocks" | "narrowBlocks",
): readonly DashboardTextBlock[] {
  const blocks = isRecord(data) ? data[key] : undefined;
  if (!Array.isArray(blocks)) return [];
  return blocks.flatMap((raw) => {
    const block = readQueryBlock(raw);
    return block === undefined ? [] : [block];
  });
}

function resolveBlockText(
  text: DashboardText,
  translate: Translate,
  formats: DashboardFormats,
): string {
  return typeof text === "string"
    ? translate(text)
    : (resolveDashboardText(text, translate, formats) ?? "");
}

const PARAGRAPH_CLASS_NAMES = {
  muted: "text-sm text-muted-foreground",
  strong: "text-sm font-medium text-foreground",
  lead: "font-heading text-[15.5px] leading-[1.5] sm:text-[17px] sm:leading-relaxed text-foreground",
} as const satisfies Record<NonNullable<ParagraphBlock["emphasis"]>, string>;

function TextBlockView({
  block,
  translate,
}: {
  readonly block: DashboardTextBlock;
  readonly translate: Translate;
}): ReactNode {
  const formats = useDashboardFormats();
  const resolve = (text: DashboardText): string => resolveBlockText(text, translate, formats);
  switch (block.kind) {
    case "heading":
      return (
        <h3 data-block="heading" className="text-sm font-semibold text-foreground">
          {resolve(block.text)}
        </h3>
      );
    case "paragraph":
      return (
        <p data-block="paragraph" className={PARAGRAPH_CLASS_NAMES[block.emphasis ?? "muted"]}>
          {resolve(block.text)}
        </p>
      );
    case "list":
      return (
        <ul data-block="list" className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {withOccurrenceKeys(block.items, textKey).map(({ entry, key }) => (
            <li key={key}>{resolve(entry)}</li>
          ))}
        </ul>
      );
    case "code":
      return (
        <pre data-block="code" className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
          <code>{block.code}</code>
        </pre>
      );
    case "hint":
      return (
        <p data-block="hint" className="text-xs text-muted-foreground">
          {resolve(block.text)}
        </p>
      );
    case "link":
      return <TextBlockLink block={block} resolve={resolve} />;
  }
}

function TextBlockLink({
  block,
  resolve,
}: {
  readonly block: Extract<DashboardTextBlock, { readonly kind: "link" }>;
  readonly resolve: (text: DashboardText) => string;
}): ReactNode {
  const { Link } = usePrimitives();
  const nav = useNav();
  const userRoles = useUserRoles();
  const appFeatures = useAppFeatures();
  if (block.roles !== undefined && !block.roles.some((role) => userRoles?.includes(role))) {
    return null;
  }
  const target = { screenId: lastSegment(block.screen) };
  if (!navigateTargetAllows({ screen: target.screenId }, appFeatures, userRoles)) return null;
  return (
    <Link
      href={nav.hrefFor(target)}
      onPress={() => nav.navigate(target)}
      testId={`dashboard-text-link-${target.screenId}`}
    >
      {resolve(block.text)}
    </Link>
  );
}

// Content-derived keys collide for identical entries; the occurrence count keeps them unique.
function withOccurrenceKeys<T>(
  entries: readonly T[],
  contentKey: (entry: T) => string,
): { readonly entry: T; readonly key: string }[] {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const content = contentKey(entry);
    const occurrence = seen.get(content) ?? 0;
    seen.set(content, occurrence + 1);
    return { entry, key: `${content}#${occurrence}` };
  });
}

function textKey(text: DashboardText): string {
  return typeof text === "string" ? text : JSON.stringify(text);
}

function textBlockKey(block: DashboardTextBlock): string {
  switch (block.kind) {
    case "list":
      return `list:${block.items.map(textKey).join("|")}`;
    case "code":
      return `code:${block.code}`;
    default:
      return `${block.kind}:${textKey(block.text)}`;
  }
}

function TextPanelFrame({
  panel,
  label,
  children,
}: {
  readonly panel: DashboardTextPanel;
  readonly label: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const testId = `dashboard-panel-${panel.id}`;
  if (label !== undefined) {
    return (
      <PanelShell testId={testId} title={label}>
        {children}
      </PanelShell>
    );
  }
  return (
    <section
      data-testid={testId}
      className="h-full rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      {children}
    </section>
  );
}

function TextBlockList({
  blocks,
  translate,
}: {
  readonly blocks: readonly DashboardTextBlock[];
  readonly translate: Translate;
}): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      {withOccurrenceKeys(blocks, textBlockKey).map(({ entry, key }) => (
        <TextBlockView key={key} block={entry} translate={translate} />
      ))}
    </div>
  );
}

type TextPanelBodyProps = {
  readonly panel: DashboardTextPanel;
  readonly label: string | undefined;
  readonly screenParams: ScreenParams;
  readonly translate: Translate;
};

export function TextPanelBody(props: TextPanelBodyProps): ReactNode {
  const { panel, label, translate } = props;
  const narrow = useIsBelowSmViewport();
  if (panel.query === undefined) {
    return (
      <TextPanelFrame panel={panel} label={label}>
        <TextBlockList
          blocks={(narrow ? panel.narrowBlocks : undefined) ?? panel.blocks ?? []}
          translate={translate}
        />
      </TextPanelFrame>
    );
  }
  return <QueryTextPanelBody {...props} query={panel.query} />;
}

// Not QueryPanel: that shell shows a skeleton/error/empty state instead of content, but the
// static blocks are the fallback here and must stay visible while the query loads, fails or is empty.
function QueryTextPanelBody({
  panel,
  query,
  label,
  screenParams,
  translate,
}: TextPanelBodyProps & { readonly query: string }): ReactNode {
  const { data, error, loading, refetch } = useDashboardQuery<unknown>(
    query,
    panelPayload(panel, screenParams),
  );
  useReportPanelLoaded(data, loading);
  const narrow = useIsBelowSmViewport();
  const queriedNarrow = narrow ? readQueryBlocks(data, "narrowBlocks") : [];
  const queriedWide = readQueryBlocks(data, "blocks");
  const queried = queriedNarrow.length > 0 ? queriedNarrow : queriedWide;
  const staticBlocks = (narrow ? panel.narrowBlocks : undefined) ?? panel.blocks ?? [];
  const blocks = queried.length > 0 ? queried : staticBlocks;
  let body: ReactNode;
  if (blocks.length > 0) {
    body = <TextBlockList blocks={blocks} translate={translate} />;
  } else if (error !== null) {
    body = <PanelError label={label ?? ""} error={error} onRetry={() => void refetch()} />;
  } else if (loading && data === null) {
    body = <PanelSkeleton shape="rows" />;
  } else {
    body = null;
  }
  return (
    <TextPanelFrame panel={panel} label={label}>
      {body}
    </TextPanelFrame>
  );
}
