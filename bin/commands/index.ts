// Side-effect imports: each command-file registers itself with the
// registry on import. Add a line here when a new command is added.

import "./build";
import "./check";
import "./check-fast";
import "./ci-guards";
import "./clean-test-dbs";
import "./codegen";
import "./codemod";
import "./consumer";
import "./create";
import "./dev";
import "./doctor";
import "./eval";
import "./events";
import "./migrate";
import "./ops";
import "./project";
import "./reset";
import "./status";
import "./stop";
import "./test";

export {
  defineCommand,
  getCommand,
  getCommands,
} from "./registry";
export type { Category, Command, CommandContext, Output, Role } from "./types";
export { parseArgs, getFlag, getStringFlag, getNumberFlag } from "./arg-parser";
