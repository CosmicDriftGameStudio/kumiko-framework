import { describe, expect, mock, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { render, screen } from "../../__tests__/test-utils.tsx";
import { PlanCard, PlanGrid } from "../plan-card.tsx";

describe("PlanCard", () => {
  test("current renders the badge and the primary border, and no cta when none is passed", () => {
    render(<PlanCard title="Business" current testId="plan-card-business" />);
    expect(screen.getByText("Current plan")).toBeTruthy();
    expect(screen.getByTestId("plan-card-business").className).toContain("border-primary");
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("non-current plan has no current-plan badge", () => {
    render(<PlanCard title="Business" />);
    expect(screen.queryByText("Current plan")).toBeNull();
  });

  test("cta click calls onClick", () => {
    const onClick = mock(() => {});
    render(<PlanCard title="Pro" cta={{ label: "Choose plan", onClick }} testId="plan-card-pro" />);
    fireEvent.click(screen.getByText("Choose plan"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("disabled cta does not fire onClick", () => {
    const onClick = mock(() => {});
    render(
      <PlanCard
        title="Pro"
        cta={{ label: "Choose plan", onClick, disabled: true }}
        testId="plan-card-pro"
      />,
    );
    const button = screen.getByText("Choose plan") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  test("ctaLink renders a link with href, and target/rel for _blank", () => {
    render(
      <PlanCard
        title="Enterprise"
        ctaLink={{ label: "Contact us", href: "https://example.com/contact", target: "_blank" }}
        testId="plan-card-ent"
      />,
    );
    const link = screen.getByTestId("plan-card-ent-cta");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://example.com/contact");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("ctaLink without target sets no target", () => {
    render(<PlanCard title="Enterprise" ctaLink={{ label: "Mail", href: "mailto:a@b.co" }} />);
    expect(screen.getByText("Mail").getAttribute("target")).toBeNull();
  });

  test("secondaryAction renders alongside cta", () => {
    const onManage = mock(() => {});
    render(
      <PlanCard
        title="Pro"
        cta={{ label: "Choose plan", onClick: () => {} }}
        secondaryAction={{ label: "Manage subscription", onClick: onManage }}
      />,
    );
    fireEvent.click(screen.getByText("Manage subscription"));
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  test("price=null renders the price-unavailable fallback instead of an amount", () => {
    render(<PlanCard title="Pro" price={null} testId="plan-card-pro" />);
    expect(screen.getByText("Price not available")).toBeTruthy();
    expect(screen.getByTestId("plan-card-pro-price-unavailable")).toBeTruthy();
  });

  test("price.prefix renders before the amount", () => {
    render(
      <PlanCard title="Pro" price={{ amount: "9,00 €", prefix: "ab" }} testId="plan-card-pro" />,
    );
    const text = screen.getByTestId("plan-card-pro").textContent ?? "";
    expect(text.indexOf("ab")).toBeLessThan(text.indexOf("9,00 €"));
  });

  test("price omitted renders neither an amount nor the fallback", () => {
    render(<PlanCard title="Free" />);
    expect(screen.queryByText("Price not available")).toBeNull();
  });

  test("features render as a checkmark list", () => {
    render(<PlanCard title="Pro" features={["Unlimited projects", "Priority support"]} />);
    expect(screen.getByText("Unlimited projects")).toBeTruthy();
    expect(screen.getByText("Priority support")).toBeTruthy();
  });

  test("compact variant renders title and price but no feature list", () => {
    render(
      <PlanCard
        title="Credits 100"
        variant="compact"
        price={{ amount: "$9.99" }}
        features={["Should not render"]}
      />,
    );
    expect(screen.getByText("Credits 100")).toBeTruthy();
    expect(screen.getByText("$9.99")).toBeTruthy();
    expect(screen.queryByText("Should not render")).toBeNull();
  });
});

describe("PlanGrid", () => {
  test("renders its children inside a grid host", () => {
    const { container } = render(
      <PlanGrid testId="plan-grid">
        <PlanCard title="Basic" />
        <PlanCard title="Pro" />
      </PlanGrid>,
    );
    expect(screen.getByText("Basic")).toBeTruthy();
    expect(screen.getByText("Pro")).toBeTruthy();
    expect(container.querySelector('[data-testid="plan-grid"]')).toBeTruthy();
  });
});
