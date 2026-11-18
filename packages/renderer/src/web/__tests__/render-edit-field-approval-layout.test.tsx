// The field-approval drawer and hints with the real web primitives: label/control pairing,
// cell widths and the wrapping hint row only exist in the web DOM, not in the stub primitives.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  FeatureSchema,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { fireEvent, screen as rtlScreen, waitFor, within } from "@testing-library/react";
import { AppFeaturesProvider } from "../../app/app-features-context.tsx";
import { type ActionNotice, ActionNoticeProvider } from "../../app/client-actions.tsx";
import { RenderEdit } from "../../components/render-edit.tsx";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import { createMockDispatcher, render } from "./test-utils.tsx";

type Values = { name: string; iban: string; bic: string };

const NEW_IBAN = "DE89370400440532013000";
const PENDING_CHANGES = "field-approval:query:pending-changes";
const DRAWER = "render-edit-field-approval-drawer";

const entity: EntityDefinition = {
  name: "contact",
  fields: {
    name: { type: "text", allowPlaintext: "test fixture", maxLength: 64 },
    iban: { type: "text", allowPlaintext: "test fixture", maxLength: 34 },
    bic: { type: "text", allowPlaintext: "test fixture", maxLength: 11 },
  },
};

const editScreen: EntityEditScreenDefinition = {
  id: "contact-edit",
  type: "entityEdit",
  entity: "contact",
  layout: { sections: [{ title: "Main", fields: ["name", "iban", "bic"] }] },
};

const fieldApprovalSchema: FeatureSchema = {
  featureName: "field-approval",
  entities: {},
  screens: [],
};

type OpenRequest = {
  readonly id: string;
  readonly version: number;
  readonly fieldName: string;
  readonly value?: unknown;
  readonly filedByCaller?: boolean;
};

function renderContactEdit(
  setup: { readonly gatedFields?: readonly string[]; readonly openRequests?: OpenRequest[] } = {},
): { readonly notices: ActionNotice[] } {
  const notices: ActionNotice[] = [];
  const openRequests = setup.openRequests ?? [];
  const dispatcher = createMockDispatcher({
    query: (type) => ({
      isSuccess: true,
      data:
        type === PENDING_CHANGES
          ? { rows: openRequests, gatedFields: setup.gatedFields ?? [] }
          : {},
    }),
    write: () => ({ isSuccess: true, data: { id: "c1" } }),
    batch: (commands) => {
      for (const command of commands) {
        const payload = command.payload as { fieldName: string; value: unknown };
        openRequests.push({
          id: `fcr-${payload.fieldName}`,
          version: 1,
          fieldName: payload.fieldName,
          value: payload.value,
          filedByCaller: true,
        });
      }
      return { isSuccess: true, results: [] };
    },
  });
  render(
    <AppFeaturesProvider features={[fieldApprovalSchema]}>
      <DispatcherProvider dispatcher={dispatcher}>
        <ActionNoticeProvider notify={(notice) => notices.push(notice)}>
          <RenderEdit<Values>
            screen={editScreen}
            entity={entity}
            featureName="contacts"
            entityId="c1"
            writeCommand="contacts:write:contact:update"
            payloadMode="changes"
            fillScreenHeight
            initial={{ name: "Owner", iban: "DE02120300000000202051", bic: "BYLADEM1001" }}
          />
        </ActionNoticeProvider>
      </DispatcherProvider>
    </AppFeaturesProvider>,
  );
  return { notices };
}

async function openDrawer(): Promise<HTMLElement> {
  fireEvent.click(await rtlScreen.findByTestId("field-approval-request-iban"));
  return rtlScreen.findByTestId(DRAWER);
}

function fieldCell(fieldName: string): HTMLElement {
  const cell = rtlScreen.getByTestId(`field-${fieldName}`).parentElement;
  if (cell === null) throw new Error(`no grid cell around ${fieldName}`);
  return cell;
}

describe("field approval with the web primitives", () => {
  test("a label in the drawer names the drawer's editable field, not the locked one behind it", async () => {
    renderContactEdit({ gatedFields: ["iban"] });
    const drawer = await openDrawer();

    const drawerIban = within(drawer).getByLabelText(/iban/i) as HTMLInputElement;
    expect(drawer.contains(drawerIban)).toBe(true);
    expect(drawerIban.disabled).toBe(false);
    const ids = Array.from(document.querySelectorAll("[id]"), (element) => element.id);
    expect(ids.filter((id) => id === drawerIban.id)).toHaveLength(1);
  });

  test("a field locked by the approval keeps the cell of its editable neighbour", async () => {
    renderContactEdit({ gatedFields: ["iban"] });
    await rtlScreen.findByTestId("field-approval-request-iban");

    expect(fieldCell("iban").className).toBe(fieldCell("name").className);
  });

  test("the pending hint and the withdraw link wrap as one row with a gap", async () => {
    renderContactEdit({
      gatedFields: ["iban"],
      openRequests: [
        { id: "fcr-1", version: 1, fieldName: "iban", value: NEW_IBAN, filedByCaller: true },
      ],
    });
    const withdraw = await rtlScreen.findByTestId("field-approval-withdraw-iban");
    const hint = rtlScreen.getByTestId("field-approval-pending-iban");

    const row = withdraw.parentElement;
    expect(row?.contains(hint)).toBe(true);
    expect(row?.className.split(" ")).toEqual(expect.arrayContaining(["flex", "flex-wrap"]));
    expect(row?.className).toMatch(/\bgap-/);
  });

  test("a filed request answers at the field as a status, without a toast", async () => {
    const { notices } = renderContactEdit({ gatedFields: ["iban"] });
    const drawer = await openDrawer();
    fireEvent.change(within(drawer).getByLabelText(/iban/i), { target: { value: NEW_IBAN } });
    fireEvent.click(within(drawer).getByTestId("render-edit-submit"));

    await waitFor(() => expect(rtlScreen.queryByTestId(DRAWER)).toBeNull());
    const status = await rtlScreen.findByRole("status");
    expect(status.textContent).toBe(`Requested: ${NEW_IBAN} · awaiting approval`);
    expect(rtlScreen.getByTestId("field-iban").contains(status)).toBe(true);
    expect(notices).toEqual([]);
  });
});
