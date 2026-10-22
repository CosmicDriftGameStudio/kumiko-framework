import type { Page } from "@playwright/test";

// Seeded identities are unique per run (admin-<tenantId>@…), so a screenshot
// would show a different address every time. Replaced in the page's text and
// form values right before each capture; the seeded data stays untouched.
export interface PresentIdentity {
  readonly from: string;
  readonly to: string;
}

export function assertPresentableMappings(mappings: readonly PresentIdentity[]): void {
  for (const { from } of mappings) {
    if (from === "") throw new Error("presentIdentities: `from` must not be empty");
  }
}

declare global {
  interface Window {
    __kumikoPresentRestore?: Array<() => void>;
  }
}

// Runs in the browser, so it may not reference module scope. Originals are kept
// on window so a later evaluate can put them back (captureScreenshot runs
// mid-flow, where the spec keeps asserting and submitting forms).
function replaceIdentitiesInDocument(mappings: readonly PresentIdentity[]): void {
  window.__kumikoPresentRestore ??= [];
  const restorers = window.__kumikoPresentRestore;
  const present = (text: string): string =>
    mappings.reduce((current, { from, to }) => current.replaceAll(from, to), text);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    const presented = present(text);
    if (presented !== text) {
      const textNode = node;
      textNode.nodeValue = presented;
      restorers.push(() => {
        textNode.nodeValue = text;
      });
    }
  }
  for (const field of document.querySelectorAll("input, textarea")) {
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      const original = field.value;
      const presented = present(original);
      if (presented !== original) {
        field.value = presented;
        restorers.push(() => {
          field.value = original;
        });
      }
    }
  }
}

// Reverse order: a second presentation pass records already-presented values.
function restoreIdentitiesInDocument(): void {
  const restorers = window.__kumikoPresentRestore ?? [];
  for (const restore of restorers.reverse()) restore();
  window.__kumikoPresentRestore = [];
}

export async function presentIdentitiesOnPage(
  page: Page,
  mappings: readonly PresentIdentity[],
): Promise<void> {
  if (mappings.length > 0) await page.evaluate(replaceIdentitiesInDocument, mappings);
}

export async function restoreIdentitiesOnPage(
  page: Page,
  mappings: readonly PresentIdentity[],
): Promise<void> {
  if (mappings.length > 0) await page.evaluate(restoreIdentitiesInDocument);
}

export async function withPresentedIdentities<T>(
  page: Page,
  mappings: readonly PresentIdentity[],
  fn: () => Promise<T>,
): Promise<T> {
  assertPresentableMappings(mappings);
  await presentIdentitiesOnPage(page, mappings);
  try {
    return await fn();
  } finally {
    await restoreIdentitiesOnPage(page, mappings);
  }
}
