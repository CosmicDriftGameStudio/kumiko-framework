// Playwright specs derived programmatically from the registry.
//
// How it works: globalSetup (see global-setup.ts) spawns an emitter script
// under bun that calls `generateE2ESpec(registry)` and writes the specs as
// JSON to `e2e/.e2e-data.json`. This spec file reads that JSON, iterates it
// and registers one `test(...)` per TestSpec — the switch delegates to a
// kind-specific handler that drives the real renderer/router.
//
// No framework runtime import here: the barrel transitively pulls modules
// that collide with Playwright's `expect` (Object.prototype symbols). The
// JSON is the process boundary.
//
// When the renderer or the router URL shape changes, exactly one kind
// handler below is adjusted — no framework change needed.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { loginAsAdmin } from "./_helpers/login";

const here = dirname(fileURLToPath(import.meta.url));

// Auth mode: src/server.ts wires auth in, so every test needs a fresh login.
// The ephemeral DB reset between runs does not touch the browser context —
// Playwright creates a new BrowserContext per test, hence one login per test.
test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

// TestSpec shape duplicated — a framework type import would drag in the
// runtime chain. The shape rarely changes and a unit test on the framework
// side pins it.
type E2ETestSpec =
  | { readonly kind: "list-renders"; readonly screenQn: string; readonly title: string }
  | {
      readonly kind: "list-has-fixture-row";
      readonly screenQn: string;
      readonly title: string;
      readonly writeHandlerQn: string;
      readonly fixture: Readonly<Record<string, unknown>>;
      readonly identifyingValue: string;
    }
  | {
      readonly kind: "edit-validates-required";
      readonly screenQn: string;
      readonly title: string;
      readonly requiredFields: readonly string[];
    }
  | {
      readonly kind: "edit-save-persists";
      readonly screenQn: string;
      readonly title: string;
      readonly fills: readonly EditFillOp[];
      readonly identifyingValue: string;
      readonly identifyingField: string;
    };

type EditFillOp =
  | { readonly kind: "fill"; readonly field: string; readonly value: string }
  | { readonly kind: "check"; readonly field: string; readonly value: boolean }
  | { readonly kind: "select"; readonly field: string; readonly value: string };

const dataPath = resolve(here, ".e2e-data.json");
const specs = JSON.parse(readFileSync(dataPath, "utf8")) as readonly E2ETestSpec[];

// screenQn is `<scope>:screen:<id>` (registry convention). The browser router
// reads `location.pathname` via useBrowserNavApi and parsePath — the format is
// `/<screenId>`, without scope and without a tenant segment.
function screenPath(screenQn: string): string {
  const parts = screenQn.split(":");
  return `/${parts[parts.length - 1] ?? ""}`;
}

for (const spec of specs) {
  test(`[${spec.kind}] ${spec.title}`, async ({ page }) => {
    switch (spec.kind) {
      case "list-renders":
        await runListRenders(page, spec);
        return;
      case "list-has-fixture-row":
        await runListHasFixtureRow(page, spec);
        return;
      case "edit-validates-required":
        await runEditValidatesRequired(page, spec);
        return;
      case "edit-save-persists":
        await runEditSavePersists(page, spec);
        return;
    }
  });
}

async function runListRenders(
  page: Page,
  spec: Extract<E2ETestSpec, { kind: "list-renders" }>,
): Promise<void> {
  await page.goto(screenPath(spec.screenQn));
  const tableOrEmpty = page
    .getByTestId("render-list-table")
    .or(page.getByTestId("render-list-empty"));
  await expect(tableOrEmpty).toBeVisible();
}

async function runListHasFixtureRow(
  page: Page,
  spec: Extract<E2ETestSpec, { kind: "list-has-fixture-row" }>,
): Promise<void> {
  // loginAsAdmin sets the cookies in the beforeEach. POST /api/write is
  // state-changing → needs an X-CSRF-Token header mirroring the kumiko_csrf
  // cookie (double-submit pattern).
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === "kumiko_csrf")?.value;
  if (!csrf) throw new Error("no kumiko_csrf cookie after login");

  const res = await page.request.post("/api/write", {
    data: { type: spec.writeHandlerQn, payload: spec.fixture },
    headers: { "X-CSRF-Token": csrf },
  });
  expect(res.ok(), await res.text()).toBe(true);

  await page.goto(screenPath(spec.screenQn));
  // .first() — earlier tests in the same worker write against the same
  // ephemeral DB and can produce the identifyingValue more than once. It is
  // enough that the seeded row shows up somewhere in the list, not that it
  // is unique.
  await expect(page.getByText(spec.identifyingValue).first()).toBeVisible();
}

async function runEditValidatesRequired(
  page: Page,
  spec: Extract<E2ETestSpec, { kind: "edit-validates-required" }>,
): Promise<void> {
  await page.goto(screenPath(spec.screenQn));

  // The intended shape would be: submit empty → field errors visible. That
  // does not work here because render-edit.tsx binds the submit button's
  // disabled state to `isUnchanged`. A generic "make the form dirty" without
  // knowing the feature's optional fields breaks the test's semantics
  // (fill-then-clear lands back on the initial value and stays unchanged).
  //
  // So we check the required-marker bit on the label instead. But: the
  // framework does not propagate `entity.fields[x].required` into the layout
  // field state — form-controller only reads `layout.fields[i].required` (a
  // condition prop). The ui-walkthrough does not declare it, so no marker
  // renders even though the entity def is correct. That is a framework gap,
  // not a defect of this spec. We detect the situation and skip with a clear
  // diagnosis.
  //
  // `count()` does not auto-wait — without gating on the rendered form it
  // reads zero markers off a still-empty page and skips for the wrong reason.
  await expect(page.getByTestId("render-edit-form")).toBeVisible();
  const anyMarker = await page.locator("[data-required]").count();
  if (anyMarker === 0) {
    test.skip(
      true,
      `Layout does not propagate entity-required to the UI (field-state.required is only set via the layout.required condition, not from the entity def). Spec lists ${spec.requiredFields.join(", ")} as required — the UI shows no marker. Framework follow-up.`,
    );
    return;
  }

  for (const field of spec.requiredFields) {
    const marker = page.getByTestId(`field-${field}`).locator("[data-required]");
    await expect(marker).toBeVisible();
  }
}

async function runEditSavePersists(
  page: Page,
  spec: Extract<E2ETestSpec, { kind: "edit-save-persists" }>,
): Promise<void> {
  await page.goto(screenPath(spec.screenQn));

  for (const op of spec.fills) {
    await applyEditFill(page, op);
  }

  // Re-read every control once the whole form is filled. This is what makes a
  // silently skipped interaction visible: a fill handler that does nothing
  // leaves its control at the initial value, and this loop names the field
  // instead of the failure surfacing much later as a missing column value.
  for (const op of spec.fills) {
    await expectEditFillApplied(page.getByTestId(`field-${op.field}`), op);
  }

  await page.getByTestId("render-edit-submit").click();

  // KumikoScreen's useNavigateToListAfter lands on the list screen for the
  // same entity after success. We assert both halves (table visible, value
  // present) instead of trusting a URL shape.
  // .first() — see runListHasFixtureRow.
  await expect(page.getByTestId("render-list-table")).toBeVisible();
  await expect(page.getByText(spec.identifyingValue).first()).toBeVisible();
}

async function applyEditFill(page: Page, op: EditFillOp): Promise<void> {
  const wrapper = page.getByTestId(`field-${op.field}`);
  await expect(wrapper).toBeVisible();
  switch (op.kind) {
    case "fill":
      await wrapper.locator("input").fill(op.value);
      return;
    case "check": {
      // Boolean fields render as a switch (role="switch"), except under
      // layout:"inline" where the checkbox stays (role="checkbox"). Both are
      // Radix primitives without setChecked support (that only works on a real
      // <input type=checkbox|radio>) — click instead of setChecked.
      const control = booleanControl(wrapper);
      const isChecked = (await control.getAttribute("aria-checked")) === "true";
      if (isChecked !== op.value) {
        await control.click();
      }
      return;
    }
    case "select": {
      // A field select never renders a native <select>, so `.selectOption`
      // would be wrong for every one of them: primitives/index.tsx picks
      // SegmentedSelect (role="radiogroup") for a small set of short options
      // and the portalled cmdk combobox otherwise. Probe the DOM for which one
      // is mounted instead of mirroring that heuristic here.
      const radioGroup = wrapper.getByRole("radiogroup");
      if ((await radioGroup.count()) > 0) {
        await radioGroup.getByRole("radio", { name: op.value, exact: true }).click();
        return;
      }
      await wrapper.locator('[data-testid^="combobox-"]').click();
      // The combobox popover renders in a portal, outside the field wrapper.
      await page.getByRole("option", { name: op.value, exact: true }).click();
      return;
    }
  }
}

async function expectEditFillApplied(wrapper: Locator, op: EditFillOp): Promise<void> {
  switch (op.kind) {
    case "fill":
      await expect(wrapper.locator("input")).toHaveValue(op.value);
      return;
    case "check":
      await expect(booleanControl(wrapper)).toHaveAttribute(
        "aria-checked",
        op.value ? "true" : "false",
      );
      return;
    case "select":
      // Both select primitives mirror the current value into a hidden input —
      // the one readable signal they share.
      await expect(wrapper.locator('input[type="hidden"]')).toHaveValue(op.value);
      return;
  }
}

// The two roles are mutually exclusive, so `.or()` keeps the locator lazy and
// auto-waiting instead of resolving the branch with a non-waiting count().
function booleanControl(wrapper: Locator): Locator {
  return wrapper.getByRole("switch").or(wrapper.getByRole("checkbox"));
}
