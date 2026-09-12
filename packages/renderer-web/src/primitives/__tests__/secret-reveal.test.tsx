// fw#2838: SecretRevealValue.qr renders a scannable QR code (otpauth://-style
// enrollment URI) instead of the default monospaced text display.
import { describe, expect, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import { defaultPrimitives } from "../index";

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
});
