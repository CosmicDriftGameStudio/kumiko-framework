import {
  type ButtonProps,
  FOOTER_ACTION_ROLE_PROP,
  type FooterActionMarker,
  NARROW_LABEL_PROP,
  STICKY_PRIMARY_ACTION_PROP,
  type StickyPrimaryActionMarker,
} from "@cosmicdrift/kumiko-renderer";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { MoreHorizontal } from "lucide-react";
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn.js";
import { Button as UiButton } from "../ui/button.js";

type FooterNodeProps = ButtonProps & FooterActionMarker & StickyPrimaryActionMarker;

type FooterElement = ReactElement<FooterNodeProps>;

function asFooterElement(node: ReactNode): FooterElement | undefined {
  return isValidElement<FooterNodeProps>(node) ? node : undefined;
}

function backAccessibleName(node: FooterElement): string | undefined {
  const { children, ariaLabel } = node.props;
  return typeof children === "string" ? children : ariaLabel;
}

// Back collapses to an icon, so it needs a name that survives losing its children;
// without one it stays a regular overflow action.
function isIconizableBackNode(node: ReactNode): boolean {
  const element = asFooterElement(node);
  return (
    element?.props[FOOTER_ACTION_ROLE_PROP] === "back" && backAccessibleName(element) !== undefined
  );
}

function isExplicitPrimaryNode(node: ReactNode): boolean {
  return asFooterElement(node)?.props[FOOTER_ACTION_ROLE_PROP] === "primary";
}

function isSubmitNode(node: ReactNode): boolean {
  return asFooterElement(node)?.props.type === "submit";
}

function isPrimaryNode(node: ReactNode): boolean {
  return isExplicitPrimaryNode(node) || isSubmitNode(node);
}

function isStickyMarkedNode(node: ReactNode): boolean {
  return asFooterElement(node)?.props[STICKY_PRIMARY_ACTION_PROP] === true;
}

function lastOf<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

type NarrowFooterParts = {
  readonly back: ReactNode | undefined;
  readonly primary: ReactNode | undefined;
  readonly overflow: readonly ReactNode[];
};

function splitNarrowFooterNodes(nodes: readonly ReactNode[]): NarrowFooterParts {
  const back = nodes.find(isIconizableBackNode);
  const primary =
    nodes.find(isExplicitPrimaryNode) ??
    lastOf(nodes.filter(isSubmitNode)) ??
    lastOf(nodes.filter(isStickyMarkedNode));
  return {
    back,
    primary,
    overflow: nodes.filter((node) => node !== back && node !== primary),
  };
}

function BackIconButton({ node }: { readonly node: FooterElement }): ReactNode {
  return cloneElement(node, {
    size: "icon",
    ariaLabel: backAccessibleName(node),
    children: null,
  });
}

// Stands in for the unsaved text and the overflow badge while the "…" trigger is not visible.
function UnsavedIndicator({
  status,
  testId,
}: {
  readonly status: string;
  readonly testId: string | undefined;
}): ReactNode {
  return (
    <>
      <span
        aria-hidden="true"
        data-testid={testId}
        className="absolute top-1 right-1 size-2 rounded-full bg-status-active"
      />
      <span className="sr-only">{status}</span>
    </>
  );
}

function PrimaryButton({
  node,
  unsavedStatus,
  indicatorTestId,
}: {
  readonly node: ReactNode;
  readonly unsavedStatus: string | undefined;
  readonly indicatorTestId: string | undefined;
}): ReactNode {
  const indicator =
    unsavedStatus !== undefined ? (
      <UnsavedIndicator status={unsavedStatus} testId={indicatorTestId} />
    ) : null;
  const element = asFooterElement(node);
  if (element === undefined || !isPrimaryNode(node)) {
    return (
      <div className="relative min-w-0 flex-1 [&>button]:w-full">
        {node}
        {indicator}
      </div>
    );
  }
  const narrowLabel = element.props[NARROW_LABEL_PROP];
  return cloneElement(element, {
    className: "relative min-w-0 flex-1",
    children: (
      <>
        <span className="min-w-0 truncate">{narrowLabel ?? element.props.children}</span>
        {indicator}
      </>
    ),
  });
}

// Overflow nodes are arbitrary (slot mounts may render nothing, buttons may be disabled),
// so "has something to offer" is read from the mounted DOM, not from the elements.
const ENABLED_ACTION_SELECTOR =
  "button:not(:disabled):not([aria-disabled='true']), a[href]:not([aria-disabled='true'])";

function useContainsEnabledAction(container: HTMLElement | null): boolean {
  const [containsEnabledAction, setContainsEnabledAction] = useState(false);
  useLayoutEffect(() => {
    if (container === null) return;
    const update = (): void =>
      setContainsEnabledAction(container.querySelector(ENABLED_ACTION_SELECTOR) !== null);
    update();
    const observer = new MutationObserver(update);
    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["disabled", "aria-disabled", "href"],
    });
    return () => observer.disconnect();
  }, [container]);
  return containsEnabledAction;
}

function createOverflowHolder(): HTMLDivElement {
  const holder = document.createElement("div");
  holder.style.display = "contents";
  return holder;
}

// The overflow nodes are rendered once into a detached holder element that is moved into the
// popover content while open and back into an always-mounted hidden host while closed. That keeps
// dialogs owned by overflow actions mounted, without keeping the popover's DismissableLayer and
// FocusScope (Escape handling, focus trap) alive while it is closed.
function OverflowPopover({
  nodes,
  holder,
  label,
  unsavedCount,
  testId,
  hasEnabledAction,
}: {
  readonly nodes: readonly ReactNode[];
  readonly holder: HTMLDivElement | null;
  readonly label: string;
  readonly unsavedCount: number | undefined;
  readonly testId: string | undefined;
  readonly hasEnabledAction: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const isDirty = unsavedCount !== undefined && unsavedCount > 0;
  const setHost = useCallback(
    (element: HTMLDivElement | null) => {
      hostRef.current = element;
      if (element !== null && holder !== null) element.appendChild(holder);
    },
    [holder],
  );
  // Radix recomposes its content ref now and then, calling this with null in between; reacting to
  // that would move the holder out and drop the focus the popover just placed on its first action.
  const setContent = useCallback(
    (element: HTMLDivElement | null) => {
      if (element !== null && holder !== null && holder.parentElement !== element) {
        element.appendChild(holder);
      }
    },
    [holder],
  );
  // Closes the popover once an action was picked. Native listener: the holder moves between DOM
  // parents, and no React ancestor of its content is an interactive element to hang onClick on.
  useEffect(() => {
    if (holder === null) return;
    const closeOnAction = (event: MouseEvent): void => {
      if (event.target instanceof Element && event.target.closest("button") !== null) {
        setOpen(false);
      }
    };
    holder.addEventListener("click", closeOnAction);
    return () => holder.removeEventListener("click", closeOnAction);
  }, [holder]);
  const popoverShown = open && hasEnabledAction;
  useLayoutEffect(() => {
    if (!popoverShown && holder !== null && hostRef.current !== null) {
      hostRef.current.appendChild(holder);
    }
  }, [popoverShown, holder]);
  return (
    <PopoverPrimitive.Root open={popoverShown} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <UiButton
          type="button"
          variant="outline"
          size="icon"
          className={cn(
            "relative shrink-0 border-input hover:bg-muted",
            !hasEnabledAction && "hidden",
          )}
          aria-label={label}
          data-testid={testId !== undefined ? `${testId}-overflow` : undefined}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
          {isDirty && (
            <span
              aria-hidden="true"
              data-testid={testId !== undefined ? `${testId}-overflow-badge` : undefined}
              className="absolute top-1 right-1 size-2 rounded-full bg-status-active"
            />
          )}
        </UiButton>
      </PopoverPrimitive.Trigger>
      <div ref={setHost} className="hidden">
        {holder !== null && createPortal(nodes, holder)}
      </div>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={setContent}
          side="top"
          align="center"
          sideOffset={8}
          className={cn(
            "z-50 flex w-[calc(100vw-2rem)] flex-col gap-1 rounded-md border border-border bg-card p-1 shadow-md",
            "[&_button]:w-full [&_button]:justify-start [&_button]:text-left",
          )}
        />
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** Pinned footer below `sm`: always one fixed-height row, Back as icon on the left,
 *  everything else in a "…" popover (hidden while none of it is enabled), the primary
 *  action filling the rest. */
export function NarrowPinnedFooter({
  nodes,
  overflowLabel,
  unsavedCount,
  unsavedStatus,
  testId,
  keyboardInset,
}: {
  readonly nodes: readonly ReactNode[];
  readonly overflowLabel: string;
  readonly unsavedCount: number | undefined;
  readonly unsavedStatus: string | undefined;
  readonly testId: string | undefined;
  readonly keyboardInset: number;
}): ReactNode {
  const { back, primary, overflow } = splitNarrowFooterNodes(nodes);
  const backElement = asFooterElement(back);
  const [holder] = useState<HTMLDivElement | null>(() =>
    typeof document === "undefined" ? null : createOverflowHolder(),
  );
  const hasEnabledAction = useContainsEnabledAction(holder);
  const overflowTriggerVisible = overflow.length > 0 && hasEnabledAction;
  const isDirty = unsavedCount !== undefined && unsavedCount > 0;
  return (
    <div
      data-testid={testId !== undefined ? `${testId}-actions` : undefined}
      className="flex h-14 shrink-0 items-center gap-2 border-t border-border bg-card px-4"
      // iOS ignores interactive-widget=resizes-content, so the in-flow footer would stay behind the keyboard.
      style={
        keyboardInset > 0
          ? { transform: `translateY(-${keyboardInset}px)`, position: "relative", zIndex: 10 }
          : undefined
      }
    >
      {backElement !== undefined && <BackIconButton node={backElement} />}
      {overflow.length > 0 && (
        <OverflowPopover
          nodes={overflow}
          holder={holder}
          label={overflowLabel}
          unsavedCount={unsavedCount}
          testId={testId}
          hasEnabledAction={hasEnabledAction}
        />
      )}
      {primary !== undefined && (
        <PrimaryButton
          node={primary}
          unsavedStatus={isDirty && !overflowTriggerVisible ? unsavedStatus : undefined}
          indicatorTestId={testId !== undefined ? `${testId}-primary-badge` : undefined}
        />
      )}
    </div>
  );
}
