// @runtime test
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { DispatcherError, WriteResult } from "@cosmicdrift/kumiko-headless";
import {
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { BillingPlanActions, SubscriptionFoundationHandlers } from "../../constants";
import type { BillingPlansResult, BillingPlanView } from "../../types";
import { BillingPlansPanel } from "../billing-plans-panel";

type QueryState = {
  readonly data: BillingPlansResult | null;
  readonly loading: boolean;
  readonly error: DispatcherError | null;
};

let queryState: QueryState = { data: null, loading: true, error: null };
let checkoutResult: WriteResult<{ readonly url: string }> = {
  isSuccess: true,
  data: { url: "https://checkout.example.com/session" },
};
let switchResult: WriteResult<{ readonly url: string }> = {
  isSuccess: true,
  data: { url: "https://portal.example.com/session" },
};
let portalResult: WriteResult<{ readonly url: string }> = {
  isSuccess: true,
  data: { url: "https://billing-portal.example.com/session" },
};

const useQuerySpy = mock((_type: string, _params: unknown) => ({
  ...queryState,
  refetch: mock(async () => {}),
}));

const checkoutMutate = mock(async (_payload: unknown) => checkoutResult);
const switchMutate = mock(async (_payload: unknown) => switchResult);
const portalMutate = mock(async (_payload: unknown) => portalResult);

const useMutationSpy = mock((type: string) => {
  const mutate =
    type === SubscriptionFoundationHandlers.startPlanCheckout
      ? checkoutMutate
      : type === SubscriptionFoundationHandlers.switchPlan
        ? switchMutate
        : portalMutate;
  return { mutate, pending: false, error: null, data: null, reset: mock(() => {}) };
});

const actualRenderer = await import("@cosmicdrift/kumiko-renderer");
mock.module("@cosmicdrift/kumiko-renderer", () => ({
  ...actualRenderer,
  useQuery: useQuerySpy,
  useMutation: useMutationSpy,
}));

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider
      resolver={createStaticLocaleResolver()}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

function renderPanel(): void {
  render(
    <Wrapper>
      <BillingPlansPanel entityName="billing-plans" entityId={null} />
    </Wrapper>,
  );
}

function plan(overrides: Partial<BillingPlanView> = {}): BillingPlanView {
  return {
    tier: "pro",
    labelKey: "plan.pro.label",
    price: { unitAmount: 999, currency: "usd", interval: "month", intervalCount: 1 },
    benefits: [{ labelKey: "plan.pro.benefit.support" }],
    isCurrent: false,
    action: BillingPlanActions.checkout,
    ...overrides,
  };
}

function result(overrides: Partial<BillingPlansResult> = {}): BillingPlansResult {
  return {
    enabled: true,
    currentTier: { tier: "free", labelKey: "plan.free.label" },
    subscription: null,
    canPurchase: true,
    plans: [plan()],
    ...overrides,
  };
}

let originalAssign: typeof window.location.assign;

beforeEach(() => {
  queryState = { data: null, loading: true, error: null };
  checkoutResult = { isSuccess: true, data: { url: "https://checkout.example.com/session" } };
  switchResult = { isSuccess: true, data: { url: "https://portal.example.com/session" } };
  portalResult = { isSuccess: true, data: { url: "https://billing-portal.example.com/session" } };
  checkoutMutate.mockClear();
  switchMutate.mockClear();
  portalMutate.mockClear();
  checkoutMutate.mockImplementation(async (_payload: unknown) => checkoutResult);
  useQuerySpy.mockClear();
  useMutationSpy.mockClear();
  originalAssign = window.location.assign;
  window.location.assign = mock(() => {}) as unknown as typeof window.location.assign;
});

afterEach(() => {
  window.location.assign = originalAssign;
});

describe("BillingPlansPanel", () => {
  test("shows a loading banner while the catalog query is in flight", () => {
    queryState = { data: null, loading: true, error: null };
    renderPanel();
    expect(screen.getByTestId("billing-plans-panel-loading")).toBeTruthy();
  });

  test("shows an error banner translated via the dispatcher error's i18nKey", () => {
    queryState = {
      data: null,
      loading: false,
      error: {
        code: "internal",
        httpStatus: 500,
        i18nKey: "billing-foundation.errors.unexpected",
        message: "boom",
      } as DispatcherError,
    };
    renderPanel();
    expect(screen.getByTestId("billing-plans-panel-error")).toBeTruthy();
    expect(screen.getByText("billing-foundation.errors.unexpected")).toBeTruthy();
  });

  test("renders one PlanCard per catalog plan with its price and benefits", () => {
    queryState = { data: result(), loading: false, error: null };
    renderPanel();
    expect(screen.getByTestId("billing-plan-card-pro")).toBeTruthy();
    expect(screen.getByText("$9.99")).toBeTruthy();
  });

  test("billing disabled renders the billingDisabled banner and only the current-tier card", () => {
    queryState = {
      data: result({
        enabled: false,
        plans: [plan({ action: BillingPlanActions.unavailable, price: null })],
      }),
      loading: false,
      error: null,
    };
    renderPanel();
    expect(screen.getByTestId("billing-plans-panel-disabled")).toBeTruthy();
    expect(screen.getByTestId("billing-plan-card-current")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("billing disabled and current tier still in the catalog shows the plan card with no price row instead of price-unavailable", () => {
    queryState = {
      data: result({
        enabled: false,
        plans: [plan({ isCurrent: true, action: BillingPlanActions.current, price: null })],
      }),
      loading: false,
      error: null,
    };
    renderPanel();
    expect(screen.getByTestId("billing-plans-panel-disabled")).toBeTruthy();
    expect(screen.getByTestId("billing-plan-card-pro")).toBeTruthy();
    expect(screen.queryByTestId("billing-plan-card-current")).toBeNull();
    expect(screen.queryByText("Price not available")).toBeNull();
  });

  test("current tier outside the catalog gets a synthetic current-tier card alongside every purchasable plan", () => {
    queryState = {
      data: result({
        currentTier: { tier: "free", labelKey: "plan.free.label" },
        plans: [plan({ tier: "pro", isCurrent: false, action: BillingPlanActions.checkout })],
      }),
      loading: false,
      error: null,
    };
    renderPanel();
    expect(screen.getByTestId("billing-plan-card-current")).toBeTruthy();
    expect(screen.getByTestId("billing-plan-card-pro")).toBeTruthy();
  });

  test("canPurchase=false renders the purchaseNotAllowed banner and no cta at all", () => {
    queryState = {
      data: result({
        canPurchase: false,
        plans: [plan({ action: BillingPlanActions.unavailable })],
      }),
      loading: false,
      error: null,
    };
    renderPanel();
    expect(screen.getByTestId("billing-plans-panel-readonly")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("current plan with no active subscription renders no action button", () => {
    queryState = {
      data: result({ plans: [plan({ isCurrent: true, action: BillingPlanActions.current })] }),
      loading: false,
      error: null,
    };
    renderPanel();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("current plan with an active switchable subscription renders a manage-subscription button", async () => {
    queryState = {
      data: result({
        subscription: { status: "active", tier: "pro", terminal: false },
        plans: [plan({ isCurrent: true, action: BillingPlanActions.current })],
      }),
      loading: false,
      error: null,
    };
    renderPanel();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(window.location.assign).toHaveBeenCalledWith(
        "https://billing-portal.example.com/session",
      );
    });
    expect(portalMutate).toHaveBeenCalledWith({ returnUrl: window.location.href });
  });

  test("checkout action dispatches start-plan-checkout with the tier and redirects to the returned url", async () => {
    queryState = { data: result(), loading: false, error: null };
    renderPanel();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(window.location.assign).toHaveBeenCalledWith("https://checkout.example.com/session");
    });
    expect(checkoutMutate).toHaveBeenCalledWith({ tier: "pro" });
  });

  test("switch action dispatches switch-plan instead of start-plan-checkout", async () => {
    queryState = {
      data: result({
        subscription: { status: "active", tier: "basic", terminal: false },
        plans: [plan({ action: BillingPlanActions.switch })],
      }),
      loading: false,
      error: null,
    };
    renderPanel();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(switchMutate).toHaveBeenCalledWith({ tier: "pro" });
    });
    expect(checkoutMutate).not.toHaveBeenCalled();
  });

  test("clicking a checkout CTA disables it and every other CTA until the mutation settles", async () => {
    let resolveCheckout: (value: WriteResult<{ readonly url: string }>) => void = () => {};
    checkoutMutate.mockImplementation(
      () =>
        new Promise<WriteResult<{ readonly url: string }>>((resolve) => {
          resolveCheckout = resolve;
        }),
    );
    queryState = {
      data: result({
        plans: [plan({ tier: "pro" }), plan({ tier: "business", labelKey: "plan.business.label" })],
      }),
      loading: false,
      error: null,
    };
    renderPanel();
    const buttons = screen.getAllByRole("button") as HTMLButtonElement[];
    const [firstButton] = buttons;
    if (!firstButton) throw new Error("expected at least one plan cta button");
    fireEvent.click(firstButton);
    await waitFor(() => {
      expect(buttons.every((button) => button.disabled)).toBe(true);
    });
    resolveCheckout(checkoutResult);
    await waitFor(() => {
      expect(window.location.assign).toHaveBeenCalledWith("https://checkout.example.com/session");
    });
  });

  test("a failed manage-subscription call re-enables the button instead of leaving it stuck disabled", async () => {
    portalResult = {
      isSuccess: false,
      error: {
        code: "internal",
        httpStatus: 500,
        i18nKey: "billing-foundation.errors.unexpected",
        message: "boom",
      },
    };
    queryState = {
      data: result({
        subscription: { status: "active", tier: "pro", terminal: false },
        plans: [plan({ isCurrent: true, action: BillingPlanActions.current })],
      }),
      loading: false,
      error: null,
    };
    renderPanel();
    const button = screen.getByRole("button") as HTMLButtonElement;
    fireEvent.click(button);
    await waitFor(() => {
      expect(button.disabled).toBe(false);
    });
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  test("paymentPending shows the still-completing hint and no cta button", () => {
    queryState = {
      data: result({
        subscription: { status: "incomplete", tier: "pro", terminal: false },
        plans: [plan({ action: BillingPlanActions.paymentPending })],
      }),
      loading: false,
      error: null,
    };
    renderPanel();
    expect(screen.getByText("billing-foundation.plans.paymentPending")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("price=null renders the price-unavailable fallback and a disabled cta", () => {
    queryState = {
      data: result({ plans: [plan({ price: null, action: BillingPlanActions.unavailable })] }),
      loading: false,
      error: null,
    };
    renderPanel();
    expect(screen.getByText("Price not available")).toBeTruthy();
    const cta = screen.getByRole("button") as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
  });
});
