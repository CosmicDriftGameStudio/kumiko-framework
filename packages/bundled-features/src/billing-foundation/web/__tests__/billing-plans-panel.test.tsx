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
import { BillingPlanActions, SubscriptionFoundationHandlers } from "../../constants.js";
import type { BillingPlansResult, BillingPlanView } from "../../types.js";
import { BillingPlansPanel } from "../billing-plans-panel.js";

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
type TerminateReceipt = {
  readonly requestId: string;
  readonly receivedAtIso: string;
  readonly effectiveAtIso: string | null;
};
let terminateResult: WriteResult<TerminateReceipt> = {
  isSuccess: true,
  data: {
    requestId: "req-1",
    receivedAtIso: "2024-01-15T10:30:00Z",
    effectiveAtIso: "2024-02-01T00:00:00Z",
  },
};
let uiLocale = "en";
let portalResult: WriteResult<{ readonly url: string }> = {
  isSuccess: true,
  data: { url: "https://billing-portal.example.com/session" },
};

const refetchPlans = mock(async () => {});
const useQuerySpy = mock((_type: string, _params: unknown) => ({
  ...queryState,
  refetch: refetchPlans,
}));

const checkoutMutate = mock(async (_payload: unknown) => checkoutResult);
const switchMutate = mock(async (_payload: unknown) => switchResult);
const portalMutate = mock(async (_payload: unknown) => portalResult);
const terminateMutate = mock(async (_payload: unknown) => terminateResult);

const useMutationSpy = mock((type: string) => {
  const mutate =
    type === SubscriptionFoundationHandlers.startPlanCheckout
      ? checkoutMutate
      : type === SubscriptionFoundationHandlers.switchPlan
        ? switchMutate
        : type === SubscriptionFoundationHandlers.terminateContract
          ? terminateMutate
          : portalMutate;
  return { mutate, pending: false, error: null, data: null, reset: mock(() => {}) };
});

const actualRenderer = await import("@cosmicdrift/kumiko-renderer");
mock.module("@cosmicdrift/kumiko-renderer", () => ({
  ...actualRenderer,
  useQuery: useQuerySpy,
  useMutation: useMutationSpy,
}));

// Shows interpolation params for the cancel keys so the formatted dates are assertable.
function testResolver(): ReturnType<typeof createStaticLocaleResolver> {
  return {
    ...createStaticLocaleResolver({ locale: uiLocale }),
    translate: (key, params) =>
      key.startsWith("billing-foundation.cancel.") && params !== undefined
        ? `${key}|${Object.values(params).join("|")}`
        : key,
  };
}

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider resolver={testResolver()} fallbackBundles={[kumikoDefaultTranslations]}>
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

type SubscriptionFixture = NonNullable<BillingPlansResult["subscription"]>;

function subscription(overrides: Partial<SubscriptionFixture> = {}): SubscriptionFixture {
  return {
    status: "active",
    tier: "pro",
    terminal: false,
    currentPeriodEnd: "2024-02-01T00:00:00Z",
    cancelAt: null,
    ...overrides,
  };
}

function result(overrides: Partial<BillingPlansResult> = {}): BillingPlansResult {
  return {
    enabled: true,
    currentTier: { tier: "free", labelKey: "plan.free.label", benefits: [] },
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
  uiLocale = "en";
  terminateResult = {
    isSuccess: true,
    data: {
      requestId: "req-1",
      receivedAtIso: "2024-01-15T10:30:00Z",
      effectiveAtIso: "2024-02-01T00:00:00Z",
    },
  };
  terminateMutate.mockClear();
  refetchPlans.mockClear();
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
        currentTier: { tier: "free", labelKey: "plan.free.label", benefits: [] },
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
        subscription: subscription(),
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
    expect(portalMutate).toHaveBeenCalledWith({});
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
        subscription: subscription({ tier: "basic" }),
        plans: [plan({ action: BillingPlanActions.switch })],
      }),
      loading: false,
      error: null,
    };
    renderPanel();
    fireEvent.click(screen.getByTestId("billing-plan-card-pro-cta"));
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
        subscription: subscription(),
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
        subscription: subscription({ status: "incomplete" }),
        plans: [plan({ action: BillingPlanActions.paymentPending })],
      }),
      loading: false,
      error: null,
    };
    renderPanel();
    expect(screen.getByText("billing-foundation.plans.paymentPending")).toBeTruthy();
    expect(screen.queryByTestId("billing-plan-card-pro-cta")).toBeNull();
  });

  test("a scheduled cancellation shows cancelScheduled and switchRequiresReactivation together", () => {
    queryState = {
      data: result({
        subscription: subscription({ cancelAt: "2024-03-01T00:00:00Z" }),
        plans: [plan({ isCurrent: true, action: BillingPlanActions.current })],
      }),
      loading: false,
      error: null,
    };
    renderPanel();
    const banner = screen.getByTestId("billing-plans-panel-cancel-scheduled");
    expect(banner.textContent).toContain("billing-foundation.plans.cancelScheduled");
    expect(banner.textContent).toContain("billing-foundation.plans.switchRequiresReactivation");
  });

  test("past_due status renders the past-due banner", () => {
    queryState = {
      data: result({
        subscription: subscription({ status: "past_due" }),
        plans: [plan({ isCurrent: true, action: BillingPlanActions.current })],
      }),
      loading: false,
      error: null,
    };
    renderPanel();
    expect(screen.getByTestId("billing-plans-panel-past-due")).toBeTruthy();
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

  describe("with consumerProtection", () => {
    const consumerProtection: NonNullable<BillingPlansResult["consumerProtection"]> = {
      consentTexts: {
        de: {
          earlyPerformance: "DE early performance",
          withdrawalLoss: "DE withdrawal loss",
          consentTextVersion: "version-de",
        },
        en: {
          earlyPerformance: "EN early performance",
          withdrawalLoss: "EN withdrawal loss",
          consentTextVersion: "version-en",
        },
      },
      legalLinks: { terms: "/legal/terms", withdrawal: "/legal/withdrawal", privacy: "/privacy" },
    };

    function openConsentDialog(): void {
      queryState = { data: result({ consumerProtection }), loading: false, error: null };
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "billing-foundation.plans.choose" }));
    }

    function orderButton(): HTMLButtonElement {
      return screen.getByTestId("checkout-consent-order") as HTMLButtonElement;
    }

    function tickBothConsents(): void {
      fireEvent.click(screen.getByLabelText("EN early performance"));
      fireEvent.click(screen.getByLabelText("EN withdrawal loss"));
    }

    test("the checkout CTA opens the consent dialog with summary and links instead of calling the mutation", () => {
      openConsentDialog();
      expect(screen.getByTestId("checkout-consent-dialog")).toBeTruthy();
      expect(checkoutMutate).not.toHaveBeenCalled();
      expect(screen.getByTestId("checkout-consent-summary").textContent).toContain("$9.99");
      expect(
        screen
          .getByText("billing-foundation.consent.link.terms")
          .closest("a")
          ?.getAttribute("href"),
      ).toBe("/legal/terms");
      expect(
        screen
          .getByText("billing-foundation.consent.link.withdrawal")
          .closest("a")
          ?.getAttribute("href"),
      ).toBe("/legal/withdrawal");
      expect(
        screen
          .getByText("billing-foundation.consent.link.privacy")
          .closest("a")
          ?.getAttribute("href"),
      ).toBe("/privacy");
    });

    test("the order button stays disabled until both consents are ticked", () => {
      openConsentDialog();
      expect(orderButton().disabled).toBe(true);
      fireEvent.click(screen.getByLabelText("EN early performance"));
      expect(orderButton().disabled).toBe(true);
      fireEvent.click(screen.getByLabelText("EN withdrawal loss"));
      expect(orderButton().disabled).toBe(false);
    });

    test("ordering sends the consent with the server's text version and the resolved locale, then redirects", async () => {
      openConsentDialog();
      tickBothConsents();
      fireEvent.click(orderButton());
      await waitFor(() => {
        expect(window.location.assign).toHaveBeenCalledWith("https://checkout.example.com/session");
      });
      expect(checkoutMutate).toHaveBeenCalledWith({
        tier: "pro",
        consent: {
          earlyPerformanceRequested: true,
          withdrawalLossAcknowledged: true,
          consentTextVersion: "version-en",
          locale: "en",
        },
      });
    });

    test("a UI locale outside de/en falls back to the german consent texts", async () => {
      uiLocale = "fr-FR";
      queryState = { data: result({ consumerProtection }), loading: false, error: null };
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "billing-foundation.plans.choose" }));
      fireEvent.click(screen.getByLabelText("DE early performance"));
      fireEvent.click(screen.getByLabelText("DE withdrawal loss"));
      fireEvent.click(orderButton());
      await waitFor(() => expect(checkoutMutate).toHaveBeenCalled());
      expect(checkoutMutate).toHaveBeenCalledWith({
        tier: "pro",
        consent: expect.objectContaining({ consentTextVersion: "version-de", locale: "de" }),
      });
    });

    test("consent_text_outdated shows the error in the dialog, clears the boxes and refetches the plans", async () => {
      checkoutResult = {
        isSuccess: false,
        error: {
          code: "consent_text_outdated",
          httpStatus: 422,
          i18nKey: "billing-foundation.errors.consentTextOutdated",
          message: "outdated",
        } as DispatcherError,
      };
      openConsentDialog();
      tickBothConsents();
      fireEvent.click(orderButton());
      await waitFor(() => {
        expect(screen.getByTestId("checkout-consent-error").textContent).toContain(
          "billing-foundation.errors.consentTextOutdated",
        );
      });
      expect(refetchPlans).toHaveBeenCalledTimes(1);
      expect(orderButton().disabled).toBe(true);
      expect(window.location.assign).not.toHaveBeenCalled();
    });

    test("without consumerProtection the checkout CTA calls the mutation directly without consent", async () => {
      queryState = { data: result(), loading: false, error: null };
      renderPanel();
      fireEvent.click(screen.getByRole("button"));
      await waitFor(() => expect(checkoutMutate).toHaveBeenCalledWith({ tier: "pro" }));
      expect(screen.queryByTestId("checkout-consent-dialog")).toBeNull();
      expect(screen.queryByTestId("billing-plans-cancel-contract")).toBeNull();
    });

    function openCancelDialog(): void {
      queryState = {
        data: result({
          consumerProtection,
          subscription: subscription(),
          plans: [plan({ isCurrent: true, action: BillingPlanActions.current })],
        }),
        loading: false,
        error: null,
      };
      renderPanel();
      fireEvent.click(screen.getByTestId("billing-plans-cancel-contract"));
    }

    test("an extraordinary termination cannot continue without a reason", () => {
      openCancelDialog();
      const continueButton = screen.getByTestId("cancel-contract-continue") as HTMLButtonElement;
      fireEvent.click(
        screen.getByRole("button", { name: "billing-foundation.cancel.kind.extraordinary" }),
      );
      expect(continueButton.disabled).toBe(true);
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "Provider changed the terms" },
      });
      expect(continueButton.disabled).toBe(false);
      expect(terminateMutate).not.toHaveBeenCalled();
    });

    test("a termination is sent after confirmation and shows receipt and effective date", async () => {
      openCancelDialog();
      fireEvent.click(screen.getByTestId("cancel-contract-continue"));
      expect(terminateMutate).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId("cancel-contract-submit"));
      await waitFor(() => expect(screen.getByTestId("cancel-contract-receipt")).toBeTruthy());
      expect(terminateMutate).toHaveBeenCalledWith({
        declarationType: "termination",
        terminationKind: "ordinary",
      });
      const receiptText = screen.getByTestId("cancel-contract-receipt").textContent ?? "";
      expect(receiptText).toContain("Jan 15, 2024");
      expect(receiptText).toContain("Feb 1, 2024");
      expect(receiptText).toContain("billing-foundation.cancel.emailConfirmation");
      expect(refetchPlans).toHaveBeenCalledTimes(1);
    });
  });
});
