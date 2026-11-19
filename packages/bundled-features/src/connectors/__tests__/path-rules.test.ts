import { describe, expect, test } from "bun:test";
import { MAX_FOLDER_DEPTH, MAX_FOLDER_NAME_LENGTH } from "../constants.ts";
import { exceedsFolderLimits, isBallastPath } from "../path-rules.ts";

describe("isBallastPath", () => {
  test.each([
    "$RECYCLE.BIN/S-1-5-21/x.pdf",
    "Rechnungen/System Volume Information/tracking.log",
    "Lieferscheine/Thumbs.db",
    "desktop.ini",
    "Fotos/.DS_Store",
    "pagefile.sys",
    "hiberfil.sys",
    "Swapfile.SYS",
    "Rechnungen/~$Angebot.docx",
  ])("rejects %s", (path) => {
    expect(isBallastPath(path)).toBe(true);
  });

  test.each([
    "Rechnungen/2026/Meier GmbH.pdf",
    "Lieferscheine/LS-0042.pdf",
    "notes~$.txt",
    "thumbs.db.pdf",
    "my pagefile.sys.txt",
  ])("accepts %s", (path) => {
    expect(isBallastPath(path)).toBe(false);
  });
});

describe("exceedsFolderLimits", () => {
  test("accepts a normal path and rejects too deep or too long names", () => {
    expect(exceedsFolderLimits("Rechnungen/2026/a.pdf")).toBe(false);
    expect(exceedsFolderLimits(`${"d/".repeat(MAX_FOLDER_DEPTH)}a.pdf`)).toBe(false);
    expect(exceedsFolderLimits(`${"d/".repeat(MAX_FOLDER_DEPTH + 1)}a.pdf`)).toBe(true);
    expect(exceedsFolderLimits(`${"x".repeat(MAX_FOLDER_NAME_LENGTH + 1)}/a.pdf`)).toBe(true);
  });
});
