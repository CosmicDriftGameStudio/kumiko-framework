import { isGermanComment } from "../guard-comment-lang";

// German words that essentially never occur in an English test title. Words that are also
// English (die, was, am, an, in, so, man, also, will, bin, war, hat, all) are left out on purpose.
const GERMAN_TITLE_WORDS: ReadonlySet<string> = new Set([
  "der",
  "das",
  "den",
  "dem",
  "des",
  "ein",
  "eine",
  "einen",
  "einem",
  "kann",
  "wird",
  "werden",
  "nicht",
  "wenn",
  "oder",
  "und",
  "mit",
  "ohne",
  "bei",
  "ist",
  "sind",
  "auf",
  "zu",
  "von",
  "vom",
  "zum",
  "zur",
  "im",
  "vor",
  "aus",
  "als",
  "sich",
  "wie",
  "auch",
  "noch",
  "nur",
  "kein",
  "keine",
  "keinen",
  "gibt",
  "darf",
  "muss",
  "soll",
  "liefert",
  "wirft",
  "setzt",
  "zeigt",
  "gewinnt",
  "leer",
  "leere",
  "leerer",
  "bleibt",
  "macht",
  "fehlt",
  "schreibt",
  "liest",
  "sammelt",
  "nennt",
  "akzeptiert",
  "ueber",
  "uber",
  "fuer",
  "gegen",
  "nach",
  "dann",
  "weil",
  "statt",
  "sowie",
  "jede",
  "jeder",
  "jedes",
]);

const QUOTED_OR_CODE_RE = /`[^`]*`|"[^"]*"|'[^']*'/g;
const WORD_RE = /[\p{L}]+/gu;

function isUpperCaseAcronym(word: string): boolean {
  return word.length > 1 && word === word.toUpperCase();
}

// Test titles are short, so one unambiguous German word is enough, unlike comments which
// need an umlaut or two markers. Quoted text and code in backticks are fixture or identifier names.
export function isGermanTestTitle(title: string): boolean {
  if (isGermanComment(title)) return true;
  const prose = title.replace(QUOTED_OR_CODE_RE, " ");
  return (prose.match(WORD_RE) ?? []).some(
    (word) => !isUpperCaseAcronym(word) && GERMAN_TITLE_WORDS.has(word.toLowerCase()),
  );
}
