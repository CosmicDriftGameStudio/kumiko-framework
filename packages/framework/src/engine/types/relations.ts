import type { OnDeleteStrategy } from "../constants";

// --- Relations ---

export type BelongsToRelation = {
  readonly type: "belongsTo";
  readonly target: string;
  readonly foreignKey: string;
  readonly searchInclude?: readonly string[];
  // onDelete is declared on the parent-side (hasMany / manyToMany) because
  // that's where the "what happens to my children?" decision lives. A
  // belongsTo node just points at a parent — the parent's onDelete drives
  // the cleanup.
};

export type HasManyRelation = {
  readonly type: "hasMany";
  readonly target: string;
  readonly foreignKey: string;
  readonly onDelete?: OnDeleteStrategy;
  // When true, a nested payload under this relation's key (e.g.
  // `{ tasks: [{ ... }] }` on a `project:create` write) is auto-expanded
  // into child writes: parent first, then one child-write per entry with
  // the foreign key set to the parent's new id — all in the same TX.
  // Opt-in (default false) so legacy hasMany relations that were declared
  // purely for cascade-delete or UI-nav semantics don't silently gain a
  // client-writable path. Children are never inferred from payload-shape
  // alone; only relations with this flag unlock nested-write.
  //
  // Scope v1: depth=1, create-only, hasMany-only. Update-nested,
  // delete-nested, and belongsTo/m2m auto-expansion are explicit future
  // work — when they arrive, they'll take the same flag so the opt-in
  // stays a single, consistent surface.
  readonly nestedWrite?: boolean;
};

export type ManyToManyRelation = {
  readonly type: "manyToMany";
  readonly target: string;
  readonly through: {
    readonly table: string;
    readonly sourceKey: string;
    readonly targetKey: string;
  };
  readonly searchInclude?: readonly string[];
  readonly onDelete?: OnDeleteStrategy;
};

export type RelationDefinition = BelongsToRelation | HasManyRelation | ManyToManyRelation;

export type EntityRelations = Readonly<Record<string, RelationDefinition>>;
