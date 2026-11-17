import {
  createSelectField,
  createTextField,
  type ScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { open } from "./access";

export const connectionEditScreen: ScreenDefinition = {
  id: "connection-edit",
  type: "entityEdit",
  entity: "connection",
  layout: {
    sections: [
      {
        title: "ai-settings.section.connection",
        columns: 2,
        fields: [
          { field: "name", span: 2 },
          { field: "provider", span: 2 },
          { field: "apiKey", span: 2 },
        ],
      },
    ],
  },
};

export const connectionListScreen: ScreenDefinition = {
  id: "connection-list",
  type: "entityList",
  entity: "connection",
  columns: ["name", "provider"],
  pagination: "pages",
  pageSize: 25,
  defaultSort: { field: "name", dir: "asc" },
  rowActions: [
    {
      kind: "navigate",
      id: "edit",
      label: "ai-settings.action.edit",
      screen: "connection-edit",
      rowClick: true,
    },
    {
      kind: "navigate",
      id: "probe",
      label: "ai-settings.action.probe",
      screen: "connection-detail",
    },
  ],
};

export const connectionDetailScreen: ScreenDefinition = {
  id: "connection-detail",
  type: "projectionDetail",
  query: "ai-settings:query:connection:summary",
  header: { title: "name", subtitle: "provider" },
  fieldLabels: {
    name: "ai-settings:entity:connection:field:name",
    provider: "ai-settings:entity:connection:field:provider",
  },
  layout: {
    mode: "tabs",
    sections: [
      {
        id: "overview",
        kind: "fields",
        title: "ai-settings.tab.overview",
        fields: ["name", "provider"],
      },
      {
        id: "probe",
        kind: "writeForm",
        title: "ai-settings.tab.probe",
        columns: 2,
        fieldDefs: {
          model: createSelectField({
            options: [],
            optionsQuery: "ai-settings:query:all-model-options",
          }),
          prompt: createTextField({
            personal: false,
            reason: "is_business_data",
            multiline: { rows: 4 },
          }),
        },
        fields: [
          { field: "model", span: 2 },
          { field: "prompt", span: 2 },
        ],
        handler: "ai-settings:write:probe:run",
        submitLabel: "ai-settings.action.start-probe",
      },
    ],
  },
  access: open.access,
};

export const stepAssignScreen: ScreenDefinition = {
  id: "step-assign",
  type: "actionForm",
  handler: "ai-settings:write:step:assign",
  fields: {
    step: createSelectField({
      options: [],
      optionsQuery: "ai-settings:query:step-options",
      display: "radio",
      required: true,
    }),
    connection: createSelectField({
      options: [],
      optionsQuery: "ai-settings:query:connection-options",
    }),
    model: createSelectField({
      options: [],
      optionsQuery: "ai-settings:query:model-options",
      optionsQueryPayload: { connectionId: { field: "connection" } },
    }),
  },
  fieldLabels: {
    step: "ai-settings:entity:__action-form__:field:step",
    connection: "ai-settings:entity:__action-form__:field:connection",
    model: "ai-settings:entity:__action-form__:field:model",
  },
  layout: {
    sections: [
      { title: "ai-settings.section.step", fields: ["step"] },
      { title: "ai-settings.section.model", columns: 2, fields: ["connection", "model"] },
    ],
  },
  submitLabel: "ai-settings.action.assign",
  access: open.access,
};
