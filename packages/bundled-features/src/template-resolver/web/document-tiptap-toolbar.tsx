import type { ActionMenuItemSpec } from "@cosmicdrift/kumiko-renderer";
import { ActionMenu, cn } from "@cosmicdrift/kumiko-renderer/web";
import {
  AlignLeft,
  Braces,
  ChevronDown,
  Columns3,
  GalleryThumbnails,
  Image as ImageIcon,
  ListChecks,
  Mail,
  Minus,
  MousePointerClick,
  Plus,
  Repeat,
  Scissors,
  SquareDashed,
  Table as TableIcon,
} from "lucide-react";
import { Fragment, type ReactNode } from "react";
import type { TiptapContext } from "./document-tiptap-context.ts";
import { CANVAS_INLINE_BLOCKS } from "./document-tiptap-helpers.ts";
import {
  iconButton,
  renderListButtons,
  renderMarkButtons,
  renderParagraphStyleSelect,
  renderPrintTableGroup,
  renderPrintTextStyleGroup,
  Separator,
} from "./document-tiptap-toolbar-groups.tsx";
import type {
  DocumentPrintBlock,
  DocumentPrintMode,
  DocumentToolbarBlock,
} from "./document-toolbar-blocks.ts";

type BlockButtons = Record<DocumentToolbarBlock, { label: string; icon: ReactNode }>;

function blockButtonsOf(c: TiptapContext): BlockButtons {
  const { t } = c;
  const { imageLabel, pageBreakLabel, stepsLabel, imagesLabel } = c.labels;
  return {
    image: { label: imageLabel, icon: <ImageIcon size={16} /> },
    table: { label: t("template-resolver.documentEditor.table"), icon: <TableIcon size={16} /> },
    button: {
      label: t("template-resolver.documentEditor.button"),
      icon: <MousePointerClick size={16} />,
    },
    divider: { label: t("template-resolver.documentEditor.divider"), icon: <Minus size={16} /> },
    repeat: { label: t("template-resolver.documentEditor.repeat"), icon: <Repeat size={16} /> },
    pageBreak: { label: pageBreakLabel, icon: <Scissors size={16} /> },
    align: { label: t("template-resolver.documentEditor.align"), icon: <AlignLeft size={16} /> },
    steps: { label: stepsLabel, icon: <ListChecks size={16} /> },
    images: { label: imagesLabel, icon: <GalleryThumbnails size={16} /> },
  };
}

type LabelledButtonSpec = {
  readonly key?: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly showIcon: boolean;
  readonly trailingIcon?: ReactNode;
  readonly expanded?: boolean;
  readonly onClick: () => void;
};

function labelledButton(c: TiptapContext, spec: LabelledButtonSpec): ReactNode {
  const { Button, canvas, compact, readOnly } = c;
  const flatVariant = canvas ? "ghost" : "secondary";
  const shared = {
    type: "button",
    variant: flatVariant,
    disabled: readOnly,
    onClick: spec.onClick,
    ...(spec.expanded !== undefined && { expanded: spec.expanded }),
  } as const;
  return compact ? (
    <Button key={spec.key} {...shared} size="icon" ariaLabel={spec.label} title={spec.label}>
      {spec.icon}
    </Button>
  ) : (
    <Button key={spec.key} {...shared} size="sm">
      {spec.showIcon && spec.icon}
      {spec.label}
      {spec.trailingIcon}
    </Button>
  );
}

function renderInlineBlock(
  c: TiptapContext,
  block: DocumentToolbarBlock,
  blockButtons: BlockButtons,
): ReactNode {
  if (c.canvas) {
    return (
      <Fragment key={block}>
        {iconButton(c, blockButtons[block].label, blockButtons[block].icon, false, () =>
          c.runBlock(block),
        )}
      </Fragment>
    );
  }
  return labelledButton(c, {
    key: block,
    label: blockButtons[block].label,
    icon: blockButtons[block].icon,
    showIcon: true,
    onClick: () => c.runBlock(block),
  });
}

function overflowItemsOf(
  c: TiptapContext,
  menuBlocks: readonly DocumentToolbarBlock[],
  blockButtons: BlockButtons,
): readonly ActionMenuItemSpec[] {
  const { t, canvas, hosted, readOnly } = c;
  return [
    ...menuBlocks.map((block) => ({
      id: block,
      label: blockButtons[block].label,
      disabled: readOnly,
      onSelect: () => c.runBlock(block),
    })),
    ...(canvas && !hosted
      ? [
          {
            id: "html",
            label: t("template-resolver.documentEditor.showHtml"),
            onSelect: () => c.setShowHtml((current) => !current),
          },
        ]
      : []),
  ];
}

const PRINT_BLOCKS_BY_MODE: Readonly<Record<DocumentPrintMode, readonly DocumentPrintBlock[]>> = {
  none: [],
  flow: ["columns"],
  page: ["address", "textFrame", "columns"],
};

const PRINT_BLOCK_TEST_IDS: Readonly<Record<DocumentPrintBlock, string>> = {
  address: "document-block-address",
  textFrame: "document-block-textframe",
  columns: "document-block-columns",
};

const PRINT_BLOCK_ICONS: Readonly<Record<DocumentPrintBlock, ReactNode>> = {
  address: <Mail size={16} />,
  textFrame: <SquareDashed size={16} />,
  columns: <Columns3 size={16} />,
};

function renderPrintBlockMenu(c: TiptapContext): ReactNode {
  const { t } = c;
  const blocks = PRINT_BLOCKS_BY_MODE[c.print];
  if (blocks.length === 0) return null;
  return (
    <ActionMenu
      testId="document-block-menu"
      triggerLabel={t("documentDesigner.editor.blockMenu")}
      align="start"
      minWidth="18rem"
      trigger={
        <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 text-xs font-medium text-primary">
          <Plus size={14} />
          {t("documentDesigner.editor.blockMenu")}
          <ChevronDown size={12} />
        </span>
      }
      items={blocks.map((block) => ({
        kind: "item",
        id: block,
        label: t(`documentDesigner.editor.block.${block}`),
        description: t(`documentDesigner.editor.block.${block}.hint`),
        icon: PRINT_BLOCK_ICONS[block],
        testId: PRINT_BLOCK_TEST_IDS[block],
        disabled: c.readOnly,
        onSelect: () => c.runPrintBlock(block),
      }))}
    />
  );
}

function renderPrintStyleRow(c: TiptapContext): ReactNode {
  const { canvas } = c;
  return (
    <div
      className={cn(
        "flex items-center border-b border-input",
        canvas
          ? "min-h-9 flex-wrap gap-1.5 bg-background px-1.5 py-1 [&>*]:shrink-0"
          : "flex-wrap gap-1 p-1",
      )}
    >
      {renderPrintTextStyleGroup(c)}
      {renderPrintTableGroup(c)}
    </div>
  );
}

export function renderToolbarBar(c: TiptapContext): ReactNode {
  return (
    <>
      {renderMainToolbarRow(c)}
      {c.print !== "none" && renderPrintStyleRow(c)}
    </>
  );
}

function renderPlaceholderButton(c: TiptapContext): ReactNode {
  if (c.variables.length === 0) return null;
  return (
    <>
      <Separator compact={c.compact || c.canvas} />
      {labelledButton(c, {
        label: c.t("template-resolver.documentEditor.insertPlaceholder"),
        icon: <Braces size={16} />,
        showIcon: true,
        trailingIcon: c.canvas ? <ChevronDown size={12} /> : undefined,
        expanded: c.openPanel === "placeholder",
        onClick: () => c.togglePanel("placeholder"),
      })}
    </>
  );
}

function renderMainToolbarRow(c: TiptapContext): ReactNode {
  const { t, id, canvas, compact, ActionOverflowMenu } = c;
  const blockButtons = blockButtonsOf(c);
  // The canvas toolbar never scrolls sideways: the rarer blocks and the HTML view sit in the menu.
  const menuBlocks =
    canvas && ActionOverflowMenu !== undefined
      ? c.blocks.filter((block) => !CANVAS_INLINE_BLOCKS.includes(block))
      : [];
  const inlineBlocks = c.blocks.filter((block) => !menuBlocks.includes(block));
  const overflowItems = overflowItemsOf(c, menuBlocks, blockButtons);

  return (
    <div
      className={cn(
        "flex items-center border-b border-input",
        canvas
          ? "min-h-9 flex-nowrap gap-0 overflow-hidden bg-background px-1.5 [&>*]:shrink-0 [&_button]:h-7 [&_button]:gap-1 [&_button]:px-1 [&_button]:text-xs"
          : "flex-wrap gap-1 p-1",
      )}
    >
      {renderParagraphStyleSelect(c)}
      <Separator compact={compact || canvas} />
      {renderMarkButtons(c)}
      <Separator compact={compact || canvas} />
      {renderListButtons(c)}
      {renderPlaceholderButton(c)}
      {inlineBlocks.length > 0 && <Separator compact={compact || canvas} />}
      {inlineBlocks.map((block) => renderInlineBlock(c, block, blockButtons))}
      {c.print !== "none" && <Separator compact={compact || canvas} />}
      {renderPrintBlockMenu(c)}
      {overflowItems.length > 0 && ActionOverflowMenu !== undefined && (
        <span className="ml-auto shrink-0">
          <ActionOverflowMenu
            items={overflowItems}
            label={t("template-resolver.documentEditor.more")}
            testId={`${id}-toolbar-more`}
          />
        </span>
      )}
    </div>
  );
}
