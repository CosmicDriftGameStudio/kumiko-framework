import {
  defineEntityListHandler,
  type EntityDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { adminAccess } from "../lib.ts";
import { HELPDESK_REQUEST_ENTITY } from "../web/constants.ts";

export function createRequestListQuery(requestEntity: EntityDefinition) {
  return defineEntityListHandler(HELPDESK_REQUEST_ENTITY, requestEntity, {
    access: adminAccess,
    description:
      "Lists contact requests for the SystemAdmin inbox: searchable, filterable by status, kind and source, newest first; the open named filter backs the dashboard tile.",
  });
}
