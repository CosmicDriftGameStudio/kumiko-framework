// Real stack over HTTP. A probe feature stands in for the app that calls `sendLetter`; the inmemory
// provider is steered through `letterSimulator`. The handover and poll jobs have their own file.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { seedConfigValues, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTenantDb } from "@cosmicdrift/kumiko-testing/helpers";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { ConfigHandlers, configValueEntity, configValuesTable } from "../../config/index.ts";
import { letterSimulator } from "../../letter-provider-inmemory/simulator.ts";
import { LETTER_STATE, LetterHandlers, LetterI18n, LetterQueries } from "../constants.ts";
import { letterTable } from "../entity.ts";
import {
  APPROVER,
  CLERK,
  createLetterHarness,
  LETTER_SIZE as LETTER,
  LIMIT_KEY,
  SEND,
  SYSTEM_ADMIN,
} from "./letter-harness.ts";

const harness = createLetterHarness();
const { letterInput, letterRow, pdfBytes, seedDocument, send, setLimit } = harness;
let stack: TestStack;

beforeAll(async () => {
  stack = await harness.setup();
});

afterAll(async () => {
  await harness.cleanup();
});

beforeEach(async () => {
  await harness.reset();
});

describe("sendLetter and approval", () => {
  test("creates a letter awaiting approval; the same key returns the same letter", async () => {
    const input = await letterInput();
    const first = await send(input);
    const second = await send(input);
    expect(first.created).toBe(true);
    expect(second).toEqual({ letterId: first.letterId, created: false });
    expect((await letterRow(first.letterId))?.["status"]).toBe(LETTER_STATE.awaitingApproval);
    expect(letterSimulator.calls.submit).toBe(0);
  });

  test("approving needs the approver right", async () => {
    const { letterId } = await send(await letterInput());
    const denied = await stack.http.raw("POST", "/api/write", {
      type: LetterHandlers.approve,
      payload: { letterId },
    });
    expect(denied.status).toBeGreaterThanOrEqual(400);
    const asClerk = await stack.http.writeErr(LetterHandlers.approve, { letterId }, CLERK);
    expect(asClerk.httpStatus).toBe(403);
    expect((await letterRow(letterId))?.["status"]).toBe(LETTER_STATE.awaitingApproval);
  });

  test("approval stores price, sheet count and the document hash", async () => {
    await setLimit(100_000);
    const { letterId } = await send(await letterInput());
    await stack.http.writeOk(LetterHandlers.approve, { letterId }, APPROVER);
    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.approved);
    expect(row?.["pageCount"]).toBe(3);
    expect(row?.["sheetCount"]).toBe(2);
    expect(Number(row?.["quotedNet"])).toBe(85 + 2 * 12);
    expect(row?.["quotedNetCurrency"]).toBe("EUR");
    expect(row?.["priceSource"]).toBe("simulated");
    expect(String(row?.["documentSha256"])).toMatch(/^[0-9a-f]{64}$/);
    expect(letterSimulator.calls.submit).toBe(0);
  });

  test("the preview shows the price and the monthly limit hint", async () => {
    const { letterId } = await send(await letterInput());
    const preview = await stack.http.queryOk<{
      totalNet: { amount: number };
      sheetCount: number;
      fitsLimit: boolean;
      hint?: string;
    }>(LetterQueries.preview, { letterId }, APPROVER);
    expect(preview.totalNet.amount).toBe(109);
    expect(preview.sheetCount).toBe(2);
    expect(preview.fitsLimit).toBe(false);
    expect(preview.hint).toBeDefined();
  });
});

describe("approval and the monthly limit", () => {
  test("approval is refused without a limit and the letter keeps waiting", async () => {
    const { letterId } = await send(await letterInput());
    const refused = await stack.http.writeErr(LetterHandlers.approve, { letterId }, APPROVER);
    expect(refused.httpStatus).toBe(422);
    expect(refused.i18nKey).toBe(LetterI18n.monthlyLimitNotCovered);
    expect((await letterRow(letterId))?.["status"]).toBe(LETTER_STATE.awaitingApproval);
  });

  test("an approved letter that is not handed over yet uses up the limit for the next one", async () => {
    await setLimit(150);
    const first = await send(await letterInput());
    const second = await send(await letterInput());
    await stack.http.writeOk(LetterHandlers.approve, { letterId: first.letterId }, APPROVER);

    const refused = await stack.http.writeErr(
      LetterHandlers.approve,
      { letterId: second.letterId },
      APPROVER,
    );
    expect(refused.i18nKey).toBe(LetterI18n.monthlyLimitNotCovered);
    expect((await letterRow(second.letterId))?.["status"]).toBe(LETTER_STATE.awaitingApproval);
    const preview = await stack.http.queryOk<{ usedCents: number; fitsLimit: boolean }>(
      LetterQueries.preview,
      { letterId: second.letterId },
      APPROVER,
    );
    expect(preview.fitsLimit).toBe(false);
    expect(preview.usedCents).toBe(109);

    await setLimit(300);
    await stack.http.writeOk(LetterHandlers.approve, { letterId: second.letterId }, APPROVER);
    expect((await letterRow(second.letterId))?.["status"]).toBe(LETTER_STATE.approved);
  });

  test("the preview of an approved letter does not count the letter itself", async () => {
    await setLimit(150);
    const { letterId } = await send(await letterInput());
    await stack.http.writeOk(LetterHandlers.approve, { letterId }, APPROVER);
    const preview = await stack.http.queryOk<{ usedCents: number; fitsLimit: boolean }>(
      LetterQueries.preview,
      { letterId },
      APPROVER,
    );
    expect(preview.usedCents).toBe(0);
    expect(preview.fitsLimit).toBe(true);
  });
});

describe("preview of a flat envelope", () => {
  test("says the provider chooses the envelope above its flat limit", async () => {
    const { letterId } = await send(await letterInput({ envelope: "flat" }));
    const preview = () =>
      stack.http.queryOk<{ envelopeLeftToProvider: boolean }>(
        LetterQueries.preview,
        { letterId },
        APPROVER,
      );
    expect((await preview()).envelopeLeftToProvider).toBe(false);
    letterSimulator.setCapabilities({ maxFlatSheets: 1 });
    expect((await preview()).envelopeLeftToProvider).toBe(true);
  });

  test("a folded letter is never left to the provider", async () => {
    letterSimulator.setCapabilities({ maxFlatSheets: 1 });
    const { letterId } = await send(await letterInput({ envelope: "folded" }));
    const preview = await stack.http.queryOk<{ envelopeLeftToProvider: boolean }>(
      LetterQueries.preview,
      { letterId },
      APPROVER,
    );
    expect(preview.envelopeLeftToProvider).toBe(false);
  });
});

describe("rejections with a readable reason", () => {
  test("schriftform is not sendable", async () => {
    const error = await stack.http.writeErr(
      SEND,
      await letterInput({ formRequirement: "schriftform" }),
      CLERK,
    );
    expect(error.httpStatus).toBe(422);
    expect(error.i18nKey).toContain("schriftform");
  });

  test("a shipping mode outside the provider capabilities", async () => {
    letterSimulator.setCapabilities({ shippingModes: ["standard"] });
    const error = await stack.http.writeErr(
      SEND,
      await letterInput({ shippingMode: "rueckschein" }),
      CLERK,
    );
    expect(error.httpStatus).toBe(422);
    expect(error.i18nKey).toContain("shippingModeUnsupported");
  });

  test("too many sheets and a non-A4 document fail at approval", async () => {
    letterSimulator.setCapabilities({ maxSheets: 1 });
    const tooLong = await send(await letterInput());
    const sheets = await stack.http.writeErr(
      LetterHandlers.approve,
      { letterId: tooLong.letterId },
      APPROVER,
    );
    expect(sheets.i18nKey).toContain("tooManySheets");

    letterSimulator.reset();
    const letter = await send(
      await letterInput({ fileRefIds: [await seedDocument(await pdfBytes(1, LETTER))] }),
    );
    const format = await stack.http.writeErr(
      LetterHandlers.approve,
      { letterId: letter.letterId },
      APPROVER,
    );
    expect(format.i18nKey).toContain("documentRejected");
    expect((await letterRow(letter.letterId))?.["status"]).toBe(LETTER_STATE.awaitingApproval);
  });
});

describe("the written form", () => {
  test("a schriftform letter is accepted once the risk is acknowledged and the preview says so", async () => {
    const { letterId } = await send(
      await letterInput({ formRequirement: "schriftform", formRiskAcknowledged: true }),
    );
    const row = await letterRow(letterId);
    expect(row?.["formRequirement"]).toBe("schriftform");
    expect(row?.["formRiskAcknowledged"]).toBe(true);

    const preview = await stack.http.queryOk<{
      formRequirement: string;
      formRiskAcknowledged: boolean;
    }>(LetterQueries.preview, { letterId }, APPROVER);
    expect(preview.formRequirement).toBe("schriftform");
    expect(preview.formRiskAcknowledged).toBe(true);
  });

  test("a letter without a form requirement stores no acknowledgement", async () => {
    const { letterId } = await send(await letterInput());
    expect((await letterRow(letterId))?.["formRiskAcknowledged"]).toBe(false);
  });
});

describe("the letters of one source record", () => {
  test("the list filters by source type and id", async () => {
    const source = { entityType: "statement", entityId: "statement-7" };
    const first = await send(await letterInput({ source }));
    const second = await send(await letterInput({ source }));
    await send(await letterInput());
    const { rows } = await stack.http.queryOk<{ rows: readonly { id: string }[] }>(
      LetterQueries.list,
      {
        filters: [
          { field: "sourceEntityType", op: "eq", value: source.entityType },
          { field: "sourceEntityId", op: "eq", value: source.entityId },
        ],
      },
      APPROVER,
    );
    expect(rows.map((row) => row.id).sort()).toEqual([first.letterId, second.letterId].sort());
  });
});

describe("the envelope", () => {
  test("a flat letter is stored; the default is folded", async () => {
    const flat = await send(await letterInput({ envelope: "flat" }));
    const folded = await send(await letterInput());
    expect((await letterRow(flat.letterId))?.["envelope"]).toBe("flat");
    expect((await letterRow(folded.letterId))?.["envelope"]).toBe("folded");
  });

  test("a provider without the flat envelope refuses it with its own code", async () => {
    letterSimulator.setCapabilities({ envelopes: ["folded"] });
    const error = await stack.http.writeErr(SEND, await letterInput({ envelope: "flat" }), CLERK);
    expect(error.httpStatus).toBe(422);
    expect(error.i18nKey).toBe(LetterI18n.envelopeUnsupported);
  });
});

describe("parallel sendLetter calls", () => {
  test("two calls with the same key end in one letter and the same id", async () => {
    const input = await letterInput();
    const [first, second] = await Promise.all([send(input), send(input)]);
    expect(second.letterId).toBe(first.letterId);
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
    const rows = await selectMany<Record<string, unknown>>(
      createTenantDb({
        db: stack.db,
        tenantId: CLERK.tenantId,
        mode: "system",
        reason: "test counts the letters of one idempotency key",
      }),
      letterTable,
      { idempotencyKey: input.idempotencyKey },
    );
    expect(rows).toHaveLength(1);
  });
});

describe("cancel and config", () => {
  test("canceling before handover does not call the provider", async () => {
    const { letterId } = await send(await letterInput());
    await stack.http.writeOk(LetterHandlers.cancel, { letterId }, CLERK);
    expect((await letterRow(letterId))?.["status"]).toBe(LETTER_STATE.canceled);
    expect(letterSimulator.calls.cancel).toBe(0);
    expect(letterSimulator.calls.submit).toBe(0);
  });

  test("a system row applies to a tenant without a value; a tenant admin cannot write the key", async () => {
    const seed = [{ key: LIMIT_KEY, value: 500 }];
    await seedConfigValues(seed, configValuesTable, configValueEntity, stack.registry, stack.db);
    const { letterId } = await send(await letterInput());
    const preview = await stack.http.queryOk<{ limitCents: number; fitsLimit: boolean }>(
      LetterQueries.preview,
      { letterId },
      APPROVER,
    );
    expect(preview.limitCents).toBe(500);
    expect(preview.fitsLimit).toBe(true);

    const denied = await stack.http.writeErr(
      ConfigHandlers.set,
      { key: LIMIT_KEY, value: 99999, scope: "tenant" },
      CLERK,
    );
    expect(denied.httpStatus).toBe(403);
  });

  test("a SystemAdmin sets the system row and a tenant row of the limit", async () => {
    const { letterId } = await send(await letterInput());
    const limitOf = async () =>
      (
        await stack.http.queryOk<{ limitCents: number }>(
          LetterQueries.preview,
          { letterId },
          APPROVER,
        )
      ).limitCents;

    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: LIMIT_KEY, value: 700, scope: "system" },
      SYSTEM_ADMIN,
    );
    expect(await limitOf()).toBe(700);

    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: LIMIT_KEY, value: 1200, scope: "tenant" },
      SYSTEM_ADMIN,
    );
    expect(await limitOf()).toBe(1200);
  });
});

describe("personal data", () => {
  test("no event carries the address or the recipient name in plaintext", async () => {
    await setLimit(100_000);
    const { letterId } = await send(await letterInput());
    await stack.http.writeOk(LetterHandlers.approve, { letterId }, APPROVER);
    const events = await selectMany<Record<string, unknown>>(stack.db, eventsTable, {});
    expect(events.length).toBeGreaterThan(0);
    const dump = JSON.stringify(events, (_key, value) =>
      typeof value === "bigint" ? String(value) : value,
    );
    for (const secret of ["Erika", "Mustermann", "Musterstraße", "Musterstadt", "12345"]) {
      expect(dump).not.toContain(secret);
    }
  });
});

describe("boot", () => {
  test("approve is an outbound agent write and the boot accepted it", () => {
    const handler = stack.registry.getWriteHandler(LetterHandlers.approve);
    expect(handler?.agent?.effect).toBe("outbound");
  });
});
