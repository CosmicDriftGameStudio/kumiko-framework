import type { ReactNode } from "react";

type PublicShellCommonProps = {
  readonly brand: ReactNode;
  readonly headerActions?: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  readonly testId?: string;
};

export type PublicShellVariant = "marketing" | "focus" | "card";

export type PublicShellProps = PublicShellCommonProps &
  (
    | { readonly variant: "marketing"; readonly notice?: ReactNode }
    | { readonly variant: "focus"; readonly progress?: ReactNode }
    | { readonly variant: "card" }
  );

const CONTENT_WIDTH_CLASS = "mx-auto w-full max-w-6xl px-4 sm:px-6";

const MAIN_CLASS: Readonly<Record<PublicShellVariant, string>> = {
  marketing: "w-full flex-1",
  focus: "mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6",
  card: "flex w-full flex-1 items-center justify-center bg-muted px-4 py-10",
};

/** One header and footer for anonymous pages; `focus` narrows to a task column,
 *  `card` centers a single card (sign-in). */
export function PublicShell(props: PublicShellProps): ReactNode {
  const { variant, brand, headerActions, footer, children, testId = "public-shell" } = props;
  const notice = props.variant === "marketing" ? props.notice : undefined;
  const progress = props.variant === "focus" ? props.progress : undefined;

  return (
    <div
      data-testid={testId}
      data-variant={variant}
      className="flex min-h-dvh flex-col bg-background text-foreground"
    >
      {notice !== undefined && (
        <div
          data-testid={`${testId}-notice`}
          className="bg-promo px-4 py-2 text-center text-promo-foreground text-sm"
        >
          {notice}
        </div>
      )}
      <header className="border-border border-b">
        <div className={`${CONTENT_WIDTH_CLASS} flex min-h-16 items-center justify-between gap-4`}>
          <div className="min-w-0">{brand}</div>
          {headerActions !== undefined && (
            <div className="flex shrink-0 items-center gap-2">{headerActions}</div>
          )}
        </div>
        {progress !== undefined && (
          <div
            data-testid={`${testId}-progress`}
            className="mx-auto w-full max-w-3xl px-4 pb-3 sm:px-6"
          >
            {progress}
          </div>
        )}
      </header>
      <main className={MAIN_CLASS[variant]}>
        {variant === "card" ? (
          <div
            data-testid={`${testId}-card`}
            className="w-full max-w-md rounded-(--card-radius) border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-8"
          >
            {children}
          </div>
        ) : (
          children
        )}
      </main>
      {footer !== undefined && (
        <footer className="border-border border-t">
          <div className={`${CONTENT_WIDTH_CLASS} py-6 text-muted-foreground text-sm`}>
            {footer}
          </div>
        </footer>
      )}
    </div>
  );
}
