import { piiCiphertextMaxLengthFor } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createBooleanField,
  createEntity,
  createEntityExecutor,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";
import { ID_PATH_MAX_LENGTH, INBOUND_FOLDER_ENTITY, MAX_FOLDER_NAME_LENGTH } from "../constants.ts";

export const inboundFolderEntity = createEntity({
  name: INBOUND_FOLDER_ENTITY,
  table: "read_connector_inbound_folders",
  description:
    "One folder in the tree of files a connector delivered. A device's top level has parentId null; idPath lists the ancestor ids so a whole subtree is one prefix match.",
  fields: {
    connectorId: createTextField({
      required: true,
      maxLength: 36,
      filterable: true,
      personal: false,
      reason: "technical_reference",
    }),
    parentId: createTextField({
      maxLength: 36,
      filterable: true,
      personal: false,
      reason: "technical_reference",
    }),
    // The id is derived from (connector, parent, name), so the name needs no blind index to be found again.
    name: createTextField({
      required: true,
      maxLength: piiCiphertextMaxLengthFor(MAX_FOLDER_NAME_LENGTH),
      personal: "tenant",
      find: "none",
    }),
    idPath: createTextField({
      required: true,
      maxLength: ID_PATH_MAX_LENGTH,
      filterable: true,
      personal: false,
      reason: "opaque_id_path",
    }),
    // Set by "delete folder"; the deletion job removes the subtree, and nothing counts or attaches to a deleting folder meanwhile.
    deleting: createBooleanField({ filterable: true }),
  },
  indexes: [{ columns: ["connectorId", "parentId"] }, { columns: ["idPath"] }],
});

export const { table: inboundFolderTable, executor: inboundFolderExecutor } =
  createEntityExecutor(inboundFolderEntity);
