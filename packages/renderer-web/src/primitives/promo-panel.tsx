import type { PromoPanelAction, PromoPanelProps } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";

const PROMO_ACTION_CLASS =
  "inline-flex min-h-13 w-full items-center justify-center rounded-full bg-promo-accent px-6 text-base font-semibold text-promo-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-promo-accent focus-visible:ring-offset-2 focus-visible:ring-offset-promo";

function PromoActionControl({ action }: { readonly action: PromoPanelAction }): ReactNode {
  if ("href" in action) {
    return (
      <a href={action.href} data-testid={action.testId} className={PROMO_ACTION_CLASS}>
        {action.label}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={action.onClick}
      data-testid={action.testId}
      className={PROMO_ACTION_CLASS}
    >
      {action.label}
    </button>
  );
}

export function PromoPanel({
  title,
  eyebrow,
  children,
  action,
  testId,
}: PromoPanelProps): ReactNode {
  return (
    <section
      data-testid={testId}
      className="flex flex-col gap-4 rounded-(--card-radius) bg-promo p-6 text-promo-foreground"
    >
      {eyebrow !== undefined && (
        <span className="text-xs font-semibold uppercase tracking-wider text-promo-accent">
          {eyebrow}
        </span>
      )}
      <h2 className="font-heading text-2xl font-bold leading-tight">{title}</h2>
      {children !== undefined && (
        <div className="flex flex-col gap-3 text-sm text-promo-foreground/85">{children}</div>
      )}
      {action !== undefined && <PromoActionControl action={action} />}
    </section>
  );
}
