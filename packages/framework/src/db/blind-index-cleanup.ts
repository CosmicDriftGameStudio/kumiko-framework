// Immediate blind-index nulling after a subject erase (#818).
//
// After kms.eraseKey the ciphertext is unreadable, but the deterministic
// bidx column would stay matchable until the next write/rebuild — a
// linkage window ("does any row hold value X"). This sweep closes it right
// away: the ciphertext names its subject inline
// (kumiko-pii:v1:<subjectKey>:...), so a LIKE-prefix match finds exactly
// the erased subject's rows — one UPDATE per lookupable field.
//
// Rows the forget run deletes/anonymizes via the executor anyway get their
// bidx recomputed automatically there; this sweep covers the rows left
// behind (foreign entities with userOwned fields).

import { collectLookupableFields } from "../crypto/blind-index";
import { quoteIdent, subjectCiphertextLikePattern } from "../crypto/ciphertext-pattern";
import type { FeatureDefinition } from "../engine/types";
import { toSnakeCase } from "../utils/case";
import type { DbRunner } from "./connection";
import { resolveTableName } from "./entity-table-meta";
import { executeRawQuery } from "./queries/raw-sql";

export async function nullBlindIndexesForSubject(
  db: DbRunner,
  features: ReadonlyMap<string, FeatureDefinition>,
  subjectKey: string,
): Promise<void> {
  const likePattern = subjectCiphertextLikePattern(subjectKey);
  for (const feature of features.values()) {
    for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
      const lookupable = collectLookupableFields(entity);
      if (lookupable.length === 0) continue;
      // No featureName prefix — the dispatcher builds entity tables without
      // one (buildEntityTable with no featureName option), the sweep has to
      // hit the same names.
      const tableName = resolveTableName(entityName, entity, undefined);
      for (const fieldName of lookupable) {
        const snake = toSnakeCase(fieldName);
        await executeRawQuery(
          db,
          `UPDATE ${quoteIdent(tableName)} SET ${quoteIdent(`${snake}_bidx`)} = NULL WHERE ${quoteIdent(snake)} LIKE $1`,
          [likePattern],
        );
      }
    }
  }
}
