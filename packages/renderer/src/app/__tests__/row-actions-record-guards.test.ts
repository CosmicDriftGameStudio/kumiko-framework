import { describe, expect, test } from "bun:test";
import type { RelatedListToolbarAction, RowAction } from "@cosmicdrift/kumiko-framework/ui-types";
import { stubDispatcher } from "../../__tests__/stub-dispatcher.js";
import type { NavApi } from "../nav.js";
import { buildProjectionToolbarActions, buildRecordActions } from "../row-actions.js";

const nav: NavApi = {
  route: undefined,
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "",
  searchParams: {},
  setSearchParams: () => {},
};

describe("buildRecordActions default write payload", () => {
  const archive: RowAction = {
    id: "archive",
    label: "archive",
    handler: "shop:write:order:archive",
  };

  async function pressArchive(
    record: Record<string, unknown>,
    defaultWritePayloadId?: string,
  ): Promise<unknown> {
    const { dispatcher, writes } = stubDispatcher();
    const actions = buildRecordActions({
      actions: [archive],
      record,
      translate: (key) => key,
      nav,
      host: undefined,
      dispatcher,
      openDrawer: () => {},
      onWriteSuccess: async () => {},
      ...(defaultWritePayloadId !== undefined && { defaultWritePayloadId }),
    });
    await actions?.[0]?.onPress();
    return writes[0]?.payload;
  }

  test("uses the caller's entity id when the record carries no id field", async () => {
    expect(await pressArchive({ name: "x" }, "route-id")).toEqual({ id: "route-id" });
  });

  test("falls back to the record id without a caller-supplied id", async () => {
    expect(await pressArchive({ id: "rec-1" })).toEqual({ id: "rec-1" });
  });
});

describe("buildProjectionToolbarActions conditional visibility", () => {
  const conditional: RelatedListToolbarAction = {
    kind: "navigate",
    id: "open",
    label: "open",
    screen: "detail",
    visible: { field: "status", eq: "open" },
  };

  function build(record: Record<string, unknown> | undefined) {
    return buildProjectionToolbarActions({
      toolbarActions: [conditional],
      translate: (key) => key,
      dispatcher: undefined,
      nav,
      refetch: async () => {},
      host: undefined,
      ...(record !== undefined && { record }),
    });
  }

  test("is hidden when no record is available to evaluate against", () => {
    expect(build(undefined)).toBeUndefined();
  });

  test("follows the condition when a record is supplied", () => {
    expect(build({ status: "open" })).toHaveLength(1);
    expect(build({ status: "closed" })).toBeUndefined();
  });
});
