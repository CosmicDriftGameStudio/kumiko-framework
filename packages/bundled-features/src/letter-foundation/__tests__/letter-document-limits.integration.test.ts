// The size and page limits of a letter stop the work early: before any file is read, before any page is copied.

import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { PDFDocument } from "pdf-lib";
import { letterSimulator } from "../../letter-provider-inmemory/simulator.ts";
import { LetterHandlers, LetterI18n } from "../constants.ts";
import { APPROVER, createLetterHarness } from "./letter-harness.ts";

const harness = createLetterHarness();
const { letterInput, pdfBytes, seedDocument, send } = harness;
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

const SIMULATOR_MAX_BYTES = 10 * 1024 * 1024;

describe("document limits", () => {
  test("stored sizes over the limit stop approval before any file is read", async () => {
    const half = new Uint8Array(Math.floor(SIMULATOR_MAX_BYTES * 0.6));
    const fileRefIds = [await seedDocument(half), await seedDocument(half)];
    const { letterId } = await send(await letterInput({ fileRefIds }));
    const reads = spyOn(harness.fileProvider, "read");

    const error = await stack.http.writeErr(LetterHandlers.approve, { letterId }, APPROVER);

    expect(error.i18nKey).toBe(LetterI18n.documentRejected);
    expect(reads).not.toHaveBeenCalled();
    reads.mockRestore();
  });

  test("a source with too many pages stops the merge before its pages are copied", async () => {
    letterSimulator.setCapabilities({ maxSheets: 1 });
    const copyPages = spyOn(PDFDocument.prototype, "copyPages");
    const { letterId } = await send(
      await letterInput({ fileRefIds: [await seedDocument(await pdfBytes(5))] }),
    );

    const error = await stack.http.writeErr(LetterHandlers.approve, { letterId }, APPROVER);

    expect(error.i18nKey).toBe(LetterI18n.tooManySheets);
    expect(copyPages).not.toHaveBeenCalled();
    copyPages.mockRestore();
  });
});
