import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type PlanCardPrice = {
  readonly amount: string;
  readonly period?: string;
};

export type PlanCardActionSlot = {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
};

export type PlanCardProps = {
  readonly title: string;
  readonly description?: string;
  /** null renders the price-unavailable state; undefined renders no price row. */
  readonly price?: PlanCardPrice | null;
  readonly features?: readonly ReactNode[];
  readonly current?: boolean;
  readonly cta?: PlanCardActionSlot;
  readonly secondaryAction?: PlanCardActionSlot;
  /** compact: one-off purchases (e.g. credit packs) — title+price in one row, no feature emphasis, smaller padding. */
  readonly variant?: "default" | "compact";
  readonly testId?: string;
};

export type PlanGridProps = {
  readonly children: ReactNode;
  readonly testId?: string;
};

export function PlanCard({
  title,
  description,
  price,
  features,
  current = false,
  cta,
  secondaryAction,
  variant = "default",
  testId,
}: PlanCardProps): ReactNode {
  const { Card, Button } = usePrimitives();
  const t = useTranslation();
  const compact = variant === "compact";

  const footer =
    cta !== undefined || secondaryAction !== undefined ? (
      <div className="flex w-full flex-col gap-2">
        {cta !== undefined && (
          <Button
            width="full"
            disabled={cta.disabled}
            onClick={cta.onClick}
            testId={testId !== undefined ? `${testId}-cta` : "plan-card-cta"}
          >
            {cta.label}
          </Button>
        )}
        {secondaryAction !== undefined && (
          <Button
            variant="secondary"
            width="full"
            disabled={secondaryAction.disabled}
            onClick={secondaryAction.onClick}
          >
            {secondaryAction.label}
          </Button>
        )}
      </div>
    ) : undefined;

  return (
    <Card
      testId={testId ?? "plan-card"}
      className={cn(current && "border-primary")}
      slots={{ footer }}
    >
      <div className={cn("flex items-start justify-between gap-2", compact && "items-center")}>
        <h2 className={cn("font-semibold", compact ? "text-base" : "text-lg")}>{title}</h2>
        {current && (
          <span
            data-testid={testId !== undefined ? `${testId}-current` : "plan-card-current"}
            className="inline-block rounded-xl bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
          >
            {t("kumiko.planCard.current")}
          </span>
        )}
      </div>
      {description !== undefined && !compact && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
      {price !== undefined && (
        <div className={cn(compact ? "mt-1" : "mt-1 mb-3")}>
          {price === null ? (
            <span
              data-testid={
                testId !== undefined ? `${testId}-price-unavailable` : "plan-card-price-unavailable"
              }
              className="text-sm text-muted-foreground"
            >
              {t("kumiko.planCard.priceUnavailable")}
            </span>
          ) : (
            <>
              <span className="text-2xl font-bold">{price.amount}</span>
              {price.period !== undefined && (
                <span className="ml-1 text-sm text-muted-foreground">{price.period}</span>
              )}
            </>
          )}
        </div>
      )}
      {!compact && features !== undefined && features.length > 0 && (
        <ul className="space-y-1 text-sm">
          {features.map((feature, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: features are opaque ReactNode content, callers own key stability
            <li key={index} className="flex gap-2">
              <span aria-hidden="true">✓</span>
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function PlanGrid({ children, testId }: PlanGridProps): ReactNode {
  return (
    <div data-testid={testId} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </div>
  );
}
