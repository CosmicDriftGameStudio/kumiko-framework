// The `kumiko-schema` bin ships with dev-server and is absent from the production image, whose
// standalone bundle only understands `kumiko schema …`; boot errors fire in both places.
export const PRODUCTION_SCHEMA_COMMAND_HINT =
  "In the production image run `bun /app/kumiko.js schema <subcommand>` instead of `bun kumiko-schema <subcommand>`.";
