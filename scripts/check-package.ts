import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tarball = process.argv[2];
if (!tarball) throw new Error("Usage: node scripts/check-package.ts <package.tgz>");
const directory = mkdtempSync(join(tmpdir(), "attio-cli-package-"));
console.log(`Checking installed package in ${directory}`);
writeFileSync(join(directory, "package.json"), '{"private":true,"type":"module"}\n');

function run(command: string, args: string[], expectedStatus = 0) {
  // The checks never reach Attio: no token is set, so every command stops before sending.
  const { ATTIO_ACCESS_TOKEN: _token, ...env } = process.env;
  const result = spawnSync(command, args, {
    cwd: directory,
    encoding: "utf8",
    env,
    timeout: 120_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return result;
}

run("npm", ["install", "--no-audit", "--no-fund", resolve(tarball)]);

const cli = join(directory, "node_modules/.bin/attio-api");
const manifest: unknown = JSON.parse(
  readFileSync(join(directory, "node_modules/@hiro5409/attio-cli/package.json"), "utf8"),
);
assert.ok(manifest && typeof manifest === "object" && "version" in manifest);
assert.equal(run(cli, ["--version"]).stdout.trim(), manifest.version);
assert.match(run(cli, ["--help"]).stdout, /records/);
assert.match(run(cli, ["records", "upsert-a-record", "--help"]).stdout, /--matching-attribute/);

const unauthenticated = run(cli, ["meta", "identify"], 2);
assert.equal(unauthenticated.stdout, "");
assert.match(unauthenticated.stderr, /"code": "AUTH_REQUIRED"/);

const invalid = run(cli, ["nonexistent"], 2);
assert.equal(invalid.stdout, "");
assert.match(invalid.stderr, /"code": "INVALID_ARGUMENT"/);

console.log("Installed CLI checks passed.");
