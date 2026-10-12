import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const schemaUrl = "https://api.attio.com/openapi/api";
const schemaPath = fileURLToPath(new URL("../openapi/attio-api.json", import.meta.url));

function normalizeSchema(schema: unknown): string {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error("Attio API schema is not an object.");
  }

  if (!("openapi" in schema) || schema.openapi !== "3.1.0") {
    const version = "openapi" in schema ? schema.openapi : undefined;
    throw new Error(`Review unsupported OpenAPI version: ${String(version)}`);
  }

  const paths = "paths" in schema ? schema.paths : undefined;
  if (!paths || typeof paths !== "object" || !("/v2/self" in paths)) {
    throw new Error("Attio API schema does not contain GET /v2/self.");
  }

  return `${JSON.stringify(schema, null, 2)}\n`;
}

const response = await fetch(schemaUrl, {
  headers: { Accept: "application/json" },
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) {
  throw new Error(`Failed to fetch Attio API schema: HTTP ${response.status}`);
}

const remoteSchema: unknown = await response.json();
const nextSchema = normalizeSchema(remoteSchema);
if (process.argv.includes("--check")) {
  const currentSchema: unknown = JSON.parse(await readFile(schemaPath, "utf8"));
  if (!isDeepStrictEqual(currentSchema, remoteSchema)) {
    throw new Error('Attio API schema changed. Run "vp run api-schema:update" and review.');
  }
  console.log("Attio API schema is current.");
} else {
  await writeFile(schemaPath, nextSchema);
  console.log(`Updated ${schemaPath}`);
}
