#!/usr/bin/env bun
import { runCli } from "../src/index";

process.exit(await runCli({ argv: process.argv.slice(2) }));
