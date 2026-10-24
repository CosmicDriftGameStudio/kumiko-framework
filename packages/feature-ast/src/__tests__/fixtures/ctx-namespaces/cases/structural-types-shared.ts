export type SharedQueryContext = {
  readonly query: (qn: string, payload: unknown) => Promise<unknown>;
};
