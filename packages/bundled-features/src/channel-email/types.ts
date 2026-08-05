// Transport interface — SMTP in prod, InMemory in tests
export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  // Per-message From override. Absent → the transport's configured From (the
  // app-wide default). Set when one send must originate from a specific
  // mailbox — a reply from the address the original mail reached, not noreply@.
  readonly from?: string;
  // Reply-To header: where a recipient's answer goes when it differs from From.
  readonly replyTo?: string;
  // Extra RFC-5322 headers — In-Reply-To / References thread a reply into the
  // conversation it answers.
  readonly headers?: Readonly<Record<string, string>>;
};

export type EmailTransport = {
  send(message: EmailMessage): Promise<void>;
};

// InMemory transport for testing — collects sent emails.
// `failNext` lets a test simulate a transient SMTP failure without
// rebuilding the whole stack: set it before a single `notify()` call and
// the transport throws once, then auto-resets.
export function createInMemoryTransport(): EmailTransport & {
  readonly sent: EmailMessage[];
  failNext: null | { message: string };
} {
  const sent: EmailMessage[] = [];
  const transport = {
    sent,
    failNext: null as null | { message: string }, // @cast-boundary generic-record
    async send(message: EmailMessage) {
      if (transport.failNext) {
        const err = new Error(transport.failNext.message);
        transport.failNext = null;
        throw err;
      }
      sent.push(message);
    },
  };
  return transport;
}
