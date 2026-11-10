import { describe, expect, test } from "bun:test";
import { createSignatureFeature } from "../feature.ts";
import type { SignatureOptions } from "../options.ts";

const baseOptions: SignatureOptions = {
  retention: { keepFor: "10y" },
  linkSecret: "signature-feature-test-link-secret-0123456789",
  renderHtmlToPdf: async () => new Uint8Array(),
  signaturePageUrl: "https://app.example/sign",
  deliverLink: async () => {},
};

const authorizeSubject: NonNullable<SignatureOptions["authorizeSubject"]> = async () => true;

describe("createSignatureFeature :: linkSecret with authorizeSubject", () => {
  test("an empty or blank secret is refused", () => {
    for (const linkSecret of ["", "   "]) {
      expect(() =>
        createSignatureFeature({ ...baseOptions, linkSecret, authorizeSubject }),
      ).toThrow("authorizeSubject needs a non-empty linkSecret");
    }
  });

  test("a real secret is accepted", () => {
    expect(() => createSignatureFeature({ ...baseOptions, authorizeSubject })).not.toThrow();
  });

  test("without authorizeSubject an empty secret does not throw", () => {
    expect(() => createSignatureFeature({ ...baseOptions, linkSecret: "" })).not.toThrow();
  });
});
