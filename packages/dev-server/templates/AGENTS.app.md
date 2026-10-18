# {{productName}}: agent instructions

{{productName}} is built on Kumiko. The framework guide for coding agents ships with the installed package and matches its version:

- `node_modules/@cosmicdrift/kumiko-framework/AGENTS.md`: start here.
- `node_modules/@cosmicdrift/kumiko-framework/agents/`: generated indexes of bundled features, widgets and tested examples.

Read the framework guide before you add or change a feature. The sections below are specific to this app.

## Product

- Purpose: TODO(app owner): what {{productName}} does and for whom, in one or two sentences.
- Production URL: TODO(app owner): https://example.com

## Mounted features

{{featureList}}

Mount more in `src/run-config.ts`. App code lives in `src/features/<name>/`.

## Commands

{{commands}}

## App-specific rules

TODO(app owner): decisions an agent cannot read from the code, such as domain terms, roles, data-retention limits or integrations that must not be touched.
