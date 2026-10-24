// TenantDb identity keys WeakMaps (rebinders, personal-data gates), so the exposed db is never
// wrapped or spread; the non-enumerable property keeps spreads and logging of the db unchanged.
function defineOutsideTransaction<T extends object, O extends object | undefined>(
  db: T,
  outsideTransaction: O,
): asserts db is T & { readonly outsideTransaction: O } {
  Object.defineProperty(db, "outsideTransaction", {
    value: outsideTransaction,
    enumerable: false,
    configurable: true,
  });
}

export function attachOutsideTransaction<T extends object, O extends object | undefined>(
  db: T,
  outsideTransaction: O,
): T & { readonly outsideTransaction: O } {
  defineOutsideTransaction(db, outsideTransaction);
  return db;
}
