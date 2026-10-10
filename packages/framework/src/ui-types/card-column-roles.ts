export const CARD_META_MAX = 3;

export type CardRoleColumn = {
  readonly field: string;
  readonly highlighted?: boolean;
  readonly type?: string;
  readonly renderer?: unknown;
  readonly hideOnNarrow?: boolean;
};

export type CardColumnRoles<C extends CardRoleColumn> = {
  readonly title: C | undefined;
  readonly status: C | undefined;
  readonly meta: readonly C[];
};

// One rule for the narrow-layout list card, shared by the renderer and the
// boot validator so the validator counts exactly what the card would draw.
export function cardColumnRoles<C extends CardRoleColumn>(
  columns: readonly C[],
): CardColumnRoles<C> {
  const title = columns.find((col) => col.highlighted === true) ?? columns[0];
  const status = columns.find(
    (col) => col !== title && col.type === "select" && col.renderer === undefined,
  );
  const meta = columns.filter(
    (col) => col !== title && col !== status && col.hideOnNarrow !== true,
  );
  return { title, status, meta };
}
