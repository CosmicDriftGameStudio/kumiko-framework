import { subjectIdToKey } from "@cosmicdrift/kumiko-framework/crypto";
import {
  nullBlindIndexesForSubject,
  type OwnedRecordSubject,
  recordSubjectsOwnedByUser,
} from "@cosmicdrift/kumiko-framework/db";
import {
  purgeSearchDocumentsForSubject,
  type SearchAdapter,
} from "@cosmicdrift/kumiko-framework/search";
import { purgeFilesReachingSubject } from "./purge-files-reaching-subject.ts";

// The one erasure order both Art.-17 entries share (forget-subject, user-data-rights cleanup).
// Search and file purge first: both find their targets through entity rows that eraseRows deletes.
// Key erase is not here — each entry erases at the point its own crash recovery needs.
// Returns the record subjects of rows the user owns, each with its row's tenant; each entry erases those keys alongside the subject key.
export async function eraseSubjectData(
  args: Omit<Parameters<typeof purgeFilesReachingSubject>[0], "subjectKey"> & {
    readonly searchAdapter: SearchAdapter | undefined;
    readonly eraseRows: () => Promise<void>;
    // Opt-in, default off: only then are the record keys of owned rows returned for erasure.
    readonly eraseOwnedRecordKeys?: boolean;
  },
): Promise<readonly OwnedRecordSubject[]> {
  const { searchAdapter, eraseRows, eraseOwnedRecordKeys, ...fileArgs } = args;
  const subjectKey = subjectIdToKey(args.subject);
  // Before eraseRows: a forget hook may delete the row, while its created event still
  // holds the ownerless-phase ciphertext under the row's record key.
  const ownedRecordSubjects =
    eraseOwnedRecordKeys === true && args.subject.kind === "user"
      ? await recordSubjectsOwnedByUser(args.db, args.registry.features, args.subject.userId)
      : [];
  if (searchAdapter) {
    await purgeSearchDocumentsForSubject(
      args.db,
      args.registry.features,
      searchAdapter,
      subjectKey,
      args.subject,
    );
  }
  await purgeFilesReachingSubject({ ...fileArgs, subjectKey });
  await eraseRows();
  // The deterministic HMAC would stay equality-matchable until the next rebuild.
  await nullBlindIndexesForSubject(args.db, args.registry.features, subjectKey);
  return ownedRecordSubjects;
}
