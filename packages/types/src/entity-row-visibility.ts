export type ParentRefDef = {
  /** Field holding the name of the host entity this row hangs off. */
  readonly entityTypeField: string;
  /** Field holding the host row's id. */
  readonly entityIdField: string;
  /** Narrow which registered entities may act as host. Omitted means every
   *  registered entity is a candidate, which also widens the read-gate's SQL. */
  readonly allowedTypes?: readonly string[];
};

export type ReadGateDef = {
  /** Row readable only if at least one live row of `entity` with `field` = row.id is readable
   *  through that entity's own parentRef gate (host visibility). */
  readonly anyLink?: { readonly entity: string; readonly field: string };
  /** Like `anyLink`, but every live link row must be readable, and there must be at least one.
   *  For records whose links each widen the audience (a contract plus a contact shared across
   *  teams). Not combinable with `anyLink`. */
  readonly allLinks?: { readonly entity: string; readonly field: string };
  /** Row readable only if the file_ref in `field` is live and readable through its owner: owner
   *  row readable (ownership, parentRef, handler gate) and the field read access on the file_ref's
   *  fieldName passes. A file owned by this row itself passes this part. */
  readonly fileOwner?: { readonly field: string };
  /** Roles that skip `anyLink` / `allLinks` (they also see unlinked rows). `fileOwner` still applies; only
   *  the framework SYSTEM user skips both. */
  readonly linkExemptRoles?: readonly string[];
};
