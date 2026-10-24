export type ConsumerCliOut = {
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
};
