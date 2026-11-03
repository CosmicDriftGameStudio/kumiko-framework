import {
  EXT_USER_DATA,
  type FeatureRegistrar,
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
// hooks work. defineFeature itself stays literal in each feature so the AST doc generator sees it.
export function registerUserDataHooks(
  r: FeatureRegistrar,
  config: {
    readonly sourceFeature: string;
    readonly entities: readonly UserDataEntityHooks[];
  },
): void {
  r.requires({ features: ["user-data-rights"] });
  r.optionalRequires(config.sourceFeature);
  config.entities.forEach(({ entity, export: exportHook, delete: deleteHook }) => {
    r.useExtension(EXT_USER_DATA, entity, { export: exportHook, delete: deleteHook });
  });
}
