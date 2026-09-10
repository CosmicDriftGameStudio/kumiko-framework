export type Output = {
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
};
