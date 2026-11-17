export type PushMessage = {
  readonly token: string;
  readonly title: string;
  readonly body: string | undefined;
  readonly data: Readonly<Record<string, unknown>> | undefined;
};

export type PushTransport = {
  send(message: PushMessage): Promise<void>;
};

export function createInMemoryPushTransport(): PushTransport & {
  readonly sent: PushMessage[];
} {
  const sent: PushMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}
