export type EntityListScreenDef = {
  readonly id: string;
  readonly type: "entityList";
  readonly entity: string;
  readonly columns: readonly ColumnDef[];
  readonly sortDefault?: string;
};

export type EntityEditScreenDef = {
  readonly id: string;
  readonly type: "entityEdit";
  readonly entity: string;
};

export type CustomScreenDef = {
  readonly id: string;
  readonly type: "custom";
  readonly renderer: string;
};

export type ColumnDef = {
  readonly field: string;
  readonly sortable?: boolean;
  readonly renderer?: string;
};

export type ScreenDef = EntityListScreenDef | EntityEditScreenDef | CustomScreenDef;

export type Renderer = {
  entityList(def: EntityListScreenDef): unknown;
  entityEdit(def: EntityEditScreenDef): unknown;
  custom(def: CustomScreenDef): unknown;
};
