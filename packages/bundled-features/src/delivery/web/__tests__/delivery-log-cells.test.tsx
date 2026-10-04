import { describe, expect, test } from "bun:test";
import {
  type ColumnRendererProps,
  createStaticLocaleResolver,
  formatWhen,
  LocaleProvider,
  PrimitivesProvider,
  translationsByLocaleFromKeys,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { DELIVERY_I18N } from "../../i18n.js";
import { DeliveryChannelCell } from "../delivery-channel-cell.js";
import { DeliveryErrorCell } from "../delivery-error-cell.js";
import { DeliveryStatusCell } from "../delivery-status-cell.js";
import { DeliveryTimeCell } from "../delivery-time-cell.js";
import { DeliveryTypeCell } from "../delivery-type-cell.js";

const appBundle = translationsByLocaleFromKeys({
  "orders.notification.assigned": { en: "Order assigned" },
});
const fallbackBundles = [translationsByLocaleFromKeys(DELIVERY_I18N), appBundle];

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider resolver={createStaticLocaleResolver()} fallbackBundles={fallbackBundles}>
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

function cell(
  Cell: (props: ColumnRendererProps) => ReactNode,
  field: string,
  value: string | null,
): ReactNode {
  return (
    <Wrapper>
      <Cell value={value} row={{ [field]: value }} column={{ field }} />
    </Wrapper>
  );
}

describe("delivery log cells", () => {
  test("type: a notification QN uses the app label, else the short name", () => {
    render(cell(DeliveryTypeCell, "type", "orders:notify:assigned"));
    expect(screen.getByText("Order assigned")).toBeTruthy();
    render(cell(DeliveryTypeCell, "type", "orders:notify:unlabeled"));
    expect(screen.getByText("unlabeled")).toBeTruthy();
    render(cell(DeliveryTypeCell, "type", "something-else"));
    expect(screen.getByText("something-else")).toBeTruthy();
  });

  test("channel: translated when registered, raw otherwise", () => {
    const withLabels = translationsByLocaleFromKeys({ "delivery.channel.push": { en: "Push" } });
    render(
      <LocaleProvider resolver={createStaticLocaleResolver()} fallbackBundles={[withLabels]}>
        <PrimitivesProvider value={defaultPrimitives}>
          <DeliveryChannelCell
            value="push"
            row={{ channel: "push" }}
            column={{ field: "channel" }}
          />
        </PrimitivesProvider>
      </LocaleProvider>,
    );
    expect(screen.getByText("Push")).toBeTruthy();
    render(cell(DeliveryChannelCell, "channel", "carrier-pigeon"));
    expect(screen.getByText("carrier-pigeon")).toBeTruthy();
  });

  test("status: translated text, raw for unknown", () => {
    render(cell(DeliveryStatusCell, "status", "failed"));
    expect(screen.getByText("Failed")).toBeTruthy();
    render(cell(DeliveryStatusCell, "status", "weird"));
    expect(screen.getByText("weird")).toBeTruthy();
  });

  test("status: sent without provider confirmation reads Sent (unconfirmed)", () => {
    render(
      <Wrapper>
        <DeliveryStatusCell
          value="sent"
          row={{ status: "sent", confirmed: false }}
          column={{ field: "status" }}
        />
      </Wrapper>,
    );
    expect(screen.getByText("Sent (unconfirmed)")).toBeTruthy();
    render(
      <Wrapper>
        <DeliveryStatusCell
          value="sent"
          row={{ status: "sent", confirmed: null }}
          column={{ field: "status" }}
        />
      </Wrapper>,
    );
    expect(screen.getByText("Sent")).toBeTruthy();
  });

  test("error: code label, http status parameter, raw unknown, empty for null", () => {
    render(cell(DeliveryErrorCell, "error", "send_failed"));
    expect(screen.getByText("Sending failed")).toBeTruthy();
    render(cell(DeliveryErrorCell, "error", "http_503"));
    expect(screen.getByText("HTTP 503")).toBeTruthy();
    render(cell(DeliveryErrorCell, "error", "legacy text"));
    expect(screen.getByText("legacy text")).toBeTruthy();
    const empty = render(cell(DeliveryErrorCell, "error", null));
    expect(empty.container.textContent).toBe("");
  });

  test("time: formatted with formatWhen", () => {
    const iso = "2026-10-04T10:15:00Z";
    render(cell(DeliveryTimeCell, "createdAt", iso));
    expect(screen.getByText(formatWhen(iso))).toBeTruthy();
  });
});
