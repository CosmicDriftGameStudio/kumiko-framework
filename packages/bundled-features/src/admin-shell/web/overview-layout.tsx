// @runtime client
import { type ReactNode } from "react";

export type OverviewCard = {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
};

export type OverviewState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly cards: readonly OverviewCard[] };

export function OverviewLayout({
  testId,
  title,
  state,
  loadingLabel,
  columns = 3,
}: {
  readonly testId: string;
  readonly title: string;
  readonly state: OverviewState;
  readonly loadingLabel: string;
  readonly columns?: 2 | 3;
}): ReactNode {
  if (state.kind === "loading") {
    return (
      <div data-testid={testId} className="p-6">
        <p>{loadingLabel}</p>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div data-testid={testId} className="p-6">
        <p style={{ color: "#b91c1c" }}>{state.message}</p>
      </div>
    );
  }
  const gridClass = columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3";
  return (
    <div data-testid={testId} className="p-6 flex flex-col gap-6 max-w-4xl">
      <h1 className="text-2xl font-semibold m-0">{title}</h1>
      <div className={`grid gap-4 ${gridClass}`}>
        {state.cards.map((card) => (
          <article
            key={card.label}
            className="border rounded-lg p-4 flex flex-col gap-1"
            data-overview-card={card.label}
          >
            <span className="text-sm text-muted-foreground">{card.label}</span>
            <span className="text-3xl font-semibold tabular-nums">{card.value}</span>
            {card.hint !== undefined && (
              <span className="text-xs text-muted-foreground">{card.hint}</span>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
