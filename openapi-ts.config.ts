import { defineConfig } from "@hey-api/openapi-ts";

import { commands } from "./openapi/commands-plugin.ts";

export default defineConfig({
  input: "./openapi/attio-api.json",
  output: {
    entryFile: false,
    path: "src/types/attio",
    postProcess: [{ command: "vp", args: ["fmt", "{{path}}"] }],
  },
  plugins: [
    "@hey-api/typescript",
    { name: "@hey-api/client-fetch", throwOnError: true },
    // No validator: Attio accepts and returns shapes its schema does not describe, so both pass through.
    "@hey-api/sdk",
    // Without baseUrl the handlers match any origin, so a request to the wrong host would pass.
    // Every test states the response it needs, so the handlers carry no example data.
    { name: "msw", baseUrl: "https://api.attio.com", source: [] },
    commands({
      exclude: {
        "GET /v2/files/{file_id}/download":
          "Answers with a redirect to the file, which a command that prints JSON cannot follow.",
        "POST /v2/files/upload":
          "Takes a multipart upload, which the JSON --body option cannot express.",
      },
    }),
  ],
});
