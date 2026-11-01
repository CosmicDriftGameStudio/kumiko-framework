import { describe, expect, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  ProjectionDetailScreenDefinition,
  ScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { evalFieldCondition } from "@cosmicdrift/kumiko-framework/ui-types";
import { type HelpdeskOptions, resolveHelpdeskSettings } from "../options.ts";
import { createHelpdeskScreens } from "../screens.ts";

function detailScreen(opts: Partial<HelpdeskOptions> = {}): ProjectionDetailScreenDefinition {
  const full: HelpdeskOptions = { appName: "Acme", ...opts };
  const screens: readonly ScreenDefinition[] = createHelpdeskScreens(
    full,
    resolveHelpdeskSettings(full),
  );
  const found = screens.find(
    (screen): screen is ProjectionDetailScreenDefinition => screen.id === "request-detail",
  );
  if (found === undefined) throw new Error("request-detail screen missing");
  return found;
}

function subtitleNavigate(screen: ProjectionDetailScreenDefinition, field: string) {
  const subtitle = screen.header?.subtitle;
  const parts = typeof subtitle === "object" ? subtitle : [];
  const part = parts.find(
    (candidate) => typeof candidate !== "string" && candidate.field === field,
  );
  return typeof part === "object" && "navigate" in part ? part.navigate : undefined;
}

function senderFieldNames(screen: ProjectionDetailScreenDefinition): readonly string[] {
  const sender = screen.layout.sections.find(
    (section) => "title" in section && section.title === "helpdesk:detail.section.sender",
  );
  const fields = sender !== undefined && "fields" in sender ? sender.fields : [];
  return fields.map((entry) => (typeof entry === "string" ? entry : entry.field));
}

function phoneVisibleCondition(screen: ProjectionDetailScreenDefinition) {
  const sender = screen.layout.sections.find(
    (section) => "title" in section && section.title === "helpdesk:detail.section.sender",
  );
  const fields = sender !== undefined && "fields" in sender ? sender.fields : [];
  const phone = fields.find((entry) => typeof entry !== "string" && entry.field === "phone");
  return typeof phone === "object" ? phone.visible : undefined;
}

describe("request-detail header links", () => {
  test("default to the user and tenant edit screens", () => {
    const screen = detailScreen();
    expect(subtitleNavigate(screen, "name")).toEqual({
      screen: "user-edit",
      entityId: "reporterUserId",
    });
    expect(subtitleNavigate(screen, "reporterTenantName")).toEqual({
      screen: "tenant-edit",
      entityId: "reporterTenantId",
    });
  });

  test("detailLinks replaces a target and false removes the link", () => {
    const screen = detailScreen({ detailLinks: { user: "member-edit", tenant: false } });
    expect(subtitleNavigate(screen, "name")).toEqual({
      screen: "member-edit",
      entityId: "reporterUserId",
    });
    expect(subtitleNavigate(screen, "reporterTenantName")).toBeUndefined();
  });
});

describe("request-detail phone row", () => {
  test("fields.phone off: the row is not in the screen", () => {
    expect(senderFieldNames(detailScreen({ fields: { phone: "off" } }))).not.toContain("phone");
  });

  test("optional phone: hidden while empty, shown once set", () => {
    const screen = detailScreen({ fields: { phone: "optional" } });
    expect(senderFieldNames(screen)).toContain("phone");
    const visible = phoneVisibleCondition(screen);
    if (visible === undefined) throw new Error("phone row has no visible condition");
    expect(evalFieldCondition(visible, { phone: null })).toBe(false);
    expect(evalFieldCondition(visible, { phone: "" })).toBe(false);
    expect(evalFieldCondition(visible, { phone: "+49 30 1234567" })).toBe(true);
  });
});

describe("report form hint", () => {
  test("names the app through the appName param", () => {
    const full: HelpdeskOptions = { appName: "publicstatus" };
    const report = createHelpdeskScreens(full, resolveHelpdeskSettings(full)).find(
      (screen): screen is ActionFormScreenDefinition => screen.id === "report",
    );
    expect(report?.summary?.title).toBe("helpdesk:report.hint");
    expect(report?.summary?.params).toEqual({ appName: "publicstatus" });
  });
});
