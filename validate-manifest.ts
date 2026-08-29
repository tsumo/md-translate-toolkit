/**
 * Validates every manifest/**\/*.json file against the JSON Schema
 * generated from ManifestEntry (tools/types.ts). The schema is generated
 * fresh on every run rather than checked in, so tools/types.ts stays the
 * single source of truth for the shape (see TODO.md Phase 1).
 */
import { readFileSync } from "node:fs";
import { glob } from "glob";
import { createGenerator } from "ts-json-schema-generator";
import { Ajv } from "ajv";

const schema = createGenerator({
  path: "tools/types.ts",
  tsconfig: "tsconfig.json",
  type: "ManifestEntry",
}).createSchema("ManifestEntry");

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

const files = await glob("manifest/**/*.json");

if (files.length === 0) {
  console.log("No manifest files found yet — nothing to validate.");
  process.exit(0);
}

let hasErrors = false;

for (const file of files.sort()) {
  const data = JSON.parse(readFileSync(file, "utf-8"));
  if (validate(data)) {
    console.log(`ok    ${file}`);
  } else {
    hasErrors = true;
    console.error(`FAIL  ${file}`);
    for (const err of validate.errors ?? []) {
      console.error(`      ${err.instancePath || "/"} ${err.message}`);
    }
  }
}

process.exit(hasErrors ? 1 : 0);
