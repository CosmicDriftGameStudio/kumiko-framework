export type { AgentDocGap, AgentDocGapKind } from "./agent-doc-lint";
export { AgentDocGapKinds, findAgentDocGaps, formatAgentDocGap } from "./agent-doc-lint";
export { buildAgentManifest } from "./agent-manifest";
export { AGENT_TOOLS_FEATURE_NAME, createAgentToolsFeature } from "./feature";
export { buildToolCatalog } from "./tool-catalog";
export type { ToolCallResult, ToolDispatcher } from "./tool-dispatch";
export { dispatchToolCall } from "./tool-dispatch";
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
  RegistryManifestView,
  RegistrySearchView,
  ToolCatalog,
  ToolDefinition,
  ToolDispatchDescriptor,
} from "./types";
