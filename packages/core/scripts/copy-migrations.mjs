import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
cpSync(path.join(root, "src/db/migrations"), path.join(root, "dist/db/migrations"), {
  recursive: true,
});
