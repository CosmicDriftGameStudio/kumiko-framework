import { describe, expect, test } from "bun:test";
import type { LocaleResolver } from "@cosmicdrift/kumiko-headless";
import { render, waitFor } from "@testing-library/react";
import { DocumentLangSync } from "../document-lang-sync";

function resolverWithLocale(initial: string): {
  readonly resolver: LocaleResolver;
  setLocale(next: string): void;
} {
  let locale = initial;
  const listeners = new Set<() => void>();
  return {
    resolver: {
      translate: (key: string) => key,
      locale: () => locale,
      timeZone: () => "UTC",
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    setLocale(next: string) {
      locale = next;
      for (const listener of listeners) listener();
    },
  };
}

describe("DocumentLangSync", () => {
  test("sets document.documentElement.lang from the resolver and updates on locale change", async () => {
    const { resolver, setLocale } = resolverWithLocale("de-DE");
    render(<DocumentLangSync resolver={resolver} />);

    await waitFor(() => {
      expect(document.documentElement.lang).toBe("de-DE");
    });

    setLocale("en-US");
    await waitFor(() => {
      expect(document.documentElement.lang).toBe("en-US");
    });
  });
});
