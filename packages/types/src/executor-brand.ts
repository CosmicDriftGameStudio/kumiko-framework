// A managed projection is only writable through the executor (event →
// rebuild-safe). To make a direct write a *compile* error rather than a
// convention, EntityTable carries a phantom `unique symbol` prop; the public
// write helpers reject anything that has it (see NotExecutorOnly + query.ts).
// The symbol key dodges SchemaTable's `[field: string]: unknown` index
// signature (string index sigs don't cover symbol keys), so the brand
// survives the type-erasure that would swallow a plain marker prop — and the
// executor seam (applyEntityEvent) erases `table` to TableColumns<any>, which
// carries no such prop, so the one legitimate writer stays green.
declare const EXECUTOR_ONLY: unique symbol;
export interface ExecutorOnly {
  readonly [EXECUTOR_ONLY]: true;
}
// Negative brand for write-helper params: a branded EntityTable is NOT
// assignable (its `true` clashes with `never`), while unmanaged EntityTableMeta
// and erased SchemaTable pass (they lack the prop, so `?: never` is satisfied).
export type NotExecutorOnly = {
  readonly [EXECUTOR_ONLY]?: never;
};
