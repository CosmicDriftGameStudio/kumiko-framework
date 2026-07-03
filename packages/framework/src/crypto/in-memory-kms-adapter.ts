import { randomBytes } from "node:crypto";
import {
  KeyAlreadyExistsError,
  KeyErasedError,
  KeyNotFoundError,
  type KmsHealth,
  type LocalKeyKmsAdapter,
  type SubjectDek,
  type SubjectId,
  type SubjectKey,
  subjectIdToKey,
} from "./kms-adapter";

interface KeyEntry {
  key: Buffer | null;
  erasedAt: Date | null;
}

// Non-persistent adapter for tests and dev mode. Erased entries stay as
// tombstones so the create-after-erase contract holds within a process.
export class InMemoryKmsAdapter implements LocalKeyKmsAdapter {
  readonly capabilities = { mode: "local-key" } as const;

  private readonly keys = new Map<SubjectKey, KeyEntry>();

  async createKey(subject: SubjectId): Promise<void> {
    const subjectKey = subjectIdToKey(subject);
    if (this.keys.has(subjectKey)) throw new KeyAlreadyExistsError(subject);
    this.keys.set(subjectKey, { key: randomBytes(32), erasedAt: null });
  }

  async getKey(subject: SubjectId): Promise<SubjectDek> {
    const entry = this.keys.get(subjectIdToKey(subject));
    if (!entry) throw new KeyNotFoundError(subject);
    if (entry.erasedAt !== null || entry.key === null) throw new KeyErasedError(subject);
    return entry.key;
  }

  async eraseKey(subject: SubjectId): Promise<void> {
    const entry = this.keys.get(subjectIdToKey(subject));
    if (!entry || entry.erasedAt !== null) return;
    entry.key = null;
    entry.erasedAt = new Date();
  }

  async health(): Promise<KmsHealth> {
    return { ok: true, latencyMs: 0 };
  }
}
