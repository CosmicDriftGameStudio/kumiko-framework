// @runtime client
import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode } from "react";

export type OverviewCard = {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  /** When true and hint is set, render an attention Banner inside the card. */
  readonly attention?: boolean;
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
  const { Banner, Card, Heading, Text } = usePrimitives();
  const gridClass = columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3";

  return (
    <div data-testid={testId} className="flex max-w-4xl flex-col gap-6 p-6">
      <Heading variant="page">{title}</Heading>

      {state.kind === "loading" && (
        <Text variant="small" testId={`${testId}-loading`}>
          {loadingLabel}
        </Text>
      )}

      {state.kind === "error" && (
        <Banner variant="error" testId={`${testId}-error`}>
          {state.message}
        </Banner>
      )}

      {state.kind === "ready" && (
        <div className={`grid grid-cols-1 gap-4 ${gridClass}`}>
          {state.cards.map((card) => (
            <Card key={card.label} testId={`${testId}-card`} slots={{ title: card.label }}>
              <div className="flex flex-col gap-2" data-overview-card={card.label}>
                <span className="text-3xl font-semibold tabular-nums">{card.value}</span>
                {card.attention === true && card.hint !== undefined ? (
                  <Banner variant="error">{card.hint}</Banner>
                ) : (
                  card.hint !== undefined && (
                    <Text variant="small">{card.hint}</Text>
                  )
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
