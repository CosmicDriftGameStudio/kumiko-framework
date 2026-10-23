import type { ActionMenuItemSpec } from "@cosmicdrift/kumiko-renderer";
import { cn } from "@cosmicdrift/kumiko-renderer/web";
import {
  AlignLeft,
  Braces,
  ChevronDown,
  GalleryThumbnails,
  Image as ImageIcon,
  ListChecks,
  Minus,
  MousePointerClick,
  Repeat,
  Scissors,
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
} from "./document-tiptap-toolbar-groups.tsx";
import type { DocumentToolbarBlock } from "./document-toolbar-blocks.ts";

type BlockButtons = Record<DocumentToolbarBlock, { label: string; icon: ReactNode }>;

function Separator({ compact = false }: { readonly compact?: boolean }): ReactNode {
  return (
    <span aria-hidden="true" className={cn("h-5 w-px bg-border", compact ? "mx-0.5" : "mx-2")} />
  );
}

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

export function renderToolbarBar(c: TiptapContext): ReactNode {
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
      <Separator compact={compact || canvas} />
      {labelledButton(c, {
        label: t("template-resolver.documentEditor.insertPlaceholder"),
        icon: <Braces size={16} />,
        showIcon: true,
        trailingIcon: canvas ? <ChevronDown size={12} /> : undefined,
        expanded: c.openPanel === "placeholder",
        onClick: () => c.togglePanel("placeholder"),
      })}
      {inlineBlocks.length > 0 && <Separator compact={compact || canvas} />}
      {inlineBlocks.map((block) => renderInlineBlock(c, block, blockButtons))}
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
