export type MspApplyContext = {
  appendEvent(type: string, payload: unknown): Promise<void>;
  loadAggregate(id: string): Promise<object>;
};
export type StepContext = { appendEvent(type: string): Promise<void> };
export type ExtraRouteContext = { write(name: string): void; log: { info(message: string): void } };
