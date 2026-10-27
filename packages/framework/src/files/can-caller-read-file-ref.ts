import type { Registry, SessionUser } from "../engine/types/index.ts";
import { createDefaultGuard, DEFAULT_PRIVILEGED_ROLES } from "./default-file-guard.ts";
import { type FileRef, readFilesRouteOptions } from "./file-routes.ts";
import { collectRecordOnlyFileEntityTypes } from "./record-only-file-entity-types.ts";
import { createRecordReadCheck } from "./record-read-check.ts";

export type CanReadFileRefContext = {
  readonly registry: Registry;
  readonly user: SessionUser;
  readonly dispatch: {
    readonly query: (qn: string, payload: unknown) => Promise<unknown>;
  };
};

// Same decision as GET /files/:id: the app's accessGuard when configured, otherwise the
// default guard with the configured privileged roles and record-read check.
export async function canCallerReadFileRef(
  ctx: CanReadFileRefContext,
  fileRef: FileRef,
): Promise<boolean> {
  const options = readFilesRouteOptions(ctx.registry);
  const guard =
    options.accessGuard ??
    createDefaultGuard(
      options.privilegedRoles ?? DEFAULT_PRIVILEGED_ROLES,
      createRecordReadCheck(ctx.registry, (qn, payload) => ctx.dispatch.query(qn, payload)),
      options.unclaimedUploadReaders ?? [],
      collectRecordOnlyFileEntityTypes(ctx.registry),
    );
  return (await guard({ fileRef, user: ctx.user, operation: "read" })) === "allow";
}
