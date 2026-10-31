import { type ReactNode, useContext } from "react";
import {
  type FormProps,
  InsideDrawerProvider,
  useInsideDrawer,
  useTranslation,
} from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { screenFormColumnWidthClassName, screenPaddingClassName } from "./layout.tsx";
import { InsideScreenFormColumnContext } from "./metric.tsx";
import "../react-css-custom-properties.ts";
import { cardSurface } from "./card-styles.ts";
import {
  BareFormContext,
  DrawerBodyContext,
  EmbeddedFormContext,
  InsideFormContext,
  ScreenFormContext,
  ScreenWidthContext,
} from "./contexts.tsx";
import {
  FormFooter,
  FormRoot,
  FormScreenShell,
  FormSectionNav,
  FormSections,
  FormTitleBlock,
  isPinnedFooter,
  SECTION_NAV_MIN_ITEMS,
} from "./form.tsx";
import { unsavedStatusText } from "./form-footer-parts.tsx";

// Form inside the Drawer primitive: the drawer header carries the title, so
// only the description (as help text), the scrolling sections and a pinned
// footer remain. The scroll area is a sibling of the footer, never its parent.
function FormSummaryBox({ summary, testId }: Pick<FormProps, "summary" | "testId">): ReactNode {
  if (summary === undefined) return null;
  return (
    <div
      data-testid={testId !== undefined ? `${testId}-summary` : undefined}
      className="flex flex-col gap-0.5 rounded-lg bg-muted px-3.5 py-3"
    >
      <span className="text-sm font-semibold text-foreground">{summary.title}</span>
      {summary.subtitle !== undefined && (
        <span className="text-[13px] text-foreground-secondary">{summary.subtitle}</span>
      )}
    </div>
  );
}

function DrawerFormLayout({
  onSubmit,
  focusFirstErrorKey,
  subtitle,
  actions,
  secondaryActions,
  summary,
  testId,
  children,
}: Pick<
  FormProps,
  | "onSubmit"
  | "focusFirstErrorKey"
  | "subtitle"
  | "actions"
  | "secondaryActions"
  | "testId"
  | "summary"
> & {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <FormRoot
      onSubmit={onSubmit}
      focusFirstErrorKey={focusFirstErrorKey}
      testId={testId}
      className="flex h-full min-h-0 w-full flex-col"
    >
      <div
        data-testid={testId !== undefined ? `${testId}-scroll` : undefined}
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5"
      >
        <FormSummaryBox summary={summary} testId={testId} />
        {subtitle !== undefined && (
          <p
            data-testid={testId !== undefined ? `${testId}-subtitle` : undefined}
            className="text-[13px] text-foreground-secondary"
          >
            {subtitle}
          </p>
        )}
        <InsideFormContext.Provider value={true}>
          <ScreenFormContext.Provider value={true}>
            <InsideDrawerProvider value={false}>
              <DrawerBodyContext.Provider value={true}>
                <div className="flex flex-col gap-5">{children}</div>
              </DrawerBodyContext.Provider>
            </InsideDrawerProvider>
          </ScreenFormContext.Provider>
        </InsideFormContext.Provider>
      </div>
      {(actions !== undefined || secondaryActions !== undefined) && (
        <div
          data-testid={testId !== undefined ? `${testId}-footer` : undefined}
          className="flex h-16 shrink-0 items-center justify-end gap-2 border-t border-border px-6"
        >
          {secondaryActions}
          {actions}
        </div>
      )}
    </FormRoot>
  );
}

export function DefaultForm({
  onSubmit,
  focusFirstErrorKey,
  children,
  title,
  subtitle,
  actions,
  secondaryActions,
  testId,
  width,
  stickyActions,
  headerRegion,
  titleAction,
  fillHeight,
  chromeless,
  screenForm,
  unsavedCount,
  sectionNav,
  sideRail,
  summary,
}: FormProps): ReactNode {
  const insideDrawer = useInsideDrawer();
  const t = useTranslation();
  const isEmbeddedForm = useContext(EmbeddedFormContext);
  const contextWidth = useContext(ScreenWidthContext);
  // Embedded (AuthCard etc.): bare <form>, stacked fields with gap; the
  // container carries card/title itself, otherwise card-in-card.
  if (useContext(BareFormContext)) {
    return (
      <FormRoot
        onSubmit={onSubmit}
        focusFirstErrorKey={focusFirstErrorKey}
        testId={testId}
        className={cn(
          "flex flex-col gap-4",
          // Bare forms stack sections without a card; without a divider a
          // section boundary reads as a layout gap, not structure.
          "[&>section:not(:first-child)]:border-t",
        )}
      >
        {headerRegion}
        <InsideFormContext.Provider value={true}>{children}</InsideFormContext.Provider>
        {(secondaryActions !== undefined || actions !== undefined) && (
          <div className="flex items-center justify-end gap-2">
            {secondaryActions}
            {actions}
          </div>
        )}
      </FormRoot>
    );
  }

  if (insideDrawer) {
    return (
      <DrawerFormLayout
        onSubmit={onSubmit}
        focusFirstErrorKey={focusFirstErrorKey}
        subtitle={subtitle}
        actions={actions}
        secondaryActions={secondaryActions}
        summary={summary}
        testId={testId}
      >
        {children}
      </DrawerFormLayout>
    );
  }

  if (isEmbeddedForm) {
    return (
      <FormRoot
        onSubmit={onSubmit}
        focusFirstErrorKey={focusFirstErrorKey}
        testId={testId}
        className="flex w-full flex-col gap-6"
      >
        <FormSections chromeless stickyActions={undefined} fillHeight={false} screenForm>
          {children}
        </FormSections>
        {(actions !== undefined || secondaryActions !== undefined) && (
          <div
            data-testid={testId !== undefined ? `${testId}-footer` : undefined}
            className="flex flex-wrap items-center gap-2"
          >
            {actions}
            {secondaryActions}
            {unsavedCount !== undefined && unsavedCount > 0 && (
              <span
                data-testid={testId !== undefined ? `${testId}-unsaved` : undefined}
                className="flex items-center gap-2 text-[13px] text-foreground-secondary"
              >
                <span
                  className="size-1.5 shrink-0 rounded-full bg-status-active"
                  aria-hidden="true"
                />
                {unsavedStatusText(t, unsavedCount)}
              </span>
            )}
          </div>
        )}
      </FormRoot>
    );
  }

  const isScreenForm = screenForm === true && fillHeight === true && chromeless !== true;
  const screenFormWidth = width ?? contextWidth;
  const sections = (
    <FormSections
      chromeless={chromeless === true}
      stickyActions={stickyActions}
      fillHeight={fillHeight}
      screenForm={isScreenForm}
    >
      {children}
    </FormSections>
  );
  const footer = (
    <FormFooter
      actions={actions}
      secondaryActions={secondaryActions}
      testId={testId}
      chromeless={chromeless === true}
      stickyActions={stickyActions}
      fillHeight={fillHeight}
      {...(unsavedCount !== undefined && { unsavedCount })}
      railed={sideRail !== undefined}
    />
  );

  // Screen form: no card. A padded scroll surface holds the form column and,
  // from xl, the section navigation; the footer stays pinned below it.
  if (isScreenForm) {
    const showsSectionNav = sectionNav !== undefined && sectionNav.length >= SECTION_NAV_MIN_ITEMS;
    return (
      <FormRoot
        onSubmit={onSubmit}
        focusFirstErrorKey={focusFirstErrorKey}
        testId={testId}
        className="flex h-full min-h-0 w-full flex-col"
      >
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {sideRail}
          <div
            data-testid={testId !== undefined ? `${testId}-scroll` : undefined}
            className={cn("min-h-0 flex-1 overflow-y-auto", screenPaddingClassName)}
          >
            <div className="flex gap-18">
              <div
                className={cn(
                  "flex w-full min-w-0 flex-col gap-9",
                  screenFormWidth !== undefined
                    ? screenFormColumnWidthClassName[screenFormWidth]
                    : "max-w-[640px]",
                )}
              >
                <InsideScreenFormColumnContext.Provider value={true}>
                  {headerRegion}
                </InsideScreenFormColumnContext.Provider>
                <FormTitleBlock
                  title={title}
                  subtitle={subtitle}
                  titleAction={titleAction}
                  testId={testId}
                  bordered={false}
                  fillHeight={false}
                />
                <FormSummaryBox summary={summary} testId={testId} />
                {sections}
              </div>
              {showsSectionNav && <FormSectionNav items={sectionNav} />}
            </div>
          </div>
        </div>
        {footer}
      </FormRoot>
    );
  }

  // Pinned footer (fillHeight + stickyActions): the footer is a full-bleed
  // sibling BELOW the padded shell, so the shell's bottom inset does not float
  // it above the viewport edge; the shell shrinks (`flex-1`) to make room.
  const pinnedFooter = isPinnedFooter(stickyActions, fillHeight);
  const pinnedShellClassName = pinnedFooter ? "h-auto flex-1 pb-6" : undefined;

  // Tab content: the head card is the ONLY card on the
  // screen, so a tabbed projectionDetail's tab content must render as a
  // sibling of that card, not nest another one around itself — chromeless
  // skips the card wrapper and its border/padding so sections and footer
  // sit directly on the page background, same edge as a standalone list
  // screen. Title/subtitle still render unbordered: RenderEdit's tabs
  // caller already blanks the per-section title via hideSectionTitles, but
  // the screen-level subtitle (screen.description) is independent of that
  // and must survive tabs mode.
  if (chromeless === true) {
    return (
      <FormRoot
        onSubmit={onSubmit}
        focusFirstErrorKey={focusFirstErrorKey}
        testId={testId}
        className={cn("flex flex-col w-full", fillHeight === true && "h-full min-h-0")}
      >
        <FormScreenShell
          maxWidth="full"
          {...(fillHeight === true && { fillHeight: true })}
          className={cn("!p-0", pinnedShellClassName)}
        >
          {headerRegion !== undefined && (
            // The list toolbar under the tab strip brings ~10px of its own; pb-1.5 tops that up to the 16px content gap.
            <div
              data-testid={testId !== undefined ? `${testId}-header-region` : undefined}
              className={cn("flex flex-col pb-1.5", fillHeight === true && "shrink-0")}
            >
              {headerRegion}
            </div>
          )}
          <FormTitleBlock
            title={title}
            subtitle={subtitle}
            titleAction={titleAction}
            testId={testId}
            bordered={false}
            fillHeight={fillHeight}
          />
          {sections}
          {!pinnedFooter && footer}
        </FormScreenShell>
        {pinnedFooter && footer}
      </FormRoot>
    );
  }

  // One card form: title as header (no divider under it), sections divided
  // between each other, muted action footer. Shell width comes from
  // FormScreenShell (layout.width, else the app-wide screenWidth default, else
  // 4xl).
  return (
    <FormRoot
      onSubmit={onSubmit}
      focusFirstErrorKey={focusFirstErrorKey}
      testId={testId}
      className={cn("flex flex-col w-full", fillHeight === true && "h-full min-h-0")}
    >
      <FormScreenShell
        {...(width !== undefined && { maxWidth: width })}
        {...(fillHeight === true && { fillHeight: true })}
        {...(pinnedShellClassName !== undefined && { className: pinnedShellClassName })}
      >
        {headerRegion !== undefined && (
          <div className={cn("flex flex-col gap-6 mb-8", fillHeight === true && "shrink-0")}>
            {headerRegion}
          </div>
        )}
        <div
          data-slot="card"
          className={cn(
            cardSurface(),
            "overflow-hidden",
            // No flex-1: a fillHeight card sizes to its content (flex's
            // initial 0 1 auto) and only claims more than that once its
            // FormScreenShell ancestor is itself height-constrained and
            // shrinks it back down via min-h-0 — flex-1 would instead force
            // it to always fill the remaining height, stretching a short
            // relatedList tab to the bottom of the panel.
            // The min-height floor keeps the card from collapsing to ~0 on short
            // viewports; the shell then overflows and <main> scrolls instead of
            // the overflow-hidden card clipping the table.
            fillHeight === true && "min-h-64 flex flex-col",
            pinnedFooter && "flex-1",
          )}
        >
          <FormTitleBlock
            title={title}
            subtitle={subtitle}
            titleAction={titleAction}
            testId={testId}
            bordered={true}
            fillHeight={fillHeight}
          />
          {sections}
          {!pinnedFooter && footer}
        </div>
      </FormScreenShell>
      {pinnedFooter && footer}
    </FormRoot>
  );
}
