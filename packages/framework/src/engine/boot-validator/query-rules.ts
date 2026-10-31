import type { BootRuleTable } from "./boot-rule.ts";

export const QUERY_RULES = {
  notRegistered: {
    id: "query/not-registered",
    summary: "A query reference on a screen names a registered query handler.",
    fix: 'Check the QN spelling ("<feature>:query:<short>") and declare the handler via r.queryHandler(...).',
  },
  visibleWhenRequiresInput: {
    id: "query/visible-when-requires-input",
    summary: "A visibleWhen query parses the payload the gate sends.",
    fix: "Make the query's input fields optional, use a query without required input, or for projectionDetail set visibleWhen.idParam.",
  },
  visibleWhenIdParamUnsupported: {
    id: "query/visible-when-id-param-unsupported",
    summary: "visibleWhen.idParam is used only on projectionDetail screens.",
    fix: "Remove idParam or use a projectionDetail screen.",
  },
  singletonLoadRequiresInput: {
    id: "query/singleton-load-requires-input",
    summary: "An actionForm singleton load binds a query that parses an empty payload.",
    fix: "Make the query's input fields optional.",
  },
  outputFieldMissing: {
    id: "query/output-field-missing",
    summary: "A field a screen reads from a query result exists in the query's outputSchema.",
    fix: "Check the field name for a typo or add the field to the outputSchema.",
  },
  pagedOutputWithoutRows: {
    id: "query/paged-output-without-rows",
    summary: "A paged query handler's outputSchema describes the paged envelope with a rows field.",
    fix: "Wrap the row schema in the { rows, nextCursor, total? } envelope.",
  },
  listSourceOutputWithoutRows: {
    id: "query/list-source-output-without-rows",
    summary:
      "A query used as a list source has an outputSchema describing the paged envelope with a rows field.",
    fix: "Wrap the row schema in the { rows, nextCursor, total? } envelope.",
  },
} as const satisfies BootRuleTable;
