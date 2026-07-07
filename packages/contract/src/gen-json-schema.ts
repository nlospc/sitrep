import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as schemas from "./index.js";

// Generates /contract/schema/*.json from the Zod schemas, so the human-readable
// /contract/README.md and any non-TS agent can rely on plain, version-controlled JSON
// Schema instead of importing this package. Committed (not gitignored like dist/) so the
// contract spec directory is self-contained and schema drift shows up in PR diffs.

const outDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "contract",
  "schema",
);
mkdirSync(outDir, { recursive: true });

const exported = schemas as Record<string, unknown>;

for (const [name, value] of Object.entries(exported)) {
  if (value && typeof value === "object" && "_def" in value) {
    const jsonSchema = zodToJsonSchema(value as never, name);
    writeFileSync(
      path.join(outDir, `${name}.json`),
      JSON.stringify(jsonSchema, null, 2) + "\n",
    );
  }
}

console.warn(`Wrote JSON Schema files to ${outDir}`);
