import { type SubjectId, subjectIdToKey } from "@cosmicdrift/kumiko-types/kms-adapter-types";

export * from "@cosmicdrift/kumiko-types/kms-adapter-types";

// The KMS error classes live here and not in kumiko-types (#1629): callers
// branch on them with `instanceof`, which needs a single copy of the class.

export class KeyErasedError extends Error {
  constructor(public readonly subject: SubjectId) {
    super(`Subject key erased: ${subjectIdToKey(subject)}`);
    this.name = "KeyErasedError";
  }
}

export class KeyNotFoundError extends Error {
  constructor(public readonly subject: SubjectId) {
    super(`Subject key not found: ${subjectIdToKey(subject)}`);
    this.name = "KeyNotFoundError";
  }
}

export class KeyAlreadyExistsError extends Error {
  constructor(public readonly subject: SubjectId) {
    super(`Subject key already exists: ${subjectIdToKey(subject)}`);
    this.name = "KeyAlreadyExistsError";
  }
}
