// fw#2838: SecretRevealValue.qr renders a scannable QR code (otpauth://-style
// enrollment URI) instead of the default monospaced text display.
import { describe, expect, spyOn, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import QRCode from "qrcode/lib/browser.js";
import { defaultPrimitives } from "../index.js";

const { SecretReveal } = defaultPrimitives;
if (SecretReveal === undefined) {
  throw new Error("defaultPrimitives.SecretReveal is not registered");
}

describe("DefaultSecretReveal (fw#2548 / fw#2838)", () => {
  test("without qr, renders the value as monospaced text", () => {
    render(
      <SecretReveal
        values={[{ label: "Token", value: "kpat_secret", copyable: true, multiline: false }]}
        copyLabel="Copy"
        copiedLabel="Copied"
        testId="reveal"
      />,
    );
    const reveal = screen.getByTestId("reveal");
    expect(reveal.textContent).toContain("kpat_secret");
    expect(reveal.querySelector("svg")).toBeNull();
  });

  test("with qr: true, renders a scannable QR code instead of monospaced text", async () => {
    render(
      <SecretReveal
        values={[
          {
            label: "Token",
            value: "otpauth://totp/Example:alice?secret=ABC&issuer=Example",
            copyable: false,
            multiline: false,
            qr: true,
          },
        ]}
        copyLabel="Copy"
        copiedLabel="Copied"
        testId="reveal"
      />,
    );
    const reveal = screen.getByTestId("reveal");
    await waitFor(() => expect(reveal.querySelector("svg")).not.toBeNull());
    expect(reveal.textContent).not.toContain("otpauth://");
  });

  test("with qr: true and a failing QR encoder, falls back to the plain value", async () => {
    const spy = spyOn(QRCode, "toString").mockImplementation(() =>
      Promise.reject(new Error("encode failed")),
    );
    try {
      render(
        <SecretReveal
          values={[
            {
              label: "Token",
              value: "plain-fallback",
              copyable: false,
              multiline: false,
              qr: true,
            },
          ]}
          copyLabel="Copy"
          copiedLabel="Copied"
          testId="reveal"
        />,
      );
      const reveal = screen.getByTestId("reveal");
      await waitFor(() => expect(reveal.textContent).toContain("plain-fallback"));
      expect(reveal.querySelector("svg")).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  test("two values sharing a label render separately without a duplicate-key warning", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <SecretReveal
          values={[
            { label: "Code", value: "first-value", copyable: false, multiline: false },
            { label: "Code", value: "second-value", copyable: false, multiline: false },
          ]}
          copyLabel="Copy"
          copiedLabel="Copied"
          testId="reveal"
        />,
      );
      const text = screen.getByTestId("reveal").textContent;
      expect(text).toContain("first-value");
      expect(text).toContain("second-value");
      const keyWarnings = spy.mock.calls.filter((call) => String(call[0]).includes("same key"));
      expect(keyWarnings).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
