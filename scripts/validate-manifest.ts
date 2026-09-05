/**
 * Validates every manifest/**\/*.json file against the JSON Schema
 * generated from ManifestEntry. Generated fresh on every run rather than
 * checked in, so there's one source of truth for the shape.
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Ajv } from "ajv";
import { createGenerator } from "ts-json-schema-generator";
import { globManifestPaths, PROJECT_ROOT } from "../paths.js";

async function main() {
  const schema = createGenerator({
    path: join(PROJECT_ROOT, "tools/types.ts"),
    tsconfig: join(PROJECT_ROOT, "tsconfig.json"),
    type: "ManifestEntry",
  }).createSchema("ManifestEntry");

  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);

  const files = await globManifestPaths();

  if (files.length === 0) {
    console.log("No manifest files found yet — nothing to validate.");
    return;
  }

  let hasErrors = false;

  for (const file of files) {
    const displayPath = relative(PROJECT_ROOT, file);
    const data = JSON.parse(readFileSync(file, "utf-8"));
    if (validate(data)) {
      console.log(`ok    ${displayPath}`);
    } else {
      hasErrors = true;
      console.error(`FAIL  ${displayPath}`);
      for (const err of validate.errors ?? []) {
        console.error(`      ${err.instancePath || "/"} ${err.message}`);
      }
    }
  }

  process.exit(hasErrors ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
