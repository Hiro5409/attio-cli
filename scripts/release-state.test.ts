import { createHash } from "node:crypto";

import { http, HttpResponse } from "msw/http";
import { expect, test } from "vite-plus/test";

import { server } from "../src/test/server.ts";
import { releaseState } from "./release-state.ts";

const input = {
  name: "@hiro5409/attio-cli",
  version: "0.1.0",
  repository: "Hiro5409/attio-cli",
  filename: "hiro5409-attio-cli-0.1.0.tgz",
  bytes: Buffer.from("tested artifact"),
  token: "test-token",
};
const published = {
  dist: { integrity: `sha512-${createHash("sha512").update(input.bytes).digest("base64")}` },
};
const asset = {
  name: input.filename,
  digest: `sha256:${createHash("sha256").update(input.bytes).digest("hex")}`,
};

const npmUrl = "https://registry.npmjs.org/%40hiro5409%2Fattio-cli/0.1.0";
const releaseUrl = "https://api.github.com/repos/Hiro5409/attio-cli/releases/tags/v0.1.0";

test.each([
  { npm: false, release: false },
  { npm: true, release: false },
  { npm: true, release: true },
])("resumes npm=$npm release=$release", async (state) => {
  server.use(
    http.get(npmUrl, ({ request }) => {
      expect(request.headers.has("authorization")).toBe(false);
      return state.npm ? HttpResponse.json(published) : new HttpResponse(null, { status: 404 });
    }),
    http.get(releaseUrl, ({ request }) => {
      expect(request.headers.get("authorization")).toBe("Bearer test-token");
      return state.release
        ? HttpResponse.json({ assets: [asset] })
        : new HttpResponse(null, { status: 404 });
    }),
  );
  await expect(releaseState(input)).resolves.toEqual({
    npmPublished: state.npm,
    releaseExists: state.release,
  });
});

test("waits for npm to serve a published version before reading GitHub", async () => {
  let npmLookups = 0;
  let releaseLookups = 0;
  server.use(
    http.get(npmUrl, () => {
      npmLookups += 1;
      return npmLookups < 3
        ? new HttpResponse(null, { status: 404 })
        : HttpResponse.json(published);
    }),
    http.get(releaseUrl, () => {
      releaseLookups += 1;
      return new HttpResponse(null, { status: 404 });
    }),
  );
  await expect(
    releaseState({ ...input, npmWait: { timeoutMs: 60_000, intervalMs: 1 } }),
  ).resolves.toEqual({ npmPublished: true, releaseExists: false });
  expect(releaseLookups).toBe(1);
});

test("stops waiting when npm does not serve the version in time", async () => {
  server.use(http.get(npmUrl, () => new HttpResponse(null, { status: 404 })));
  await expect(
    releaseState({ ...input, npmWait: { timeoutMs: 20, intervalMs: 5 } }),
  ).rejects.toThrow("npm is not serving @hiro5409/attio-cli@0.1.0");
});

test("stops waiting when the npm lookup fails", async () => {
  let npmLookups = 0;
  server.use(
    http.get(npmUrl, () => {
      npmLookups += 1;
      return new HttpResponse(null, { status: npmLookups < 2 ? 404 : 503 });
    }),
  );
  await expect(
    releaseState({ ...input, npmWait: { timeoutMs: 60_000, intervalMs: 1 } }),
  ).rejects.toThrow("HTTP 503");
  expect(npmLookups).toBe(2);
});

test("stops waiting when npm serves different contents", async () => {
  let npmLookups = 0;
  server.use(
    http.get(npmUrl, () => {
      npmLookups += 1;
      return npmLookups < 2
        ? new HttpResponse(null, { status: 404 })
        : HttpResponse.json({ dist: { integrity: "different" } });
    }),
  );
  await expect(
    releaseState({ ...input, npmWait: { timeoutMs: 60_000, intervalMs: 1 } }),
  ).rejects.toThrow("Published npm artifact differs");
});

test.each([403, 429, 500])("does not interpret HTTP %i as unpublished", async (status) => {
  server.use(http.get(npmUrl, () => new HttpResponse(null, { status })));
  await expect(releaseState(input)).rejects.toThrow(`HTTP ${status}`);
});

test("stops when an existing npm version has different contents", async () => {
  server.use(http.get(npmUrl, () => HttpResponse.json({ dist: { integrity: "different" } })));
  await expect(releaseState(input)).rejects.toThrow("Published npm artifact differs");
});

test("stops when the GitHub lookup fails after npm publication", async () => {
  server.use(
    http.get(npmUrl, () => HttpResponse.json(published)),
    http.get(releaseUrl, () => new HttpResponse(null, { status: 503 })),
  );
  await expect(releaseState(input)).rejects.toThrow("HTTP 503");
});

test("does not overwrite a different existing release asset", async () => {
  server.use(
    http.get(npmUrl, () => HttpResponse.json(published)),
    http.get(releaseUrl, () => HttpResponse.json({ assets: [{ ...asset, digest: "different" }] })),
  );
  await expect(releaseState(input)).rejects.toThrow("Existing release asset differs");
});

test("stops when an existing release is missing the tested artifact", async () => {
  server.use(
    http.get(npmUrl, () => HttpResponse.json(published)),
    http.get(releaseUrl, () =>
      HttpResponse.json({
        draft: false,
        assets: [{ ...asset, name: "hiro5409-attio-cli-0.0.9.tgz" }],
      }),
    ),
  );
  await expect(releaseState(input)).rejects.toThrow(
    "Existing release is missing hiro5409-attio-cli-0.1.0.tgz",
  );
});
