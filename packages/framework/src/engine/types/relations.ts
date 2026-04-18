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
