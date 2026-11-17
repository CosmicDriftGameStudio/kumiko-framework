import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import type { RowFieldExtractor } from "../../types/screen.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

// A non-CRUD write-handler-backed form. Boot checks that the handler is
// non-empty and registered, fields are non-empty and typed, the layout is
// consistent, and any redirect targets a registered screen.
describe("actionForm screen", () => {
  type ActionFormOverride = {
    readonly handler?: string | undefined;
    readonly fields?: Record<string, unknown>;
    readonly sections?: ReadonlyArray<{
      readonly title: string;
      readonly fields?: ReadonlyArray<string | Record<string, unknown>>;
      readonly groups?: ReadonlyArray<{
        readonly title: string;
        readonly fields: readonly string[];
      }>;
    }>;
    readonly queries?: readonly string[];
    readonly redirect?:
      | string
      | {
          readonly screen: string;
          readonly idFrom?: string;
          readonly searchParams?: Readonly<Record<string, string>>;
        };
    readonly successLinks?: ReadonlyArray<{
      readonly screen: string;
      readonly idFrom?: string;
      readonly label: string;
    }>;
    readonly successFacts?: ReadonlyArray<{ readonly field: string; readonly label: string }>;
    readonly successItems?: {
      readonly field: string;
      readonly link?: { readonly screen: string; readonly label: string };
    };
    readonly cancelTarget?: string | false;
    readonly extraScreens?: readonly string[];
    readonly extraDetailScreens?: readonly string[];
    readonly mode?: "single" | "wizard";
    readonly draft?: boolean;
  };

  // Sets up a test entity and write handler so the form can register at boot
  // without custom code. Additional screens can be added for redirect tests.
  function makeFeature(override: ActionFormOverride = {}) {
    const handler = override.handler ?? "shop:write:invoice:approve";
    const fields = override.fields ?? {
      note: { type: "text" },
      priority: { type: "number" },
    };
    const sections = override.sections ?? [{ title: "Approval", fields: ["note", "priority"] }];
    return defineFeature("shop", (r) => {
      // Registers the write handler referenced by the action form. A direct stub is
      // used instead of `defineEntityWriteHandler`, which requires an existing entity.
      r.writeHandler({
        name: "invoice:approve",
        schema: { _type: "stub" } as never,
        handler: async () => ({ isSuccess: true, data: {} }) as never,
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      for (const query of override.queries ?? []) {
        r.queryHandler({
          name: query,
          schema: z.object({}),
          handler: async () => ({}),
          access: { roles: ["Admin"] },
        });
      }
      r.screen({
        id: "approve-invoice",
        type: "actionForm",
        handler,
        fields: fields as never,
        layout: {
          sections: sections as never,
          ...(override.mode !== undefined && { mode: override.mode }),
          ...(override.draft !== undefined && { draft: override.draft }),
        },
        ...(override.redirect !== undefined && { redirect: override.redirect }),
        ...(override.successLinks !== undefined && { successLinks: override.successLinks }),
        ...(override.successFacts !== undefined && { successFacts: override.successFacts }),
        ...(override.successItems !== undefined && { successItems: override.successItems }),
        ...(override.cancelTarget !== undefined && { cancelTarget: override.cancelTarget }),
      });
      for (const extra of override.extraScreens ?? []) {
        r.screen({
          id: extra,
          type: "custom",
          renderer: { react: "stub" },
        });
      }
      if (override.extraDetailScreens?.length) {
        r.queryHandler({
          name: "order:detail",
          schema: z.object({}),
          handler: async () => [],
          access: { roles: ["Admin"] },
        });
      }
      for (const extra of override.extraDetailScreens ?? []) {
        r.screen({
          id: extra,
          type: "projectionDetail",
          query: "shop:query:order:detail",
          layout: { sections: [{ title: "s", fields: ["total"] }] },
        });
      }
    });
  }

  test("happy path: handler + fields + layout consistent → no throw", () => {
    expect(() => validateBoot([makeFeature()])).not.toThrow();
  });

  test("handler not registered as a write-handler → throws with a hint", () => {
    expect(() => validateBoot([makeFeature({ handler: "shop:query:invoice:list" })])).toThrow(
      /handler "shop:query:invoice:list" is not a registered write-handler/,
    );
  });

  test("empty handler → Throw", () => {
    expect(() => validateBoot([makeFeature({ handler: "" })])).toThrow(
      /has empty or non-string handler/,
    );
  });

  test("fields empty-Map → Throw", () => {
    expect(() => validateBoot([makeFeature({ fields: {} })])).toThrow(
      /has empty fields map — declare at least one field/,
    );
  });

  test("field without a type discriminator → throws", () => {
    expect(() => validateBoot([makeFeature({ fields: { note: { required: true } } })])).toThrow(
      /field "note" has no `type` set/,
    );
  });

  // An actionForm has no entity, so a money field there can't
  // inherit entity.defaultCurrency — undeclared, the renderer seeds a bare
  // `0` and the handler's zod schema rejects the submit.
  describe("money field currency source", () => {
    const moneyForm = (currency?: unknown) =>
      makeFeature({
        fields: { amount: { type: "money", ...(currency !== undefined && { currency }) } },
        sections: [{ title: "Payment", fields: ["amount"] }],
      });

    test("money field without currency → throws, naming the screen and field", () => {
      expect(() => validateBoot([moneyForm()])).toThrow(
        /Screen "approve-invoice" \(actionForm\) money field "amount" must declare where its currency comes from/,
      );
    });

    test("error message names both valid forms verbatim", () => {
      expect(() => validateBoot([moneyForm()])).toThrow(
        /currency: \{ kind: "literal", code: "EUR" \}[\s\S]*currency: \{ kind: "tenant" \}/,
      );
    });

    test("currency: { kind: 'literal', code } → no throw", () => {
      expect(() => validateBoot([moneyForm({ kind: "literal", code: "EUR" })])).not.toThrow();
    });

    test("currency: { kind: 'tenant' } → no throw", () => {
      expect(() => validateBoot([moneyForm({ kind: "tenant" })])).not.toThrow();
    });

    test("literal with an empty code → throws", () => {
      expect(() => validateBoot([moneyForm({ kind: "literal", code: "  " })])).toThrow(
        /empty or non-string `code`/,
      );
    });

    test("unbekannter kind → Throw", () => {
      expect(() => validateBoot([moneyForm({ kind: "entityDefault" })])).toThrow(
        /unknown currency kind "entityDefault"/,
      );
    });

    test("non-money fields remain unchanged", () => {
      expect(() => validateBoot([makeFeature()])).not.toThrow();
    });

    // The check sits in validateFormFieldsMap, the walk actionForm,
    // secretMint and secretMint's confirm step all share.
    function mintFeature(fields: Record<string, unknown>, confirmFields?: Record<string, unknown>) {
      return defineFeature("shop", (r) => {
        r.writeHandler({
          name: "token:mint",
          schema: { _type: "stub" } as never,
          handler: async () => ({ isSuccess: true, data: {} }) as never,
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "mint-token",
          type: "secretMint",
          handler: "shop:write:token:mint",
          fields: fields as never,
          layout: { sections: [{ title: "Mint", fields: Object.keys(fields) }] as never },
          reveal: { fields: [{ field: "token", label: "Token" }] },
          ...(confirmFields !== undefined && {
            confirm: {
              handler: "shop:write:token:mint",
              fields: confirmFields as never,
              layout: {
                sections: [{ title: "Confirm", fields: Object.keys(confirmFields) }] as never,
              },
            },
          }),
        });
      });
    }

    test("secretMint money field without currency → throws", () => {
      expect(() => validateBoot([mintFeature({ fee: { type: "money" } })])).toThrow(
        /Screen "mint-token" \(secretMint\) money field "fee" must declare where its currency comes from/,
      );
    });

    test("secretMint confirm-step money field without currency → throws", () => {
      expect(() =>
        validateBoot([
          mintFeature(
            { fee: { type: "money", currency: { kind: "literal", code: "EUR" } } },
            { topUp: { type: "money" } },
          ),
        ]),
      ).toThrow(
        /Screen "mint-token" \(secretMint confirm\) money field "topUp" must declare where its currency comes from/,
      );
    });

    test("secretMint with declared sources in both steps → no throw", () => {
      expect(() =>
        validateBoot([
          mintFeature(
            { fee: { type: "money", currency: { kind: "literal", code: "EUR" } } },
            { topUp: { type: "money", currency: { kind: "tenant" } } },
          ),
        ]),
      ).not.toThrow();
    });
  });

  test("empty layout.sections → Throw", () => {
    expect(() => validateBoot([makeFeature({ sections: [] })])).toThrow(
      /has an empty sections list/,
    );
  });

  test("empty section.fields → Throw", () => {
    expect(() =>
      validateBoot([makeFeature({ sections: [{ title: "Empty", fields: [] }] })]),
    ).toThrow(/section "Empty" with zero fields/);
  });

  test("section with empty groups → throws (empty card)", () => {
    expect(() =>
      validateBoot([makeFeature({ sections: [{ title: "Empty", groups: [] }] })]),
    ).toThrow(/section "Empty" with zero fields/);
  });

  test.each([
    ["fields: []", []],
    ["non-empty fields", ["name"]],
  ])("section with %s alongside groups → throws; migration names fields: []", (_label, fields) => {
    expect(() =>
      validateBoot([
        makeFeature({
          sections: [{ title: "Both", fields, groups: [{ title: "G", fields: ["name"] }] }],
        }),
      ]),
    ).toThrow(/section "Both" declares both fields and groups — remove `fields: \[\]`/);
  });

  test("layout referenziert unknown field → Throw", () => {
    expect(() =>
      validateBoot([makeFeature({ sections: [{ title: "x", fields: ["ghost"] }] })]),
    ).toThrow(/layout references unknown field "ghost"/);
  });

  test("section with fields AND groups → throws", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          sections: [
            {
              title: "Approval",
              fields: ["note"],
              groups: [{ title: "Priority", fields: ["priority"] }],
            },
          ],
        }),
      ]),
    ).toThrow(/declares both fields and groups/);
  });

  test("group referenziert unknown field → Throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          sections: [{ title: "Approval", groups: [{ title: "Priority", fields: ["ghost"] }] }],
        }),
      ]),
    ).toThrow(/layout references unknown field "ghost"/);
  });

  test("valid groups → no throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          sections: [
            {
              title: "Approval",
              groups: [
                { title: "Basics", fields: ["note"] },
                { title: "Priority", fields: ["priority"] },
              ],
            },
          ],
        }),
      ]),
    ).not.toThrow();
  });

  test("redirect → existing screen-id in the same feature → no throw", () => {
    expect(() =>
      validateBoot([makeFeature({ redirect: "after-form", extraScreens: ["after-form"] })]),
    ).not.toThrow();
  });

  test("redirect → unknown screen-id → Throw", () => {
    expect(() => validateBoot([makeFeature({ redirect: "ghost-screen" })])).toThrow(
      /redirect "ghost-screen" does not resolve to a registered screen/,
    );
  });

  // --- redirect object form with idFrom ---
  test("redirect object → existing id-carrying screen → no throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          redirect: { screen: "after-form", idFrom: "leaseId" },
          extraDetailScreens: ["after-form"],
        }),
      ]),
    ).not.toThrow();
  });

  test("redirect object with idFrom → custom screen (reads id from route) → no throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          redirect: { screen: "after-form", idFrom: "leaseId" },
          extraScreens: ["after-form"],
        }),
      ]),
    ).not.toThrow();
  });

  test("redirect object with idFrom → screen without an ID (actionForm) → throws", () => {
    expect(() =>
      validateBoot([makeFeature({ redirect: { screen: "approve-invoice", idFrom: "leaseId" } })]),
    ).toThrow(
      /redirect\.idFrom is set but target screen "approve-invoice" \(actionForm\) carries no id/,
    );
  });

  test("redirect object → unknown screen-id → throws (unwrap does not bypass validation)", () => {
    expect(() =>
      validateBoot([makeFeature({ redirect: { screen: "ghost-screen", idFrom: "leaseId" } })]),
    ).toThrow(/redirect "ghost-screen" does not resolve to a registered screen/);
  });

  test("redirect object with an empty idFrom → throws", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          redirect: { screen: "after-form", idFrom: "  " },
          extraScreens: ["after-form"],
        }),
      ]),
    ).toThrow(/redirect\.idFrom is empty/);
  });

  test("redirect object with an idFrom containing whitespace → throws", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          redirect: { screen: "after-form", idFrom: " leaseId" },
          extraScreens: ["after-form"],
        }),
      ]),
    ).toThrow(/redirect\.idFrom " leaseId" has leading\/trailing whitespace/);
  });

  test("redirect object with searchParams and no idFrom → custom screen → no throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          redirect: { screen: "after-form", searchParams: { cmd: "threadId" } },
          extraScreens: ["after-form"],
        }),
      ]),
    ).not.toThrow();
  });

  test("redirect object with an empty searchParams field → throws", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          redirect: { screen: "after-form", searchParams: { cmd: " " } },
          extraScreens: ["after-form"],
        }),
      ]),
    ).toThrow(/redirect\.searchParams entry "cmd" has an empty param name or payload field/);
  });

  test("redirect object with an empty searchParams key → throws", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          redirect: { screen: "after-form", searchParams: { "": "threadId" } },
          extraScreens: ["after-form"],
        }),
      ]),
    ).toThrow(/redirect\.searchParams entry "" has an empty param name or payload field/);
  });

  // --- successLinks ---
  test("successLinks → existing screens → no throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          successLinks: [
            { screen: "after-form", idFrom: "leaseId", label: "shop.link.lease" },
            { screen: "other-form", idFrom: "id", label: "shop.link.other" },
          ],
          extraDetailScreens: ["after-form", "other-form"],
        }),
      ]),
    ).not.toThrow();
  });

  test("successLinks together with redirect → Throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          redirect: "overview",
          successLinks: [{ screen: "overview", idFrom: "id", label: "shop.link.overview" }],
          extraScreens: ["overview"],
        }),
      ]),
    ).toThrow(/sets both redirect and successLinks/);
  });

  test("successFacts together with redirect → Throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          redirect: "overview",
          successFacts: [{ field: "count", label: "shop.fact.count" }],
          extraScreens: ["overview"],
        }),
      ]),
    ).toThrow(/sets both redirect and successFacts/);
  });

  test("successItems together with redirect → Throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          redirect: "overview",
          successItems: { field: "results" },
          extraScreens: ["overview"],
        }),
      ]),
    ).toThrow(/sets both redirect and successItems/);
  });

  test("successItems link → unknown screen → Throw naming the link", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          successItems: {
            field: "results",
            link: { screen: "ghost-screen", label: "shop.link.ghost" },
          },
        }),
      ]),
    ).toThrow(/successItems\.link "ghost-screen" does not resolve to a registered screen/);
  });

  test("successItems link → existing screen → no throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          successItems: { field: "results", link: { screen: "overview", label: "shop.link.x" } },
          extraScreens: ["overview"],
        }),
      ]),
    ).not.toThrow();
  });

  test("successLinks → unknown screen → Throw naming the link", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          successLinks: [{ screen: "ghost-screen", idFrom: "id", label: "shop.link.ghost" }],
        }),
      ]),
    ).toThrow(/successLinks\[0\] "ghost-screen" does not resolve to a registered screen/);
  });

  test("successLinks idFrom on a custom screen → no throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          successLinks: [{ screen: "overview", idFrom: "leaseId", label: "shop.link.overview" }],
          extraScreens: ["overview"],
        }),
      ]),
    ).not.toThrow();
  });

  test("successLinks idFrom on a screen without id → Throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          successLinks: [{ screen: "approve-invoice", idFrom: "leaseId", label: "shop.link.self" }],
        }),
      ]),
    ).toThrow(
      /successLinks\[0\]\.idFrom is set but target screen "approve-invoice" \(actionForm\)/,
    );
  });

  test("successLinks without idFrom → screen that carries no id → no throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          successLinks: [{ screen: "overview", label: "shop.link.overview" }],
          extraScreens: ["overview"],
        }),
      ]),
    ).not.toThrow();
  });

  test("successLinks without idFrom → record screen → Throw naming the link", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          successLinks: [{ screen: "after-form", label: "shop.link.lease" }],
          extraDetailScreens: ["after-form"],
        }),
      ]),
    ).toThrow(/successLinks\[0\] targets "after-form" \(projectionDetail\), a record screen/);
  });

  test("successLinks without idFrom → unknown screen → Throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({ successLinks: [{ screen: "ghost-screen", label: "shop.link.ghost" }] }),
      ]),
    ).toThrow(/successLinks\[0\] "ghost-screen" does not resolve to a registered screen/);
  });

  // --- field prefix / suffix / fillAction ---
  const fillSections = (field: Record<string, unknown>) => [
    { title: "Approval", fields: [{ field: "note", ...field }, "priority"] },
  ];
  const fillAction = {
    label: "shop.fill.roll",
    query: "shop:query:suggest-note",
    field: "suggestion",
  };

  test("fillAction with a registered query, form-field affix and pick params → no throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          queries: ["suggest-note"],
          sections: fillSections({
            prefix: "https://",
            suffix: { field: "priority" },
            fillAction: { ...fillAction, params: { pick: ["priority"] } },
          }),
        }),
      ]),
    ).not.toThrow();
  });

  test("fillAction → unregistered query → Throw naming the field", () => {
    expect(() => validateBoot([makeFeature({ sections: fillSections({ fillAction }) })])).toThrow(
      /Screen "approve-invoice" \(actionForm\) field "note" fillAction query "shop:query:suggest-note" is not a registered query-handler/,
    );
  });

  test("suffix { field } naming a field outside the form → Throw", () => {
    expect(() =>
      validateBoot([makeFeature({ sections: fillSections({ suffix: { field: "ghost" } }) })]),
    ).toThrow(/field "note" suffix references unknown field "ghost"/);
  });

  test("prefix { field } naming a field outside the form → Throw", () => {
    expect(() =>
      validateBoot([makeFeature({ sections: fillSections({ prefix: { field: "ghost" } }) })]),
    ).toThrow(/field "note" prefix references unknown field "ghost"/);
  });

  test("fillAction params reading a field outside the form (pick and map) → Throw", () => {
    for (const params of [{ pick: ["ghost"] }, { map: { to: "ghost" } }]) {
      expect(() =>
        validateBoot([
          makeFeature({
            queries: ["suggest-note"],
            sections: fillSections({ fillAction: { ...fillAction, params } }),
          }),
        ]),
      ).toThrow(/fillAction\.params reads unknown field "ghost"/);
    }
  });

  test.each([
    ["a password field", { type: "text", format: "password" }, /sensitive, writeOnly or password/],
    ["a sensitive field", { type: "text", sensitive: true }, /sensitive, writeOnly or password/],
    [
      "a boolean field",
      { type: "boolean" },
      /fillAction needs a text, number, decimal, bigInt field/,
    ],
  ])("fillAction on %s → Throw", (_name, noteField, message) => {
    expect(() =>
      validateBoot([
        makeFeature({
          queries: ["suggest-note"],
          fields: { note: noteField, priority: { type: "number" } },
          sections: fillSections({ fillAction }),
        }),
      ]),
    ).toThrow(message);
  });

  test("fillAction on a number field → no throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          queries: ["suggest-note"],
          fields: { note: { type: "number" }, priority: { type: "number" } },
          sections: fillSections({ fillAction }),
        }),
      ]),
    ).not.toThrow();
  });

  test("cancelTarget → existing screen-id → no throw", () => {
    expect(() =>
      validateBoot([makeFeature({ cancelTarget: "after-form", extraScreens: ["after-form"] })]),
    ).not.toThrow();
  });

  test("cancelTarget → unknown screen-id → Throw", () => {
    expect(() => validateBoot([makeFeature({ cancelTarget: "ghost-screen" })])).toThrow(
      /cancelTarget "ghost-screen" does not resolve to a registered screen/,
    );
  });

  test("cancelTarget=false (button disabled) → no throw", () => {
    expect(() => validateBoot([makeFeature({ cancelTarget: false })])).not.toThrow();
  });

  // --- redirect/cancelTarget: cross-feature QN ---
  test("redirect → fully qualified cross-feature QN → no throw", () => {
    const consumer = defineFeature("statements", (r) => {
      r.screen({ id: "statement-upload-list", type: "custom", renderer: { react: "stub" } });
    });
    expect(() =>
      validateBoot([
        makeFeature({ redirect: "statements:screen:statement-upload-list" }),
        consumer,
      ]),
    ).not.toThrow();
  });

  test("redirect → unbekannte Cross-Feature-QN → Throw", () => {
    expect(() =>
      validateBoot([makeFeature({ redirect: "statements:screen:ghost-screen" })]),
    ).toThrow(/redirect "statements:screen:ghost-screen" does not resolve to a registered screen/);
  });

  test("cancelTarget → fully qualified cross-feature QN → no throw", () => {
    const consumer = defineFeature("statements", (r) => {
      r.screen({ id: "statement-upload-list", type: "custom", renderer: { react: "stub" } });
    });
    expect(() =>
      validateBoot([
        makeFeature({ cancelTarget: "statements:screen:statement-upload-list" }),
        consumer,
      ]),
    ).not.toThrow();
  });

  test("extension section without a component → throws (parity with entityEdit)", () => {
    // `synthesizeActionFormScreen` passes the layout unchanged to RenderEdit;
    // without a react/native marker, an extension section would render empty
    // without an obvious error.
    const section = { kind: "extension", title: "Custom", component: {} };
    expect(() => validateBoot([makeFeature({ sections: [section] as never })])).toThrow(
      /\(actionForm\) extension section "Custom" has no component/,
    );
  });

  test("extension section with a react component → no throw", () => {
    const section = { kind: "extension", title: "Custom", component: { react: "Panel" } };
    expect(() => validateBoot([makeFeature({ sections: [section] as never })])).not.toThrow();
  });

  test("mode: wizard with only 1 section → throws", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          mode: "wizard",
          sections: [{ title: "Step 1", fields: ["note"] }],
        }),
      ]),
    ).toThrow(/mode: "wizard" but only 1 section\(s\)/);
  });

  test("mode: wizard with a section without a title → throws", () => {
    const sections = [
      { title: "Step 1", fields: ["note"] },
      { title: "", fields: ["priority"] },
    ];
    expect(() => validateBoot([makeFeature({ mode: "wizard", sections })])).toThrow(
      /sections\[1\] has no title/,
    );
  });

  test("mode: wizard with >= 2 titled sections → no throw", () => {
    const sections = [
      { title: "Step 1", fields: ["note"] },
      { title: "Step 2", fields: ["priority"] },
    ];
    expect(() => validateBoot([makeFeature({ mode: "wizard", sections })])).not.toThrow();
  });

  test("draft: true without a mounted form-draft feature → throws", () => {
    const sections = [
      { title: "Step 1", fields: ["note"] },
      { title: "Step 2", fields: ["priority"] },
    ];
    expect(() => validateBoot([makeFeature({ mode: "wizard", sections, draft: true })])).toThrow(
      /"form-draft" is not mounted/,
    );
  });

  test("draft: true with a mounted form-draft feature → no throw", () => {
    const sections = [
      { title: "Step 1", fields: ["note"] },
      { title: "Step 2", fields: ["priority"] },
    ];
    expect(() =>
      validateBoot([
        makeFeature({ mode: "wizard", sections, draft: true }),
        defineFeature("form-draft", () => {}),
      ]),
    ).not.toThrow();
  });

  test("draft: true without mode: 'wizard' → throws", () => {
    expect(() => validateBoot([makeFeature({ draft: true })])).toThrow(/mode is not "wizard"/);
  });

  test("mode omitted (default 'single') keeps the existing layout valid → no throw", () => {
    expect(() => validateBoot([makeFeature()])).not.toThrow();
  });
});

describe("actionForm load", () => {
  function makeLoadFeature(opts: {
    readonly loadQuery: string;
    readonly submitPrefilled?: boolean;
    readonly drawerParams?: RowFieldExtractor;
  }) {
    return defineFeature("shop", (r) => {
      r.queryHandler({
        name: "products",
        schema: z.object({}),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.queryHandler({
        name: "product:detail",
        schema: z.object({ id: z.string() }),
        handler: async () => ({ id: "p1", name: "Pen" }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.writeHandler({
        name: "rename",
        schema: z.object({ id: z.string(), name: z.string() }),
        handler: async () => ({ isSuccess: true as const, data: null }),
        access: { roles: ["Admin"] },
      });
      r.screen({
        id: "product-projection",
        type: "projectionList",
        query: "shop:query:products",
        columns: ["name"],
        rowActions: [
          {
            kind: "drawer",
            id: "rename",
            label: "actions.rename",
            screen: "rename-form",
            params: opts.drawerParams ?? { pick: ["id"] },
          },
        ],
      });
      r.screen({
        id: "rename-form",
        type: "actionForm",
        handler: "shop:write:rename",
        fields: { id: { type: "text", required: true }, name: { type: "text", required: true } },
        layout: { sections: [{ fields: [{ field: "id", visible: false }, "name"] }] },
        load: { query: opts.loadQuery },
        ...(opts.submitPrefilled !== undefined && { submitPrefilled: opts.submitPrefilled }),
      });
    });
  }

  test("a registered load query passes boot", () => {
    expect(() =>
      validateBoot([makeLoadFeature({ loadQuery: "shop:query:product:detail" })]),
    ).not.toThrow();
  });

  test("an unknown load query is rejected", () => {
    expect(() => validateBoot([makeLoadFeature({ loadQuery: "shop:query:nope" })])).toThrow(
      /Screen "rename-form" \(actionForm\) load query "shop:query:nope"/,
    );
  });

  test("a load form with submitPrefilled needs no navigate source for a hidden required field", () => {
    expect(() =>
      validateBoot([
        makeLoadFeature({ loadQuery: "shop:query:product:detail", submitPrefilled: true }),
      ]),
    ).not.toThrow();
  });

  test("a drawer passes only the row id: other params keys still need a form field", () => {
    expect(() =>
      validateBoot([
        makeLoadFeature({
          loadQuery: "shop:query:product:detail",
          drawerParams: { pick: ["id", "nope"] },
        }),
      ]),
    ).toThrow(/params prefills "nope"/);
  });
});
