import { describe, expect, test } from "bun:test";
import { splitQuotedText } from "../quoted-text.ts";

describe("splitQuotedText", () => {
  test("folds a German attribution line and everything after it", () => {
    const text = [
      "Der Monteur kommt am Dienstag.",
      "",
      "Am 12.03.2026 um 08:14 schrieb Anna Schneider <a.schneider@mieter.test>:",
      "> Seit gestern ist meine Heizung kalt.",
      "> Bitte um schnelle Hilfe.",
    ].join("\n");
    const split = splitQuotedText(text);
    expect(split.main).toBe("Der Monteur kommt am Dienstag.");
    expect(split.quoted).toContain("schrieb Anna Schneider");
    expect(split.quotedLineCount).toBe(3);
  });

  test("folds an English attribution line", () => {
    const split = splitQuotedText(
      "Thanks, will do.\n\nOn Mon, Mar 12, 2026 at 8:14 AM Anna Schneider <a@mieter.test> wrote:\nHeating is cold.",
    );
    expect(split.main).toBe("Thanks, will do.");
    expect(split.quotedLineCount).toBe(2);
  });

  test("folds from an Original Message rule in both languages", () => {
    const english = splitQuotedText("Done.\n-----Original Message-----\nFrom: Anna\nHeating");
    expect(english.main).toBe("Done.");
    expect(english.quotedLineCount).toBe(3);
    const german = splitQuotedText("Erledigt.\n-----Ursprüngliche Nachricht-----\nVon: Anna");
    expect(german.main).toBe("Erledigt.");
    expect(german.quoted).toContain("Von: Anna");
  });

  test("folds a trailing block of > lines", () => {
    const split = splitQuotedText("Ja, passt.\n> Passt Dienstag?\n> Gruß Anna\n");
    expect(split.main).toBe("Ja, passt.");
    expect(split.quoted).toBe("> Passt Dienstag?\n> Gruß Anna");
    expect(split.quotedLineCount).toBe(2);
  });

  test("keeps inline > replies that are followed by more text", () => {
    const text = "> Passt Dienstag?\nJa.\nBis dann.";
    expect(splitQuotedText(text)).toEqual({ main: text, quoted: null, quotedLineCount: 0 });
  });

  test("returns plain text unchanged", () => {
    const text = "Guten Tag,\nder Monteur ist nicht gekommen.";
    expect(splitQuotedText(text)).toEqual({ main: text, quoted: null, quotedLineCount: 0 });
  });

  test("a mail that is only quote stays visible", () => {
    const text = "> alles zitiert\n> noch eine Zeile";
    expect(splitQuotedText(text).quoted).toBeNull();
  });
});
