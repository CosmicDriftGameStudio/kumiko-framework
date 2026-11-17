// Verb table of the registrar-single-form codemod. Each positional signature maps its arguments
// to the pieces of the options object, in this order.

export type VerbPiece =
  | { readonly kind: "field"; readonly name: string; readonly arg: number }
  // An options argument: a literal contributes its properties, anything else is spread.
  | { readonly kind: "options"; readonly arg: number };

export interface VerbSpec {
  readonly verb: string;
  readonly pieces: readonly VerbPiece[];
  // Highest argument index that has to be present.
  readonly requiredArgs: number;
  readonly maxArgs: number;
  readonly renameTo?: string;
}

export interface ListVerbSpec {
  readonly verb: string;
  readonly field: string;
}

const field = (name: string, arg: number): VerbPiece => ({ kind: "field", name, arg });
const options = (arg: number): VerbPiece => ({ kind: "options", arg });

function nameAndOptions(verb: string): VerbSpec {
  return { verb, pieces: [field("name", 0), options(1)], requiredArgs: 2, maxArgs: 2 };
}

export const LIST_VERBS: readonly ListVerbSpec[] = [
  { verb: "optionalRequires", field: "features" },
  { verb: "readsConfig", field: "keys" },
];

export const VERB_SPECS: readonly VerbSpec[] = [
  {
    verb: "relation",
    pieces: [field("entity", 0), field("name", 1), options(2)],
    requiredArgs: 3,
    maxArgs: 3,
  },
  {
    verb: "job",
    pieces: [field("name", 0), options(1), field("handler", 2)],
    requiredArgs: 3,
    maxArgs: 3,
  },
  nameAndOptions("notification"),
  {
    verb: "referenceData",
    pieces: [field("entity", 0), field("data", 1), options(2)],
    requiredArgs: 2,
    maxArgs: 3,
  },
  nameAndOptions("metric"),
  nameAndOptions("secret"),
  nameAndOptions("secretNamespace"),
  nameAndOptions("claimKey"),
  {
    verb: "streamHandler",
    pieces: [field("name", 0), field("schema", 1), field("handler", 2), options(3)],
    requiredArgs: 3,
    maxArgs: 4,
  },
  {
    verb: "useExtension",
    pieces: [field("name", 0), field("entity", 1), options(2)],
    requiredArgs: 2,
    maxArgs: 3,
    renameTo: "applyExtension",
  },
];

// `r.config("key", def)` is the one verb whose result is read: the object form returns the keys.
export const CONFIG_VERB = "config";

export const ALL_VERB_NAMES: readonly string[] = [
  ...LIST_VERBS.map((spec) => spec.verb),
  ...VERB_SPECS.map((spec) => spec.verb),
  CONFIG_VERB,
];
