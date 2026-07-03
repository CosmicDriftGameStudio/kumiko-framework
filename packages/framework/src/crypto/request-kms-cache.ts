import type {
  KmsContext,
  LocalKeyKmsAdapter,
  SubjectDek,
  SubjectId,
  SubjectKey,
} from "./kms-adapter";
import { subjectIdToKey } from "./kms-adapter";

// Per-request DEK cache: a list rendering 50 comments of one author does one
// adapter round-trip, not 50. Only meaningful for local-key adapters —
// remote-crypto backends never release keys, every call is a round-trip.
export interface RequestKmsCache {
  getKey(subject: SubjectId, ctx: KmsContext): Promise<SubjectDek>;
  /** Drops one subject's cached DEK — called when its key is shredded mid-request. */
  invalidate(subject: SubjectId): void;
  clear(): void;
}

export function createRequestKmsCache(adapter: LocalKeyKmsAdapter): RequestKmsCache {
  const cache = new Map<SubjectKey, SubjectDek>();
  return {
    async getKey(subject, ctx) {
      const subjectKey = subjectIdToKey(subject);
      const hit = cache.get(subjectKey);
      if (hit !== undefined) return hit;
      const dek = await adapter.getKey(subject, ctx);
      cache.set(subjectKey, dek);
      return dek;
    },
    invalidate(subject) {
      cache.delete(subjectIdToKey(subject));
    },
    clear() {
      cache.clear();
    },
  };
}
