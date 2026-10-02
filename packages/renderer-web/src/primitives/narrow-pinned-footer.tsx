import {
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
  useLayoutEffect,
  useState,
} from "react";
import { cn } from "../lib/cn.js";
import { Button as UiButton } from "../ui/button.js";

type FooterNodeProps = {
  readonly type?: string;
  readonly children?: ReactNode;
  readonly ariaLabel?: string;
} & FooterActionMarker &
  StickyPrimaryActionMarker;

type FooterElement = ReactElement<FooterNodeProps>;

function asFooterElement(node: ReactNode): FooterElement | undefined {
  return isValidElement<FooterNodeProps>(node) ? node : undefined;
}

function isBackNode(node: ReactNode): boolean {
  return asFooterElement(node)?.props[FOOTER_ACTION_ROLE_PROP] === "back";
}

function isPrimaryNode(node: ReactNode): boolean {
  const props = asFooterElement(node)?.props;
  return props?.[FOOTER_ACTION_ROLE_PROP] === "primary" || props?.type === "submit";
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
  const back = nodes.find(isBackNode);
  const primary = lastOf(nodes.filter(isPrimaryNode)) ?? lastOf(nodes.filter(isStickyMarkedNode));
  return {
    back,
    primary,
    overflow: nodes.filter((node) => node !== back && node !== primary),
  };
}

function BackIconButton({ node }: { readonly node: FooterElement }): ReactNode {
  const { children, ariaLabel } = node.props;
  return cloneElement(node, {
    size: "icon",
    ariaLabel: typeof children === "string" ? children : ariaLabel,
    children: null,
  } as Partial<FooterNodeProps>);
}

function PrimaryButton({ node }: { readonly node: ReactNode }): ReactNode {
  const element = asFooterElement(node);
  if (element === undefined || !isPrimaryNode(node)) {
    return <div className="min-w-0 flex-1 [&>button]:w-full">{node}</div>;
  }
  const narrowLabel = element.props[NARROW_LABEL_PROP];
  return cloneElement(element, {
    className: "min-w-0 flex-1",
    children: <span className="min-w-0 truncate">{narrowLabel ?? element.props.children}</span>,
  } as Partial<FooterNodeProps>);
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

function OverflowPopover({
  nodes,
  label,
  unsavedCount,
  testId,
}: {
  readonly nodes: readonly ReactNode[];
  readonly label: string;
  readonly unsavedCount: number | undefined;
  readonly testId: string | undefined;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const hasEnabledAction = useContainsEnabledAction(content);
  const isDirty = unsavedCount !== undefined && unsavedCount > 0;
  return (
    <PopoverPrimitive.Root open={open && hasEnabledAction} onOpenChange={setOpen}>
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
      {/* A DropdownMenu can't host these nodes: they are arbitrary elements (footer slot,
          action buttons owning dialogs). forceMount keeps those dialogs mounted while closed. */}
      <PopoverPrimitive.Portal forceMount>
        <PopoverPrimitive.Content
          ref={setContent}
          forceMount
          side="top"
          align="center"
          sideOffset={8}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("button") !== null) setOpen(false);
          }}
          className={cn(
            "z-50 flex w-[calc(100vw-2rem)] flex-col gap-1 rounded-md border border-border bg-card p-1 shadow-md",
            "[&_button]:w-full [&_button]:justify-start [&_button]:text-left",
            "data-[state=closed]:hidden",
          )}
        >
          {nodes}
        </PopoverPrimitive.Content>
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
  testId,
}: {
  readonly nodes: readonly ReactNode[];
  readonly overflowLabel: string;
  readonly unsavedCount: number | undefined;
  readonly testId: string | undefined;
}): ReactNode {
  const { back, primary, overflow } = splitNarrowFooterNodes(nodes);
  const backElement = asFooterElement(back);
  return (
    <div
      data-testid={testId !== undefined ? `${testId}-actions` : undefined}
      className="flex h-14 shrink-0 items-center gap-2 border-t border-border bg-card px-4"
    >
      {backElement !== undefined && <BackIconButton node={backElement} />}
      {overflow.length > 0 && (
        <OverflowPopover
          nodes={overflow}
          label={overflowLabel}
          unsavedCount={unsavedCount}
          testId={testId}
        />
      )}
      {primary !== undefined && <PrimaryButton node={primary} />}
    </div>
  );
}
