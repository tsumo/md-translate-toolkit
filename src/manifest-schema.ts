/**
 * Checks manifest files against a JSON Schema that the toolkit generates from `ManifestEntry` on each run.
 * The type is the only source of truth for the shape. `build` calls this before it trusts any entry (ADR-014).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { createGenerator } from "ts-json-schema-generator";

const PACKAGE_ROOT = fileURLToPath(new URL(".", import.meta.url));

export interface SchemaCheckResult {
  path: string;
  errors: string[];
}

/** Checks each manifest file against the `ManifestEntry` shape. */
export function validateManifestShape(manifestPaths: string[]): SchemaCheckResult[] {
  const schema = createGenerator({
    path: join(PACKAGE_ROOT, "types.ts"),
    tsconfig: join(PACKAGE_ROOT, "..", "tsconfig.json"),
    type: "ManifestEntry",
  }).createSchema("ManifestEntry");

  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);

  return manifestPaths.map((path) => {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    if (validate(data)) return { path, errors: [] };
    return { path, errors: (validate.errors ?? []).map((err) => `${err.instancePath || "/"} ${err.message}`) };
  });
}
