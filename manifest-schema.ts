/**
 * Validates manifest/**\/*.json files against the JSON Schema generated
 * from `ManifestEntry`. Generated fresh on every run rather than checked
 * in, so there's one source of truth for the shape. No CLI of its own —
 * `build.ts` calls `validateManifestShape` before trusting any entry's
 * content (ADR-021).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv } from "ajv";
import { createGenerator } from "ts-json-schema-generator";
import { PROJECT_ROOT } from "./paths.js";

export interface SchemaCheckResult {
  path: string;
  errors: string[];
}

/** Validates every manifest file at `manifestPaths` against `ManifestEntry`'s shape. */
export function validateManifestShape(manifestPaths: string[]): SchemaCheckResult[] {
  const schema = createGenerator({
    path: join(PROJECT_ROOT, "tools/types.ts"),
    tsconfig: join(PROJECT_ROOT, "tsconfig.json"),
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
