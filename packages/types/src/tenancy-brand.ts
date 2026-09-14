// Makes `db.global()` on a "tenant" table a compile error, mirroring executor-brand.ts's
// approach for the executor-only write path.
export type EntityTenancy = "global" | "tenant";

declare const TENANCY: unique symbol;

export interface TenancyBrand<T extends EntityTenancy> {
  readonly [TENANCY]: T;
}
