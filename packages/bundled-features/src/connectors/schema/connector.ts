import {
  createEntity,
  createEntityExecutor,
  createSelectField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";
import { CONNECTOR_ENTITY, CONNECTOR_KIND, CONNECTOR_STATUS } from "../constants.ts";

export const connectorEntity = createEntity({
  name: CONNECTOR_ENTITY,
  table: "read_connectors",
  description:
    "A paired source of files outside the app, such as a satellite program on a company server, named by the tenant admin who confirmed its pairing code.",
  fields: {
    name: createTextField({
      required: true,
      maxLength: 120,
      personal: false,
      reason: "is_business_data",
    }),
    kind: createSelectField({
      options: [CONNECTOR_KIND.satellite],
      required: true,
      default: CONNECTOR_KIND.satellite,
    }),
    status: createSelectField({
      options: [CONNECTOR_STATUS.active, CONNECTOR_STATUS.revoked],
      required: true,
      default: CONNECTOR_STATUS.active,
      filterable: true,
    }),
  },
});

export const { table: connectorTable, executor: connectorExecutor } =
  createEntityExecutor(connectorEntity);
