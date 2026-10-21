import {
  Children,
  Fragment,
  isValidElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type FormProps,
  type FormSectionNavItem,
  type FormWidth,
  STICKY_PRIMARY_ACTION_PROP,
  type StickyPrimaryActionMarker,
  useTranslation,
} from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { screenPaddingClassName, screenWidthClassName } from "./layout.tsx";
import { NarrowPinnedFooter } from "./narrow-pinned-footer.tsx";
import { STICKY_FOOTER_SAFE_AREA_CLASS, STICKY_FOOTER_SPACER_CLASS } from "./sticky-action-bar.tsx";
import { useKeyboardInset } from "./use-keyboard-inset.ts";
import { useIsBelowSmViewport } from "./use-narrow-viewport.ts";
import "../react-css-custom-properties.ts";
import { cardFooterBorder, cardHeaderBorder } from "./card-styles.ts";
import { InsideFormContext, ScreenFormContext, ScreenWidthContext } from "./contexts.tsx";

// Extension sections that render their own <form> via BareFormProvider
// (legacy custom-form pattern, e.g. ChangeEmailSection before fw#2703) land
// inside RenderEdit's host <form> (ExtensionSectionMount, render-edit.tsx) —
// nested <form> elements are invalid DOM, and real browsers can silently
// fall back to a native GET submit of the OUTER form, leaking field values
// into the URL (fw#2312, fw#2705). Degrading to a <div> when already inside
// a form avoids the nesting; the captured click still routes to THIS form's
// onSubmit instead of activating the real ancestor <form>.
const SUBMIT_CONTROL_SELECTOR = [
  "button[type=submit]:not(:disabled)",
  "button:not([type]):not(:disabled)",
  "input[type=submit]:not(:disabled)",
  "input[type=image]:not(:disabled)",
].join(", ");

export function FormRoot({
  onSubmit,
  testId,
  className,
  children,
  focusFirstErrorKey,
}: {
  readonly onSubmit: FormProps["onSubmit"];
  readonly testId?: string;
  readonly className?: string;
  readonly children: ReactNode;
  readonly focusFirstErrorKey?: number | undefined;
}): ReactNode {
  const rootRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (focusFirstErrorKey === undefined || focusFirstErrorKey === 0) return;
    const firstInvalid = rootRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (firstInvalid === null || firstInvalid === undefined) return;
    firstInvalid.focus();
    firstInvalid.scrollIntoView({ block: "center" });
  }, [focusFirstErrorKey]);
  if (useContext(InsideFormContext)) {
    return (
      <div
        ref={(node) => {
          rootRef.current = node;
        }}
        data-kumiko-form-root=""
        onKeyDownCapture={(e) => {
          // Implicit submission: the section's inputs belong to the OUTER
          // <form> in the DOM, so the browser would otherwise route Enter to
          // that form's default button.
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          const field = e.target;
          if (!(field instanceof HTMLInputElement)) return;
          if (field.closest("[data-kumiko-form-root]") !== e.currentTarget) return;
          if (["checkbox", "radio", "submit", "button"].includes(field.type)) return;
          e.preventDefault();
          onSubmit();
        }}
        onClickCapture={(e) => {
          // @cast-boundary dom-event-target: closest() needs an Element, and
          // click targets are always one in the browser/happy-dom.
          const submitButton = (e.target as HTMLElement).closest(SUBMIT_CONTROL_SELECTOR);
          if (submitButton === null) return;
          // React events bubble through portals and nested degraded roots; a
          // real <form> only reacts to buttons in its own DOM subtree.
          if (submitButton.closest("[data-kumiko-form-root]") !== e.currentTarget) return;
          e.preventDefault();
          onSubmit();
        }}
        data-testid={testId}
        className={className}
      >
        {children}
      </div>
    );
  }
  return (
    <form
      ref={(node) => {
        rootRef.current = node;
      }}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(e);
      }}
      data-testid={testId}
      className={className}
    >
      {children}
    </form>
  );
}

// stickyActions alone pins the primary action with `position: fixed` on
// narrow viewports; together with fillHeight the flex chain pins the footer
// on every viewport instead.
export function isPinnedFooter(
  stickyActions: boolean | undefined,
  fillHeight: boolean | undefined,
): boolean {
  return stickyActions === true && fillHeight === true;
}

// Sections wrapper for DefaultForm's card and chromeless layouts alike —
// only the card-derived padding on non-section children differs between
// them (see `chromeless` doc on FormProps).
export function FormSections({
  children,
  chromeless,
  stickyActions,
  fillHeight,
  screenForm = false,
}: {
  readonly children: ReactNode;
  readonly chromeless: boolean;
  readonly stickyActions: boolean | undefined;
  readonly fillHeight: boolean | undefined;
  readonly screenForm?: boolean;
}): ReactNode {
  if (screenForm) {
    return (
      <div className="flex flex-col gap-9">
        <InsideFormContext.Provider value={true}>
          <ScreenFormContext.Provider value={true}>{children}</ScreenFormContext.Provider>
        </InsideFormContext.Provider>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex flex-col",
        // For section children (auto-UI edit) a line separates THEM — they pad
        // themselves. Flat fields (custom screens) get padding + rhythm, no line
        // between every field.
        "[&>section:not(:first-child)]:border-t",
        // Margins, not padding: padding would land inside a child that has its own border/height.
        !chromeless && "[&>:not(section)]:mx-6 [&>:not(section)]:my-3",
        !chromeless && "[&>:not(section):first-child]:mt-6 [&>:not(section):last-child]:mb-6",
        // ponytail: fixed footer now pins only the primary action (single
        // button row + its own p-4, fw#2606) instead of the whole footer —
        // shrunk from pb-32 accordingly. Widen again if a wizard's primary
        // action ever wraps to two rows.
        stickyActions === true && fillHeight !== true && STICKY_FOOTER_SPACER_CLASS,
        // Same "no flex-1" reasoning as the card above: this is the
        // one section allowed to shrink (min-h-0) inside the card, not
        // one forced to grow past its content.
        // Chromeless has no card above to hold a floor, so the sections do.
        fillHeight === true && (chromeless ? "min-h-64" : "min-h-0"),
        // The flex chain pins the footer, so the sections are the scroll surface.
        isPinnedFooter(stickyActions, fillHeight) && "flex-1 overflow-y-auto",
      )}
    >
      <InsideFormContext.Provider value={true}>{children}</InsideFormContext.Provider>
    </div>
  );
}

// Title/subtitle block shared by DefaultForm's card and chromeless layouts —
// RenderEdit already withholds screen.description from `subtitle` in tabs
// mode (chromeless), so whatever arrives here still renders, just without card chrome.
export function FormTitleBlock({
  title,
  subtitle,
  titleAction,
  testId,
  bordered,
  fillHeight,
}: {
  readonly title: ReactNode;
  readonly subtitle: ReactNode;
  readonly titleAction: ReactNode;
  readonly testId: string | undefined;
  readonly bordered: boolean;
  readonly fillHeight: boolean | undefined;
}): ReactNode {
  if (title === undefined && subtitle === undefined && titleAction === undefined) return null;
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4",
        bordered ? cn(cardHeaderBorder, "px-6 pb-4 pt-5") : "pb-4",
        fillHeight === true && "shrink-0",
      )}
    >
      <div className="min-w-0">
        {title !== undefined && (
          <h2
            data-testid={testId !== undefined ? `${testId}-title` : undefined}
            className="text-lg font-semibold tracking-tight"
          >
            {title}
          </h2>
        )}
        {subtitle !== undefined && (
          <p
            data-testid={testId !== undefined ? `${testId}-subtitle` : undefined}
            className="mt-1 text-sm text-muted-foreground"
          >
            {subtitle}
          </p>
        )}
      </div>
      {titleAction !== undefined && (
        <div
          data-testid={testId !== undefined ? `${testId}-title-action` : undefined}
          className="flex shrink-0 flex-wrap items-center justify-end gap-2"
        >
          {titleAction}
        </div>
      )}
    </div>
  );
}

// `formActions` (render-edit.tsx) mixes a non-submit wizard Back button in
// with the submit-type Next/Finish button inside one Fragment — only the
// submit one is the "primary" action that fw#1918 needs pinned above a
// virtual keyboard. Back reads as `type="button"`, same as `secondaryActions`
// (Cancel/Delete/…), so it can safely join that group on mobile. A footer-slot
// mount can't expose `type="submit"` (its button is opaque app code), so it
// opts in via `STICKY_PRIMARY_ACTION_PROP` instead (`ScreenSlots.footerPrimary`).
function isPrimaryStickyAction(node: ReactNode): boolean {
  if (!isValidElement(node)) return false;
  const props = node.props as { readonly type?: string } & StickyPrimaryActionMarker;
  return props.type === "submit" || props[STICKY_PRIMARY_ACTION_PROP] === true;
}

// `actions` from render-edit.tsx arrives as a single `<>…</>` Fragment
// element (not spread children) — Children.toArray only flattens fragments
// nested inside an already-flattened children list, not a Fragment passed
// as the whole value, so the Fragment's own children are unwrapped first.
function flattenActionNodes(node: ReactNode): readonly ReactNode[] {
  if (isValidElement(node) && node.type === Fragment) {
    return Children.toArray((node.props as { readonly children?: ReactNode }).children);
  }
  return Children.toArray(node);
}

function unsavedStatusText(t: ReturnType<typeof useTranslation>, unsavedCount: number): string {
  if (unsavedCount === 0) return t("kumiko.form.noUnsavedChanges");
  if (unsavedCount === 1) return t("kumiko.form.unsaved.one");
  return t("kumiko.form.unsaved.other", { count: unsavedCount });
}

// Footer wrapper for DefaultForm's card and chromeless layouts alike — only
// the card-derived horizontal padding/border differs between them.
export function FormFooter({
  actions,
  secondaryActions,
  testId,
  chromeless,
  stickyActions,
  fillHeight,
  unsavedCount,
  railed = false,
}: {
  readonly actions: ReactNode;
  readonly secondaryActions: ReactNode;
  readonly testId: string | undefined;
  readonly chromeless: boolean;
  readonly stickyActions: boolean | undefined;
  readonly fillHeight: boolean | undefined;
  readonly unsavedCount?: number;
  /** Footer sits under a step rail: symmetric px-6 instead of the form column's left inset. */
  readonly railed?: boolean;
}): ReactNode {
  const t = useTranslation();
  const isBelowSm = useIsBelowSmViewport();
  const keyboardInset = useKeyboardInset();
  if (actions === undefined && secondaryActions === undefined) return null;
  // Only split when sticky: the non-sticky (regular, non-wizard) footer must
  // reproduce the previous DOM exactly (form-action-bar.test.tsx pins
  // `-actions`/`-actions-secondary` content 1:1 to the `actions`/
  // `secondaryActions` props).
  const actionNodes = stickyActions === true ? flattenActionNodes(actions) : undefined;
  const primaryActionNodes = actionNodes?.filter(isPrimaryStickyAction);
  const hasPrimaryAction = primaryActionNodes !== undefined && primaryActionNodes.length > 0;
  // No primary node found among `actions` (e.g. a wizard step with only
  // secondary buttons): fall back to pinning the whole, unpartitioned
  // `actions` node instead of splitting it — matches the pre-split fw#1918
  // behaviour where sticky footers always kept `actions` fixed.
  const nonPrimaryActionNodes = hasPrimaryAction
    ? actionNodes?.filter((node) => !isPrimaryStickyAction(node))
    : undefined;
  const renderedActions =
    stickyActions === true ? (hasPrimaryAction ? primaryActionNodes : actions) : actions;
  const hasNonPrimaryOverflow =
    nonPrimaryActionNodes !== undefined && nonPrimaryActionNodes.length > 0;
  const renderedSecondary =
    stickyActions === true && hasPrimaryAction ? (
      <>
        {secondaryActions}
        {nonPrimaryActionNodes}
      </>
    ) : (
      secondaryActions
    );
  const pinned = isPinnedFooter(stickyActions, fillHeight);
  const fixedFooterStyle =
    stickyActions === true && !pinned && isBelowSm && keyboardInset > 0
      ? { bottom: keyboardInset }
      : undefined;
  // Below sm the pinned footer swaps to NarrowPinnedFooter; the subtree remounts, so a
  // confirm dialog owned by an action button closes on a breakpoint change (rotate, resize).
  if (pinned && isBelowSm) {
    return (
      <NarrowPinnedFooter
        nodes={[...flattenActionNodes(secondaryActions), ...flattenActionNodes(actions)]}
        overflowLabel={
          unsavedCount !== undefined && unsavedCount > 0
            ? `${t("kumiko.list.row-actions.more")}, ${unsavedStatusText(t, unsavedCount)}`
            : t("kumiko.list.row-actions.more")
        }
        unsavedCount={unsavedCount}
        unsavedStatus={
          unsavedCount !== undefined && unsavedCount > 0
            ? unsavedStatusText(t, unsavedCount)
            : undefined
        }
        testId={testId}
        keyboardInset={keyboardInset}
      />
    );
  }
  return (
    <div
      className={cn(
        pinned
          ? cn(
              "flex h-14 shrink-0 items-center justify-end gap-2 border-t border-border bg-card px-6",
              !railed && "md:pl-10",
            )
          : "flex flex-col-reverse gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:py-4",
        !pinned && !chromeless && "px-[var(--card-padding)]",
        !pinned && !chromeless && cardFooterBorder,
        !pinned && fillHeight === true && "shrink-0",
      )}
    >
      {unsavedCount !== undefined && (
        <div
          data-testid={testId !== undefined ? `${testId}-unsaved` : undefined}
          className={cn(
            "mr-auto flex min-w-0 items-center gap-2 text-[13px]",
            // Only the stacked (flex-col-reverse) footer moves the status above the
            // actions; the pinned single-row footer keeps it on the left.
            !pinned && "max-sm:order-last",
            unsavedCount > 0 ? "text-foreground-secondary" : "text-muted-foreground",
          )}
        >
          {unsavedCount > 0 && (
            <span className="size-1.5 shrink-0 rounded-full bg-status-active" aria-hidden="true" />
          )}
          <span className="truncate">{unsavedStatusText(t, unsavedCount)}</span>
        </div>
      )}
      {(secondaryActions !== undefined || hasNonPrimaryOverflow) && (
        <div
          data-testid={testId !== undefined ? `${testId}-actions-secondary` : undefined}
          className={cn(
            // min-h-11: link-variant buttons (Copy link) are h-auto and would fall
            // below the 24px touch-target minimum on narrow viewports.
            "flex flex-wrap items-center gap-2 max-sm:[&_button]:min-h-11 max-sm:[&_button]:px-2 max-sm:[&_button]:text-xs",
            pinned && hasNonPrimaryOverflow && "mr-auto",
          )}
        >
          {renderedSecondary}
        </div>
      )}
      {renderedActions !== undefined && (
        <div
          data-testid={testId !== undefined ? `${testId}-actions` : undefined}
          style={fixedFooterStyle}
          className={cn(
            "flex items-center gap-2",
            pinned
              ? "shrink-0 max-md:[&>button]:min-h-11"
              : "flex-wrap max-sm:w-full max-sm:[&>button]:flex-1 max-sm:[&>button]:min-h-11 sm:ml-auto",
            // Below sm (640px): pin only the primary action to the viewport
            // bottom instead of normal flow, so a virtual keyboard shrinking
            // the viewport can't push it out of reach (fw#1918). `fixed`
            // escapes the card's `overflow-hidden` (only transform/filter/
            // contain ancestors trap it, confirmed against
            // AppLayout/SidebarInset — neither sets those).
            stickyActions === true &&
              !pinned &&
              cn(
                "max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-20 max-sm:bg-background max-sm:p-4 max-sm:shadow-[0_-4px_12px_-4px_rgb(0_0_0_/_0.15)]",
                STICKY_FOOTER_SAFE_AREA_CLASS,
              ),
          )}
        >
          {renderedActions}
        </div>
      )}
    </div>
  );
}

export const SECTION_NAV_MIN_ITEMS = 3;

// "On this page" navigation next to a screen form. The active entry follows
// the section nearest the top of the scroll surface; without IntersectionObserver
// (happy-dom, old engines) the first entry stays active until one is clicked.
export function FormSectionNav({
  items,
}: {
  readonly items: readonly FormSectionNavItem[];
}): ReactNode {
  const t = useTranslation();
  const [activeId, setActiveId] = useState(items[0]?.id);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visibleIds = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visibleIds.add(entry.target.id);
          else visibleIds.delete(entry.target.id);
        }
        const firstVisible = items.find((item) => visibleIds.has(item.id));
        if (firstVisible !== undefined) setActiveId(firstVisible.id);
      },
      { rootMargin: "0px 0px -60% 0px" },
    );
    for (const item of items) {
      const target = document.getElementById(item.id);
      if (target !== null) observer.observe(target);
    }
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav
      aria-label={t("kumiko.form.on-this-page")}
      data-testid="form-section-nav"
      className="sticky top-0 hidden w-[200px] shrink-0 flex-col gap-0.5 self-start xl:flex"
    >
      <span className="pb-1.5 pl-3 text-xs text-muted-foreground">
        {t("kumiko.form.on-this-page")}
      </span>
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            data-testid={`form-section-nav-${item.id}`}
            {...(active && { "aria-current": "true" as const })}
            onClick={() => {
              setActiveId(item.id);
              document
                .getElementById(item.id)
                ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
            }}
            className={cn(
              "border-l-2 px-3 py-[5px] text-left text-sm",
              active
                ? "border-primary font-semibold text-primary"
                : "border-border text-foreground-secondary hover:text-foreground",
            )}
          >
            {item.title}
          </button>
        );
      })}
    </nav>
  );
}

// Canonical form/settings shell shared by DefaultForm (configEdit/entityEdit)
// and custom settings screens (profile, privacy-center). Width resolution:
// explicit `maxWidth` prop (screen's `layout.width`) wins, else the app-wide
// `createKumikoApp({ screenWidth })` default from ScreenWidthContext, else
// "4xl" (a centered column, narrower than list chrome, which runs full-width).
export type FormScreenShellWidth = FormWidth;

export function FormScreenShell({
  children,
  className,
  testId,
  maxWidth,
  fillHeight,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly testId?: string;
  readonly maxWidth?: FormScreenShellWidth;
  /** Stacks children in a `h-full` flex column instead of normal document
   *  flow, so a `flex-1 min-h-0` child can claim the remaining height below
   *  the others (fw#2722 — DefaultForm's tabs+relatedList case). Default
   *  false: unchanged, content-sized height. */
  readonly fillHeight?: boolean;
}): ReactNode {
  const contextWidth = useContext(ScreenWidthContext);
  const width = maxWidth ?? contextWidth ?? "4xl";
  return (
    <div
      data-testid={testId}
      className={cn(
        screenPaddingClassName,
        "w-full",
        screenWidthClassName[width],
        fillHeight === true && "h-full flex flex-col min-h-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
