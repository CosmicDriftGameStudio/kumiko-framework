#!/usr/bin/env bun
import { parseArgv, runCreate } from "../src/index";

process.exit(await runCreate(parseArgv(process.argv.slice(2))));
