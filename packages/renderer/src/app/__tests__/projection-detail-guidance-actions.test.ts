import { describe, expect, test } from "bun:test";
import type { RowAction } from "@cosmicdrift/kumiko-framework/ui-types";
import { omitActionsDefaultingToShownRecordId } from "../use-projection-detail-actions.ts";

const bareWrite: RowAction = { id: "remind", label: "demo:remind", handler: "demo:write:remind" };
const bareClient: RowAction = { kind: "clientAction", id: "copy", label: "demo:copy", action: "x" };
const payloadWrite: RowAction = {
  id: "skip",
  label: "demo:skip",
  handler: "demo:write:skip",
  payload: { pick: ["id"] },
};
const navigate: RowAction = {
  kind: "navigate",
  id: "open",
  label: "demo:open",
  screen: "demo:detail",
};

describe("omitActionsDefaultingToShownRecordId", () => {
  test("without a shown record id, payload-less write and client actions are dropped", () => {
    const kept = omitActionsDefaultingToShownRecordId(
      [bareWrite, bareClient, payloadWrite, navigate],
      undefined,
    );
    expect(kept.map((action) => action.id)).toEqual(["skip", "open"]);
  });

  test("with a shown record id every action stays", () => {
    const all = [bareWrite, bareClient, payloadWrite, navigate];
    expect(omitActionsDefaultingToShownRecordId(all, "rec-1")).toEqual(all);
  });
});
