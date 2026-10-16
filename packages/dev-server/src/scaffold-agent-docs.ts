export const FRAMEWORK_AGENTS_IMPORT = "@node_modules/@cosmicdrift/kumiko-framework/AGENTS.md";

const FRAMEWORK_AGENTS_PATH = "node_modules/@cosmicdrift/kumiko-framework/AGENTS.md";
const FRAMEWORK_AGENTS_DIR = "node_modules/@cosmicdrift/kumiko-framework/agents/";

export function renderAgentsMd(): string {
  return `# Agent instructions

This app is built on Kumiko. The framework guide for coding agents ships with the installed package and matches its version:

- \`${FRAMEWORK_AGENTS_PATH}\`: start here.
- \`${FRAMEWORK_AGENTS_DIR}\`: generated indexes of bundled features, widgets and tested examples.

Read the framework guide before you add or change a feature. App-specific rules go below.
`;
}

export function renderClaudeMd(): string {
  return `${FRAMEWORK_AGENTS_IMPORT}\n@AGENTS.md\n`;
}
