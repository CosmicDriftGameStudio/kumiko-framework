export type { AgentDocGap, AgentDocGapKind } from "./agent-doc-lint.ts";
export {
  AgentDocGapKinds,
  findAgentDocGaps,
  findDescriptionTranslationGaps,
  findHandlerTranslationGaps,
  formatAgentDocGap,
} from "./agent-doc-lint.ts";
export { buildAgentManifest } from "./agent-manifest.ts";
export {
  type ApiDocsDiff,
  type ApiDocsInput,
  type ApiDocsLocale,
  type ApiDocsProblem,
  type ApiDocsResult,
  type ApiDocsSource,
  type ApiDocsTexts,
  type ApiExampleFile,
  ApiExampleFileSchema,
  apiDocsLocales,
  diffApiDocsOutput,
  formatApiDocsProblem,
  formatApiDocsText,
  generateApiDocs,
  INDEX_FILE,
  isApiDocsLocale,
  type NamedApiExample,
  type NamedWebhookExample,
  OPENAPI_FILE,
  type ResolvedApiDocsConfig,
  WebhookExampleFileSchema,
} from "./api-docs/index.ts";
export { AGENT_TOOLS_FEATURE_NAME, createAgentToolsFeature } from "./feature.ts";
export { buildToolCatalog, OPEN_FORM_TOOL_NAME, toolNameForQn } from "./tool-catalog.ts";
export type { ToolCallRequest, ToolCallResult, ToolDispatcher } from "./tool-dispatch.ts";
export { dispatchToolCall, TOOL_CALL_ERROR_CODES } from "./tool-dispatch.ts";
export type {
  AgentManifest,
  AgentManifestEntity,
  AgentManifestFeature,
  AgentManifestField,
  AgentManifestHandler,
  AgentManifestNav,
  AgentManifestOptions,
  AgentManifestScreen,
  AgentManifestWorkspace,
  AgentToolMode,
  RegistryManifestView,
  RegistrySearchView,
  ToolCatalog,
  ToolCatalogOptions,
  ToolDefinition,
  ToolDispatchDescriptor,
} from "./types.ts";
