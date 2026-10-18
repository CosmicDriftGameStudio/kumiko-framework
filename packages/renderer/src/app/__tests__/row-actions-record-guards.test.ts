import { describe, expect, test } from "bun:test";
import type { RelatedListToolbarAction, RowAction } from "@cosmicdrift/kumiko-framework/ui-types";
import { stubDispatcher } from "../../__tests__/stub-dispatcher.ts";
import { compactHeaderPrimary, primaryHeaderAction } from "../header-actions.ts";
import type { NavApi } from "../nav.tsx";
import { buildProjectionToolbarActions, buildRecordActions } from "../row-actions.ts";

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

describe("declared primaryAction hidden by its visible condition", () => {
  const actions: readonly RowAction[] = [
    { id: "edit", label: "edit", icon: "pencil", handler: "shop:write:order:edit" },
    {
      id: "terminate",
      label: "terminate",
      icon: "x",
      style: "primary",
      confirm: "sure?",
      handler: "shop:write:order:terminate",
      visible: { field: "status", eq: "active" },
    },
  ];

  function headerFor(status: string) {
    return buildRecordActions({
      actions,
      record: { id: "rec-1", status },
      translate: (key) => key,
      nav,
      host: undefined,
      dispatcher: stubDispatcher().dispatcher,
      openDrawer: () => {},
      onWriteSuccess: async () => {},
    });
  }

  test("a visible primaryAction leads the desktop and phone header", () => {
    const visible = headerFor("active") ?? [];
    expect(primaryHeaderAction(visible, "terminate")?.id).toBe("terminate");
    expect(compactHeaderPrimary(visible, "terminate")?.action.id).toBe("terminate");
  });

  test("an invisible primaryAction makes edit the main button on desktop and phone", () => {
    const hidden = headerFor("terminated") ?? [];
    expect(hidden.map((a) => a.id)).toEqual(["edit"]);
    expect(primaryHeaderAction(hidden, "terminate")?.id).toBe("edit");
    const [edit] = hidden;
    if (edit === undefined) throw new Error("edit action missing");
    expect(compactHeaderPrimary(hidden, "terminate")).toEqual({ action: edit, iconOnly: true });
  });
});
