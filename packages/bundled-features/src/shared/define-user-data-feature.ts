import {
  defineFeature,
  EXT_USER_DATA,
  type UserDataDeleteHook,
  type UserDataExportHook,
} from "@cosmicdrift/kumiko-framework/engine";

type UserDataEntityHooks = {
  readonly entity: string;
  readonly export: UserDataExportHook;
  readonly delete: UserDataDeleteHook;
};

// The source feature is optionalRequires, not requires: a source mounted toggleable(default=false)
// would otherwise trip the "effectively disabled" boot warning although its entities exist and the
// hooks work.
export function defineUserDataFeature(config: {
  readonly name: string;
  readonly description: string;
  readonly sourceFeature: string;
  readonly entities: readonly UserDataEntityHooks[];
}) {
  return defineFeature(
    config.name,
    (r) => {
      r.describe(config.description);
      r.requires({ features: ["user-data-rights"] });
      r.optionalRequires(config.sourceFeature);
      config.entities.forEach(({ entity, export: exportHook, delete: deleteHook }) => {
        r.useExtension(EXT_USER_DATA, entity, { export: exportHook, delete: deleteHook });
      });
    },
    { dedupeOptions: {} },
  );
}
