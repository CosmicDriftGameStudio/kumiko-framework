#!/usr/bin/env bun
// @runtime tooling
// Regenerates packages/framework/agents/ (feature, widget and example indexes
// shipped in the framework package). The agent-docs-drift guard fails when
// the committed files differ from this output.
import { join } from "node:path";
import { AGENT_DOCS_DIR, writeAgentDocs } from "@cosmicdrift/kumiko-guards";

const fileCount = writeAgentDocs(join(import.meta.dir, ".."));
process.stdout.write(`Wrote ${fileCount} files to ${AGENT_DOCS_DIR}\n`);
