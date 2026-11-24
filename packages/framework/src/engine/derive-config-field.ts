import { isOptionsQueryFieldRef } from "@cosmicdrift/kumiko-types/fields";
import { isEncryptedAtRest } from "./config-helpers.ts";
import {
  createBooleanField,
  createMoneyField,
  createNumberField,
  createSelectField,
  createTextField,
} from "./factories.ts";
import { toKebab } from "./qualified-name.ts";
import type { ConfigKeyDefinition } from "./types/config.ts";
import type { FieldDefinition, OptionsQueryPayload } from "./types/fields.ts";

export type MaskedKey = {
  readonly qn: string;
  // Effective group this key is bucketed under for the Settings-Hub —
  // `def.group` if set, else `ownerFeature`. This is what screen/nav
  // generation groups by.
  readonly feature: string;
  // The feature that actually declared this key (always derived from `qn`).
  // Needed to disambiguate field ids when `feature !== ownerFeature` (a
  // cross-feature `group`) and for collision error messages.
  readonly ownerFeature: string;
  readonly shortKey: string;
  readonly def: ConfigKeyDefinition;
};

// `{ field: <shortKey> }` names another key of the owner feature; on the form it
// has to point at that key's generated field id, so it must sit on the same mask.
function rewriteOptionsQueryFieldRefs(
  key: MaskedKey,
  payload: OptionsQueryPayload,
  screenKeys: readonly MaskedKey[],
  fieldIdOf: (k: MaskedKey) => string,
): OptionsQueryPayload {
  return Object.fromEntries(
    Object.entries(payload).map(([name, value]) => {
      if (!isOptionsQueryFieldRef(value)) return [name, value];
      const target = screenKeys.find(
        (k) => k.ownerFeature === key.ownerFeature && k.shortKey === toKebab(value.field),
      );
      if (target === undefined) {
        throw new Error(
          `[Settings-Hub] config key "${key.qn}" optionsQueryPayload "${name}" references key "${value.field}", which is not on the same generated settings screen (group "${key.feature}") — give both keys the same group, scope and a mask.`,
        );
      }
      return [name, { field: fieldIdOf(target) }];
    }),
  );
}

function deriveNumberField(def: MaskedKey["def"]): FieldDefinition {
  if (def.currency !== undefined) return createMoneyField({ currency: def.currency });
  return createNumberField({
    ...(def.bounds?.min !== undefined && { min: def.bounds.min }),
    ...(def.bounds?.max !== undefined && { max: def.bounds.max }),
  });
}

export function deriveField(
  key: MaskedKey,
  selectorPluginIds: readonly string[] | undefined,
  screenKeys: readonly MaskedKey[],
  fieldIdOf: (k: MaskedKey) => string,
): FieldDefinition {
  const def = key.def;
  if (selectorPluginIds !== undefined) {
    return createSelectField({
      options: selectorPluginIds.length > 0 ? ["", ...selectorPluginIds] : selectorPluginIds,
      display: "radio",
    });
  }
  switch (def.type) {
    case "number":
      return deriveNumberField(def);
    case "boolean":
      return createBooleanField();
    case "select":
      if (def.optionsQuery !== undefined) {
        return createSelectField({
          options: [],
          optionsQuery: def.optionsQuery,
          ...(def.optionsQueryPayload !== undefined && {
            optionsQueryPayload: rewriteOptionsQueryFieldRefs(
              key,
              def.optionsQueryPayload,
              screenKeys,
              fieldIdOf,
            ),
          }),
        });
      }
      return def.options !== undefined && def.options.length > 0
        ? createSelectField({ options: def.options })
        : createTextField({ personal: false, reason: "system_metadata" });
    default:
      // A stored secret never goes back to the client: the form shows set/empty
      // and sends only a replacement or a clear.
      return createTextField({
        personal: false,
        reason: "system_metadata",
        ...(def.type === "text" && isEncryptedAtRest(def) && { writeOnly: true }),
      });
  }
}
