// --- Author-facing PII API ---
//
// Two questions instead of the twelve raw flags above: whose data is this
// (`personal`, resolved to a subject key) and how findable must it stay
// (`find`, resolved to the search/lookup flags). Field factories expand
// these into `ResolvedPiiFlags` — see packages/framework/src/engine/factories.ts.
// Entity fields have no plaintext fallback for an ownerless row: stored PII
// must stay shreddable.
export type EntityPiiAbsentSubject = "tenant" | "self";
export type PersonalSubject =
  | "self"
  | { readonly of: string; readonly whenAbsent?: EntityPiiAbsentSubject }
  | "tenant";
export type Findability = "exact" | "fuzzy" | "none" | "secret";

// Marks "no personal annotation given" — plain `Record<string, never>` would
// force every OTHER intersected property (e.g. a factory's `required?: R`)
// to `never` too, since its index signature applies to all string keys.
// Naming the three annotation keys explicitly avoids that trap.
//
// No longer part of PersonalAnnotations /
// PersonalAnnotationsLongText — text and longText fields must declare an
// explicit stance. It still applies to PersonalAnnotationsNoFind, whose
// factories keep `personal` optional.
type NoPersonalAnnotation = {
  readonly personal?: never;
  readonly find?: never;
  readonly reason?: never;
  readonly anonymize?: never;
};

export type PersonalAnnotations =
  | {
      readonly personal: PersonalSubject;
      readonly find: Findability;
      readonly anonymize?: () => unknown | Promise<unknown>;
    }
  | { readonly personal: "ref" }
  | {
      readonly personal: false;
      readonly reason: string;
      readonly anonymize?: () => unknown | Promise<unknown>;
    };

// longText has no blind-index lookup: "fuzzy" means full-text via the
// SearchAdapter only (long values are chunked there), "secret" means never findable.
// Kept mandatory like `find` on PersonalAnnotations: no silent default.
export type LongTextFindability = "none" | "fuzzy" | "secret";

export type PersonalAnnotationsLongText =
  | {
      readonly personal: PersonalSubject;
      readonly find: LongTextFindability;
      readonly anonymize?: () => unknown | Promise<unknown>;
    }
  | { readonly personal: "ref" }
  | {
      readonly personal: false;
      readonly reason: string;
      readonly anonymize?: () => unknown | Promise<unknown>;
    };

// Same as PersonalAnnotations but without `find` — for field types with no
// full-text/blind-index machinery (everything except text and longText).
export type PersonalAnnotationsNoFind =
  | {
      readonly personal: PersonalSubject;
      readonly anonymize?: () => unknown | Promise<unknown>;
    }
  | { readonly personal: "ref" }
  | {
      readonly personal: false;
      readonly reason: string;
      readonly anonymize?: () => unknown | Promise<unknown>;
    }
  | NoPersonalAnnotation;
