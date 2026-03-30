export type SearchAdapter = {
  index(entity: string, id: number, fields: Record<string, unknown>): Promise<void>;
  search(entity: string, query: string): Promise<number[]>;
  remove(entity: string, id: number): Promise<void>;
};
