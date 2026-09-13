#!/usr/bin/env node
/**
 * Single CLI entry point, and the actual `md-translate` bin. Plain JS,
 * not TypeScript: a shebang alone can't invoke `tsx` reliably once this
 * runs from a globally linked or installed location, so this registers
 * tsx's loader hook itself, then dynamically imports each subcommand's
 * own entry function — a static import would resolve before that
 * registration ever ran.
 *
 * Usage: md-translate <command> [...args]
 */
import { register } from "tsx/esm/api";

register();

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
