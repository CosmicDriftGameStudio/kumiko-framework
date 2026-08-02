// r.contentCollection() — sugar over r.nav() that also records which
// template-resource kind the node lists, so the client can derive the tree
// provider instead of the app repeating navId + kind.

import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "../../testing/boot-validator-fixture";
import { buildAppSchema } from "../build-app-schema";
import { validateBoot as validateBootRaw } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { createRegistry } from "../registry";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

describe("r.contentCollection() — registration", () => {
  test("registers a nav entry with provider:true and returns its qualified name", () => {
    let qn = "";
    const feature = defineFeature("mail", (r) => {
      qn = r.contentCollection({
        id: "templates",
        kind: "mail-html",
        nav: { label: "mail:nav.templates", icon: "file" },
      });
    });

    expect(qn).toBe("mail:nav:templates");
    // The children arrive from a runtime provider — without provider:true the
    // node would render as an empty leaf.
    expect(feature.navs["templates"]?.provider).toBe(true);
    expect(feature.navs["templates"]?.label).toBe("mail:nav.templates");
    expect(feature.navs["templates"]?.icon).toBe("file");
    expect(feature.contentCollections["templates"]?.kind).toBe("mail-html");
  });

  test("passes nav placement through: parent, order, access, workspaces", () => {
    const feature = defineFeature("mail", (r) => {
      r.nav({ id: "root", label: "mail:nav.root" });
      r.contentCollection({
        id: "templates",
        kind: "mail-html",
        nav: {
          label: "mail:nav.templates",
          parent: "mail:nav:root",
          order: 20,
          access: { roles: ["TenantAdmin"] },
          workspaces: ["mail:workspace:ops"],
        },
      });
    });

    const nav = feature.navs["templates"];
    expect(nav?.parent).toBe("mail:nav:root");
    expect(nav?.order).toBe(20);
    expect(nav?.access).toEqual({ roles: ["TenantAdmin"] });
    expect(nav?.workspaces).toEqual(["mail:workspace:ops"]);
  });

  test("rejects a second collection with the same id", () => {
    expect(() =>
      defineFeature("mail", (r) => {
        r.contentCollection({ id: "templates", kind: "mail-html", nav: { label: "a" } });
        r.contentCollection({ id: "templates", kind: "ai-prompt", nav: { label: "b" } });
      }),
    ).toThrow(/already registered/);
  });

  test("rejects an id already taken by a plain r.nav()", () => {
    expect(() =>
      defineFeature("mail", (r) => {
        r.nav({ id: "templates", label: "mail:nav.templates" });
        r.contentCollection({ id: "templates", kind: "mail-html", nav: { label: "b" } });
      }),
    ).toThrow(/already registered/);
  });

  test("rejects a non-kebab id", () => {
    expect(() =>
      defineFeature("mail", (r) => {
        r.contentCollection({ id: "MailTemplates", kind: "mail-html", nav: { label: "a" } });
      }),
    ).toThrow(/kebab-case/);
  });
});

describe("r.contentCollection() — boot validation", () => {
  test("a collection mounted under another feature's nav passes", () => {
    const mail = defineFeature("mail", (r) => {
      r.nav({ id: "root", label: "mail:nav.root" });
    });
    const templates = defineFeature("templates", (r) => {
      r.contentCollection({
        id: "mail-templates",
        kind: "mail-html",
        nav: { label: "templates:nav.mail", parent: "mail:nav:root" },
      });
    });

    expect(() => validateBoot([mail, templates])).not.toThrow();
  });

  test("a dangling parent fails boot instead of silently vanishing from the sidebar", () => {
    const templates = defineFeature("templates", (r) => {
      r.contentCollection({
        id: "mail-templates",
        kind: "mail-html",
        nav: { label: "templates:nav.mail", parent: "mail:nav:root" },
      });
    });

    expect(() => validateBoot([templates])).toThrow(/mail:nav:root/);
  });
});

describe("buildAppSchema — content collections", () => {
  test("projects collections with the nav QN qualified", () => {
    const registry = createRegistry([
      defineFeature("mail", (r) => {
        r.nav({ id: "root", label: "mail:nav.root" });
        r.contentCollection({
          id: "templates",
          kind: "mail-html",
          nav: { label: "mail:nav.templates", parent: "mail:nav:root" },
        });
      }),
    ]);

    const schema = buildAppSchema(registry);
    const mail = schema.features.find((f) => f.featureName === "mail");
    expect(mail?.contentCollections).toEqual([
      {
        id: "templates",
        kind: "mail-html",
        nav: { label: "mail:nav.templates", parent: "mail:nav:root" },
        navQn: "mail:nav:templates",
      },
    ]);
    // The nav entry itself still travels the normal route — the collection
    // list only carries what a NavDefinition cannot express.
    expect(mail?.navs?.map((n) => n.id)).toContain("templates");
  });

  test("omits the slot for features without collections", () => {
    const registry = createRegistry([
      defineFeature("shop", (r) => {
        r.nav({ id: "catalog", label: "shop:nav.catalog" });
      }),
    ]);

    const shop = buildAppSchema(registry).features.find((f) => f.featureName === "shop");
    expect(shop?.contentCollections).toBeUndefined();
  });
});
