#!/usr/bin/env node
/**
 * The `md-translate` entry point. It is plain JavaScript. It registers the `tsx` loader first, then imports
 * each command. A static import would run before the loader is ready.
 *
 * Usage: md-translate <command> [...args]
 */
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

// Pin the tsconfig, so a consumer's tsconfig cannot change how the JSX files compile.
register({ tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)) });

const { runAddSource } = await import("./scripts/add-source.js");
const { runBuild } = await import("./scripts/build.js");
const { runDev } = await import("./scripts/dev.js");
const { runPullUpdates } = await import("./scripts/pull-updates.js");
const { runSetStatus } = await import("./scripts/set-status.js");

const COMMANDS = new Map([
  ["build", runBuild],
  ["add-source", runAddSource],
  ["dev", runDev],
  ["pull-updates", runPullUpdates],
  ["set-status", runSetStatus],
]);

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const run = command ? COMMANDS.get(command) : undefined;

  if (!run) {
    console.error("Usage: md-translate <command> [...args]");
    console.error(`Commands: ${[...COMMANDS.keys()].join(", ")}`);
    process.exit(1);
  }

  await run(rest);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
