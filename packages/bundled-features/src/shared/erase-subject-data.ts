import { subjectIdToKey } from "@cosmicdrift/kumiko-framework/crypto";
import { nullBlindIndexesForSubject } from "@cosmicdrift/kumiko-framework/db";
import {
  purgeSearchDocumentsForSubject,
  type SearchAdapter,
} from "@cosmicdrift/kumiko-framework/search";
import { forgetCapCounterSubject } from "../cap-counter/index.ts";
import { purgeFilesReachingSubject } from "./purge-files-reaching-subject.ts";

// The one erasure order both Art.-17 entries share (forget-subject, user-data-rights cleanup).
// Search and file purge first: both find their targets through entity rows that eraseRows deletes.
// Key erase is not here — each entry erases at the point its own crash recovery needs.
export async function eraseSubjectData(
  args: Omit<Parameters<typeof purgeFilesReachingSubject>[0], "subjectKey"> & {
    readonly searchAdapter: SearchAdapter | undefined;
    readonly eraseRows: () => Promise<void>;
  },
): Promise<void> {
  const { searchAdapter, eraseRows, ...fileArgs } = args;
  const subjectKey = subjectIdToKey(args.subject);
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
  // Subject usage rows are keyed by an HMAC of the subject key and would stay linkable.
  await forgetCapCounterSubject(args.db, args.registry.features, subjectKey);
}
