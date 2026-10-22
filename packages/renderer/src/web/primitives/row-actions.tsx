import type { RowActionDisplay } from "@cosmicdrift/kumiko-framework/ui-types";
import { Loader2, MoreHorizontal } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { ListRowViewModel } from "../../headless/index.ts";
import type { DataTableRowAction, DataTableRowActionMode } from "../../index.ts";
import {
  type ActionMenuItemSpec,
  type ActionOverflowMenuProps,
  needsActionConfirm,
  shouldRenderActionsIconOnly,
  useTranslation,
  WriteFailedError,
} from "../../index.ts";
import { Icon } from "../icons.tsx";
import { cn } from "../lib/cn.ts";
import { Button as UiButton } from "../ui/button.tsx";
import { DefaultDialog } from "./dialog.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.tsx";
import { useToast } from "./toast.tsx";
import "../react-css-custom-properties.ts";
import { actionIconFor, SECONDARY_BUTTON_EXTRA_CLASSES } from "./button.tsx";

// The primary row action always remains a visible text button: `edit` when declared,
// otherwise the first visible action ("Edit appears in every row, always, as text").
function primaryRowAction(actions: readonly DataTableRowAction[]): DataTableRowAction | undefined {
  return actions.find((a) => a.id === "edit") ?? actions[0];
}

// RowActionsCell renders the row actions depending on `mode`:
//   - "adaptive" (default): when the row itself is the link (`rowIsLink`)
//     every action sits in the kebab; otherwise the primary action (see
//     `primaryRowAction`) is a link-button and the rest goes into the kebab.
//     A single action never gets a kebab.
//   - "inline": ALWAYS inline buttons, left-aligned + full-width, even for
//     >2 (no kebab). `w-full justify-start` pins the first button to the
//     column's left edge so it sits at the same position across rows
//     (otherwise it would drift with differently-sized labels).
// The isVisible filter runs here; an action hidden for a given row never
// reaches render. If every action is hidden, the cell stays empty (no
// phantom column).
export function RowActionsCell({
  row,
  actions,
  mode = "adaptive",
  rowIsLink = false,
  compact = false,
}: {
  readonly row: ListRowViewModel;
  readonly actions: readonly DataTableRowAction[];
  readonly mode?: DataTableRowActionMode;
  readonly rowIsLink?: boolean;
  readonly compact?: boolean;
}): ReactNode {
  const visible = actions.filter((a) => a.isVisible === undefined || a.isVisible(row));
  if (visible.length === 0) return null;
  const hasExplicitDisplay = visible.some((a) => a.display !== undefined);
  if (mode === "inline") {
    // Teil C: >2 actions all carrying an icon collapse to icon-only —
    // otherwise "inline" is exactly the wall-to-wall text-button problem
    // this feature exists to fix. An author-set `display` takes that choice over.
    const iconOnly = !hasExplicitDisplay && shouldRenderActionsIconOnly(visible);
    return (
      <div className="flex w-full items-center gap-1 justify-start">
        {visible.map((a) => (
          <RowActionButton key={a.id} row={row} action={a} iconOnly={iconOnly} compact={compact} />
        ))}
      </div>
    );
  }
  if (hasExplicitDisplay) {
    const inline = visible.filter((a) => a.display !== undefined);
    const rest = visible.filter((a) => a.display === undefined);
    return (
      <div className="inline-flex flex-wrap items-center gap-1 justify-end">
        {inline.map((a) => (
          <RowActionButton key={a.id} row={row} action={a} compact={compact} />
        ))}
        {rest.length > 0 && <RowActionsKebab row={row} actions={rest} />}
      </div>
    );
  }
  if (rowIsLink) {
    return (
      <div className="inline-flex items-center justify-end">
        <RowActionsKebab row={row} actions={visible} />
      </div>
    );
  }
  const primary = primaryRowAction(visible);
  const rest = visible.filter((a) => a.id !== primary?.id);
  return (
    <div className="inline-flex flex-wrap items-center gap-1 justify-end">
      {primary !== undefined && <RowActionButton row={row} action={primary} asLink />}
      {rest.length > 0 && <RowActionsKebab row={row} actions={rest} />}
    </div>
  );
}

// Shared trigger state between inline button + kebab item: busy flag
// (while the async onTrigger runs) + confirm-pending action. Both
// sub-components had duplicated the same state block in parallel to the
// confirm dialog render logic; the hook consolidates that.

function useRowActionTrigger(row: ListRowViewModel) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const t = useTranslation();
  const triggerNow = async (action: DataTableRowAction): Promise<void> => {
    setBusy(true);
    try {
      await action.onTrigger(row);
    } catch (e) {
      // Surface instead of swallow: a swallowed write error looked like
      // "nothing happened" to the user (prod bug 2026-06-07).
      const dispatcherError = e instanceof WriteFailedError ? e.dispatcherError : undefined;
      const docsUrl = dispatcherError?.docsUrl;
      const requestId = dispatcherError?.requestId;
      toast({
        title: t("kumiko.rowAction.failed"),
        description: e instanceof Error ? e.message : String(e),
        variant: "bad",
        ...(docsUrl !== undefined && { docsUrl }),
        ...(requestId !== undefined && { requestId }),
      });
    } finally {
      setBusy(false);
    }
  };
  return { busy, triggerNow };
}

// An icon-only form without a resolvable icon would render an empty button.
// `compact` is the narrow card layout, where "responsive" collapses to its icon.
function effectiveRowActionDisplay(
  display: RowActionDisplay | undefined,
  hasIcon: boolean,
  compact: boolean,
): Exclude<RowActionDisplay, "responsive"> | undefined {
  if (display === "responsive") return hasIcon && compact ? "icon" : "button";
  if (display === "icon" && !hasIcon) return "link";
  return display;
}

function RowActionButton({
  row,
  action,
  iconOnly = false,
  asLink = false,
  compact = false,
}: {
  readonly row: ListRowViewModel;
  readonly action: DataTableRowAction;
  readonly asLink?: boolean;
  readonly compact?: boolean;
  /** Group-level collapse (see `shouldRenderActionsIconOnly`) — only takes
   *  effect when this action actually resolved an icon. */
  readonly iconOnly?: boolean;
}): ReactNode {
  const { busy, triggerNow } = useRowActionTrigger(row);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const resolvedIcon = actionIconFor(action.icon);
  const display = effectiveRowActionDisplay(action.display, resolvedIcon !== undefined, compact);
  const isBorderedButton = display === "button";
  const showIconOnly =
    display === "icon" || (display === undefined && iconOnly && resolvedIcon !== undefined);
  const linkLike = display === "link" || (display === undefined && asLink);

  const variantClass = isBorderedButton
    ? action.style === "primary"
      ? "border border-transparent bg-primary text-primary-foreground hover:bg-primary/90"
      : action.style === "danger"
        ? "border border-destructive/40 bg-card text-destructive hover:bg-destructive/10"
        : "border border-border-strong bg-card text-foreground hover:bg-accent"
    : action.style === "danger"
      ? "text-destructive hover:bg-destructive/10"
      : linkLike
        ? "font-medium text-primary hover:bg-muted"
        : action.style === "primary"
          ? "text-primary hover:bg-primary/10"
          : "text-foreground hover:bg-accent";

  return (
    <>
      <button
        type="button"
        data-testid={`row-${row.id}-action-${action.id}`}
        disabled={busy}
        {...(showIconOnly && { "aria-label": action.label, title: action.label })}
        onClick={(e) => {
          e.stopPropagation();
          if (needsActionConfirm(action)) {
            setConfirmOpen(true);
          } else {
            void triggerNow(action);
          }
        }}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 text-sm",
          isBorderedButton
            ? "h-8 rounded-md px-3 font-medium max-md:h-11"
            : linkLike
              ? "h-7 rounded-md px-2.5 max-md:h-11"
              : "h-8 rounded-sm max-md:h-11",
          showIconOnly ? "w-8 max-md:w-11" : !linkLike && !isBorderedButton && "px-2",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:opacity-50 disabled:pointer-events-none",
          variantClass,
        )}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : resolvedIcon === undefined || (linkLike && !showIconOnly) ? (
          action.label
        ) : showIconOnly ? (
          <Icon name={resolvedIcon} className="size-4" />
        ) : (
          <>
            <Icon name={resolvedIcon} className="size-4" />
            {action.label}
          </>
        )}
      </button>
      <DefaultDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={action.label}
        {...(action.confirm !== undefined && { description: action.confirm })}
        confirmLabel={action.confirmLabel ?? action.label}
        {...(action.style === "danger" && { variant: "danger" as const })}
        onConfirm={() => triggerNow(action)}
        testId={`row-${row.id}-action-${action.id}-dialog`}
      />
    </>
  );
}

// Kebab dropdown for >2 actions, one inline confirm dialog per item like
// the inline-button path. Menu is controlled so it closes explicitly on
// select, instead of relying on Radix's auto-close, which preventDefault
// below blocks.
function RowActionsKebab({
  row,
  actions,
}: {
  readonly row: ListRowViewModel;
  readonly actions: readonly DataTableRowAction[];
}): ReactNode {
  const { triggerNow } = useRowActionTrigger(row);
  const t = useTranslation();
  const [pendingConfirm, setPendingConfirm] = useState<DataTableRowAction | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("kumiko.list.row-actions.more")}
            data-testid={`row-${row.id}-actions-menu`}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-md max-md:size-11",
              "hover:bg-accent text-muted-foreground hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          // Radix refocuses the trigger after the exit animation, which by then sits behind the confirm dialog's aria-hidden.
          onCloseAutoFocus={(e) => {
            if (pendingConfirm !== null) e.preventDefault();
          }}
        >
          {actions.map((action) => (
            <DropdownMenuItem
              key={action.id}
              data-testid={`row-${row.id}-action-${action.id}`}
              onSelect={(e) => {
                e.preventDefault();
                setMenuOpen(false);
                if (needsActionConfirm(action)) {
                  setPendingConfirm(action);
                } else {
                  void triggerNow(action);
                }
              }}
              className={cn(action.style === "danger" && "text-destructive focus:text-destructive")}
            >
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {pendingConfirm !== null && (
        <DefaultDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setPendingConfirm(null);
          }}
          title={pendingConfirm.label}
          {...(pendingConfirm.confirm !== undefined && { description: pendingConfirm.confirm })}
          confirmLabel={pendingConfirm.confirmLabel ?? pendingConfirm.label}
          {...(pendingConfirm.style === "danger" && { variant: "danger" as const })}
          onConfirm={async () => {
            const action = pendingConfirm;
            setPendingConfirm(null);
            await triggerNow(action);
          }}
          testId={`row-${row.id}-action-${pendingConfirm.id}-dialog`}
        />
      )}
    </>
  );
}

// Header/row-actions overflow menu: the trigger carries the classes of a
// secondary icon Button so it matches neighbouring icon buttons, including
// the 44 px touch size on phones. Generic ActionMenuItemSpec items instead of
// the DataTableRowAction schema (callers own confirm/danger handling per item).
export function ActionOverflowMenu({ items, label, testId }: ActionOverflowMenuProps): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <UiButton
          type="button"
          variant="outline"
          size="icon"
          className={SECONDARY_BUTTON_EXTRA_CLASSES}
          aria-label={label}
          data-testid={testId ?? "action-overflow-menu-trigger"}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </UiButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item: ActionMenuItemSpec) => {
          const resolvedIcon = actionIconFor(item.icon);
          return (
            <DropdownMenuItem
              key={item.id}
              data-testid={item.testId ?? `${testId ?? "action-overflow-menu"}-item-${item.id}`}
              disabled={item.disabled === true}
              onSelect={(e) => {
                e.preventDefault();
                setOpen(false);
                item.onSelect();
              }}
              className={cn(item.variant === "danger" && "text-destructive focus:text-destructive")}
            >
              {resolvedIcon !== undefined && <Icon name={resolvedIcon} className="size-4" />}
              {item.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
