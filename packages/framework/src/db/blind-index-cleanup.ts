// Sofortiges Blind-Index-Nulling nach einem Subject-Erase (#818).
//
// Nach kms.eraseKey ist der Ciphertext unlesbar, aber die deterministische
// bidx-Spalte bliebe bis zum nächsten Write/Rebuild matchbar — ein
// Linkage-Fenster ("hat irgendeine Row den Wert X"). Dieser Sweep schließt
// es sofort: der Ciphertext nennt sein Subject inline
// (kumiko-pii:v1:<subjectKey>:...), also findet ein LIKE-Prefix-Match exakt
// die Rows des erased Subjects — pro lookupable-Feld ein UPDATE.
//
// Rows, die der Forget-Lauf ohnehin via Executor löscht/anonymisiert,
// bekommen ihren bidx dort automatisch neu berechnet; dieser Sweep deckt
// die liegen bleibenden Rows ab (fremde Entities mit userOwned-Feldern).

import { collectLookupableFields } from "../crypto/blind-index";
import type { FeatureDefinition } from "../engine/types";
import { toSnakeCase } from "../utils/case";
import type { DbRunner } from "./connection";
import { resolveTableName } from "./entity-table-meta";
import { executeRawQuery } from "./queries/raw-sql";

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function nullBlindIndexesForSubject(
  db: DbRunner,
  features: ReadonlyMap<string, FeatureDefinition>,
  subjectKey: string,
): Promise<void> {
  const likePattern = `kumiko-pii:v1:${escapeLikePattern(subjectKey)}:%`;
  for (const feature of features.values()) {
    for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
      const lookupable = collectLookupableFields(entity);
      if (lookupable.length === 0) continue;
      // Kein featureName-Prefix — der Dispatcher baut Entity-Tables ohne
      // (buildEntityTable ohne featureName-Option), der Sweep muss dieselben
      // Namen treffen.
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
