import { describe, expect, it } from "bun:test";
import { reportStanceForSource } from "../scripts/codemod/pii-personal-migration";

function wrapField(fieldSrc: string): string {
  return `
const entity = createEntity({
  table: "entity_table",
  fields: {
    ${fieldSrc}
  },
});
`;
}

describe("reportStanceForSource", () => {
  it("classifies an exact PII_DIRECT_NAME_HINTS match", () => {
    const [site] = reportStanceForSource(wrapField("email: createTextField({}),"), "t.ts");
    expect(site?.stance).toBe("direct");
    expect(site?.hint).toBe("email");
  });

  it("classifies an exact PII_USER_OWNED_NAME_HINTS match", () => {
    const [site] = reportStanceForSource(wrapField("note: createTextField({}),"), "t.ts");
    expect(site?.stance).toBe("user-owned");
    expect(site?.hint).toBe("note");
  });

  it("classifies an exact PII_USER_REFERENCE_NAME_HINTS match", () => {
    const [site] = reportStanceForSource(wrapField("authorId: createTextField({}),"), "t.ts");
    expect(site?.stance).toBe("user-reference");
    expect(site?.hint).toBe("authorid");
  });

  it("classifies a near-miss when a hint occurs at a segment boundary", () => {
    const [site] = reportStanceForSource(
      wrapField("advisorDisplayName: createTextField({}),"),
      "t.ts",
    );
    expect(site?.stance).toBe("near-miss");
    expect(site?.hint).toBe("displayname");
  });

  it("picks the longest hint on multiple boundary matches", () => {
    const [site] = reportStanceForSource(
      wrapField("customerEmailAddress: createTextField({}),"),
      "t.ts",
    );
    expect(site?.stance).toBe("near-miss");
    expect(site?.hint).toBe("address");
  });

  // No hint entry is a substring of "performedbyuserid" itself, but its
  // segment-aligned suffix "userid" (>= 5 chars) is a substring of the
  // full-name hints "createdbyuserid"/"updatedbyuserid"/"assigneeuserid" —
  // the shortest of the three, "assigneeuserid", is reported.
  it.each([
    ["performedByUserId", "assigneeuserid"],
    ["portalUserId", "assigneeuserid"],
    ["ownerUserId", "assigneeuserid"],
  ])("classifies %s as near-miss via its segment-aligned suffix", (field, expectedHint) => {
    const [site] = reportStanceForSource(wrapField(`${field}: createTextField({}),`), "t.ts");
    expect(site?.stance).toBe("near-miss");
    expect(site?.hint).toBe(expectedHint);
  });

  it.each([
    "contextId",
    "stepKey",
    "runId",
    "scheduleId",
    "costCategoryId",
    "toolCallId",
    "conversationId",
    "handlerQn",
  ])("classifies %s as unclassified — no hint containment or suffix match", (field) => {
    const [site] = reportStanceForSource(wrapField(`${field}: createTextField({}),`), "t.ts");
    expect(site?.stance).toBe("unclassified");
    expect(site?.hint).toBeUndefined();
  });

  it("does not report a call already annotated with a personal stance", () => {
    const sites = reportStanceForSource(
      wrapField('email: createTextField({ personal: false, reason: "x" }),'),
      "t.ts",
    );
    expect(sites).toHaveLength(0);
  });

  it("reports a call whose personal value is undefined", () => {
    const sites = reportStanceForSource(
      wrapField("email: createTextField({ personal: undefined }),"),
      "t.ts",
    );
    expect(sites).toHaveLength(1);
  });

  it("does not report a call whose options literal contains a spread", () => {
    const sites = reportStanceForSource(wrapField("email: createTextField({ ...base }),"), "t.ts");
    expect(sites).toHaveLength(0);
  });

  it("does not report a call with a non-literal options argument", () => {
    const sites = reportStanceForSource(wrapField("email: createTextField(options),"), "t.ts");
    expect(sites).toHaveLength(0);
  });

  it("reports a bare createTextField() call with no arguments", () => {
    const sites = reportStanceForSource(wrapField("stepKey: createTextField(),"), "t.ts");
    expect(sites).toHaveLength(1);
    expect(sites[0]?.stance).toBe("unclassified");
    expect(sites[0]?.hint).toBeUndefined();
    expect(sites[0]?.field).toBe("stepKey");
  });

  it("falls back to a synthetic field name and stays unclassified when there is no enclosing PropertyAssignment", () => {
    const source = `
const x = [createTextField({})];
`;
    const sites = reportStanceForSource(source, "t.ts");
    expect(sites).toHaveLength(1);
    expect(sites[0]?.field).toBe("createTextField(...)");
    expect(sites[0]?.stance).toBe("unclassified");
    expect(sites[0]?.hint).toBeUndefined();
  });

  it("resolves the entity from createEntity's table property", () => {
    const [site] = reportStanceForSource(wrapField("email: createTextField({}),"), "t.ts");
    expect(site?.entity).toBe("entity_table");
  });

  it("falls back to the enclosing variable name when createEntity has no table property", () => {
    const source = `
const fields = createEntity({
  fields: {
    email: createTextField({}),
  },
});
`;
    const [site] = reportStanceForSource(source, "t.ts");
    expect(site?.entity).toBe("fields");
  });

  it("resolves entity to null when the call is not inside a createEntity call", () => {
    const source = `
const standalone = { email: createTextField({}) };
`;
    const [site] = reportStanceForSource(source, "t.ts");
    expect(site?.entity).toBeNull();
  });

  it("captures createLongTextField the same way as createTextField", () => {
    const [site] = reportStanceForSource(
      wrapField("description: createLongTextField({}),"),
      "t.ts",
    );
    expect(site?.callee).toBe("createLongTextField");
    expect(site?.stance).toBe("user-owned");
    expect(site?.hint).toBe("description");
  });
});
