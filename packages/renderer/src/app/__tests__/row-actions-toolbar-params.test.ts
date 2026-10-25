import { describe, expect, test } from "bun:test";
import type { RelatedListToolbarAction } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import type { NavApi } from "../nav.tsx";
import { buildProjectionToolbarActions } from "../row-actions.ts";

const nav: NavApi = {
  route: undefined,
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "",
  searchParams: {},
  setSearchParams: () => {},
};

const parentRecord = { id: "p1", name: "Akte 7", status: "open" };

const drawerAction: RelatedListToolbarAction = {
  kind: "drawer",
  id: "add-note",
  label: "actions.addNote",
  screen: "note-form",
  params: { map: { caseName: "name" } },
};

const writeAction: RelatedListToolbarAction = {
  kind: "writeHandler",
  id: "close-case",
  label: "actions.closeCase",
  handler: "cases:write:case:close",
  payload: { reason: "manual", caseId: "static" },
  params: { map: { caseId: "id" } },
};

type WriteCall = { type: string; payload: unknown };

function recordingDispatcher(): { dispatcher: Dispatcher; writes: WriteCall[] } {
  const writes: WriteCall[] = [];
  const dispatcher = {
    write: async (type: string, payload: unknown) => {
      writes.push({ type, payload });
      return { isSuccess: true, data: {} };
    },
  } as unknown as Dispatcher;
  return { dispatcher, writes };
}

function build(
  toolbarActions: readonly RelatedListToolbarAction[],
  extra: {
    record?: Readonly<Record<string, unknown>>;
    dispatcher?: Dispatcher;
    openDrawer?: Parameters<typeof buildProjectionToolbarActions>[0]["openDrawer"];
  },
) {
  return buildProjectionToolbarActions({
    toolbarActions,
    translate: (key) => key,
    dispatcher: extra.dispatcher,
    nav,
    refetch: async () => {},
    host: undefined,
    ...(extra.record !== undefined && { record: extra.record }),
    ...(extra.openDrawer !== undefined && { openDrawer: extra.openDrawer }),
  });
}

describe("relatedList toolbar params on drawer and writeHandler", () => {
  test("drawer opens with the values extracted from the parent record as prefill", () => {
    const opened: Array<{ id: string; initialValues: unknown }> = [];
    const actions = build([drawerAction], {
      record: parentRecord,
      openDrawer: (action, initialValues) => opened.push({ id: action.id, initialValues }),
    });
    actions?.[0]?.onTrigger();

    expect(opened).toEqual([{ id: "add-note", initialValues: { caseName: "Akte 7" } }]);
  });

  test("writeHandler sends the static payload overlaid with the extracted params", async () => {
    const { dispatcher, writes } = recordingDispatcher();
    const actions = build([writeAction], { record: parentRecord, dispatcher });
    await actions?.[0]?.onTrigger();

    expect(writes).toEqual([
      { type: "cases:write:case:close", payload: { reason: "manual", caseId: "p1" } },
    ]);
  });

  test("a writeHandler without params keeps sending its static payload only", async () => {
    const { dispatcher, writes } = recordingDispatcher();
    const { params: _params, ...withoutParams } = writeAction as RelatedListToolbarAction & {
      kind: "writeHandler";
    };
    const actions = build([withoutParams], { record: parentRecord, dispatcher });
    await actions?.[0]?.onTrigger();

    expect(writes[0]?.payload).toEqual({ reason: "manual", caseId: "static" });
  });

  test("both kinds stay hidden when params are set but there is no parent record", () => {
    const { dispatcher } = recordingDispatcher();
    const actions = build([drawerAction, writeAction], {
      dispatcher,
      openDrawer: () => {},
    });

    expect(actions).toBeUndefined();
  });
});
