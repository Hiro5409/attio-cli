import { readFileSync } from "node:fs";

import { http, HttpResponse } from "msw";
import * as v from "valibot";
import { describe, expect, test, vi } from "vite-plus/test";

import { main } from "./cli.ts";
import { server } from "./test/server.ts";
import { groups } from "./types/attio/commands.gen.ts";
import {
  handleDeleteV2ObjectsByObjectRecordsByRecordId,
  handleGetV2Files,
  handleGetV2Self,
  handleGetV2Tasks,
  handlePostV2ObjectsByObjectRecordsQuery,
  handlePutV2ObjectsByObjectRecords,
} from "./types/attio/msw.gen.ts";

async function run(argv: string[], env: Record<string, string | undefined> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...parts) => {
    stdout.push(parts.join(" "));
  });
  const error = vi.spyOn(console, "error").mockImplementation((...parts) => {
    stderr.push(parts.join(" "));
  });
  try {
    const exitCode = await main(argv, env);
    return { exitCode, stderr: stderr.join("\n"), stdout: stdout.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

const activeToken = {
  active: true,
  aud: "5d8a1f0c-2b3e-4a6d-9c7f-0e1b2a3c4d5e",
  authorized_by_workspace_member_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  client_id: "5d8a1f0c-2b3e-4a6d-9c7f-0e1b2a3c4d5e",
  exp: null,
  iat: 1_760_270_000,
  iss: "attio.com",
  scope: "object_configuration:read record_permission:read-write",
  sub: "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f",
  token_level: "workspace",
  token_type: "Bearer",
  workspace_id: "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f",
  workspace_logo_url: null,
  workspace_name: "Example",
  workspace_slug: "example",
};

describe("attio-api meta identify", () => {
  test("prints the access token's workspace and scopes as JSON", async () => {
    server.use(
      handleGetV2Self(({ request }) =>
        request.headers.get("authorization") === "Bearer test-token"
          ? HttpResponse.json(activeToken)
          : HttpResponse.json({ active: false }),
      ),
    );

    const result = await run(["meta", "identify"], { ATTIO_ACCESS_TOKEN: "test-token" });

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify(activeToken, null, 2),
    });
  });

  test.each([
    ["--profile", "acme", "meta", "identify"],
    ["meta", "--profile", "acme", "identify"],
    ["meta", "identify", "--profile=acme"],
  ])("selects the named profile with %j", async (...argv) => {
    const tokens: (string | null)[] = [];
    server.use(
      handleGetV2Self(({ request }) => {
        tokens.push(request.headers.get("authorization"));
        return HttpResponse.json(activeToken);
      }),
    );

    const result = await run(argv, {
      ATTIO_ACCESS_TOKEN: "default-token",
      ATTIO_ACCESS_TOKEN_ACME: "acme-token",
    });

    expect(result.exitCode).toBe(0);
    expect(tokens).toEqual(["Bearer acme-token"]);
  });

  test("rejects a missing profile token without falling back to the default token", async () => {
    const requests: Request[] = [];
    server.use(
      handleGetV2Self(({ request }) => {
        requests.push(request);
        return HttpResponse.json(activeToken);
      }),
    );

    const result = await run(["meta", "identify", "--profile", "missing"], {
      ATTIO_ACCESS_TOKEN: "default-token",
      ATTIO_ACCESS_TOKEN_ACME: "acme-token",
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: "AUTH_REQUIRED",
        hint: "Set ATTIO_ACCESS_TOKEN_MISSING to an Attio access token.",
        message: 'No Attio access token is configured for profile "missing".',
      },
    });
    expect(requests).toEqual([]);
  });

  test.each(["", "Acme", "acme-inc", "../acme"])(
    "rejects an invalid profile name %j before making a request",
    async (profile) => {
      const result = await run(["meta", "identify", `--profile=${profile}`], {
        ATTIO_ACCESS_TOKEN: "default-token",
      });

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
    },
  );

  test.each([
    { argv: ["meta", "identify"], variable: "ATTIO_ACCESS_TOKEN" },
    { argv: ["meta", "identify", "--profile", "acme"], variable: "ATTIO_ACCESS_TOKEN_ACME" },
  ])("does not disclose malformed $variable in errors", async ({ argv, variable }) => {
    const token = "fake-token-prefix\nfake-token-suffix";
    const result = await run(argv, { [variable]: token });

    expect(result.stderr).not.toContain("fake-token-prefix");
    expect(result.stderr).not.toContain("fake-token-suffix");
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
  });

  test("asks for an access token before sending anything when none is configured", async () => {
    const result = await run(["meta", "identify"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: "AUTH_REQUIRED",
        hint: "Set ATTIO_ACCESS_TOKEN to an Attio access token.",
        message: "No Attio access token is configured.",
      },
    });
  });

  test.each([
    { code: "BAD_REQUEST", exitCode: 2, status: 400 },
    { code: "UNAUTHORIZED", exitCode: 2, status: 401 },
    { code: "FORBIDDEN", exitCode: 3, status: 403 },
    { code: "NOT_FOUND", exitCode: 1, status: 404 },
    { code: "RATE_LIMITED", exitCode: 4, status: 429 },
    { code: "API_ERROR", exitCode: 1, status: 409 },
    { code: "API_ERROR", exitCode: 1, status: 500 },
  ])("reports HTTP $status from Attio as $code", async ({ code, exitCode, status }) => {
    server.use(
      handleGetV2Self(() =>
        HttpResponse.json(
          {
            code: "attio_reason",
            message: "Attio explains the failure.",
            status_code: status,
            type: "attio_error_type",
          },
          { status },
        ),
      ),
    );

    const result = await run(["meta", "identify"], { ATTIO_ACCESS_TOKEN: "test-token" });

    expect(result.exitCode).toBe(exitCode);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        attio: { code: "attio_reason", type: "attio_error_type" },
        code,
        message: "Attio explains the failure.",
        status,
      },
    });
  });

  test.each([
    { hinted: false, status: 409 },
    { hinted: true, status: 500 },
  ])("warns that a write may have been processed after HTTP $status: $hinted", async (c) => {
    server.use(handleGetV2Self(() => HttpResponse.json({}, { status: c.status })));

    const result = await run(["meta", "identify"], { ATTIO_ACCESS_TOKEN: "test-token" });

    expect("hint" in JSON.parse(result.stderr).error).toBe(c.hinted);
  });

  test("prints a response that departs from the published schema as Attio returned it", async () => {
    const response = { active: true, scope: null, undocumented: "field" };
    server.use(handleGetV2Self(() => HttpResponse.json(response)));

    const result = await run(["meta", "identify"], { ATTIO_ACCESS_TOKEN: "test-token" });

    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: JSON.stringify(response, null, 2) });
  });
});

describe("attio-api", () => {
  test.each([[], ["meta"], ["meta", "identify"]])(
    "explains --profile without credentials at %j",
    async (...argv) => {
      const result = await run([...argv, "--profile", "acme", "--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("--profile");
    },
  );

  test.each([
    { argv: ["meta", "identify", "--format", "table"], name: "an unknown option" },
    {
      argv: ["meta", "identify", "--dry-run"],
      name: "--dry-run on a command that deletes nothing",
    },
    { argv: ["meta", "identify", "extra"], name: "an unexpected argument" },
    { argv: ["nonexistent"], name: "an unknown command" },
    { argv: [], name: "no command" },
    { argv: ["records"], name: "a group without a command" },
  ])("rejects $name as a usage error without calling Attio", async ({ argv }) => {
    const result = await run(argv, { ATTIO_ACCESS_TOKEN: "test-token" });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
  });

  test("reports an unreadable JSON response as UNEXPECTED", async () => {
    server.use(
      handleGetV2Self(
        () => new HttpResponse("invalid-json", { headers: { "Content-Type": "application/json" } }),
      ),
    );

    const result = await run(["meta", "identify"], { ATTIO_ACCESS_TOKEN: "test-token" });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: "UNEXPECTED" } });
  });

  test("reports a failed connection separately from an Attio error", async () => {
    server.use(handleGetV2Self(() => HttpResponse.error()));

    const result = await run(["meta", "identify"], { ATTIO_ACCESS_TOKEN: "test-token" });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: "NETWORK_ERROR" } });
  });
});

describe("attio-api files list-files", () => {
  test("sends its options as the query and prints Attio's response", async () => {
    const requests: Request[] = [];
    const files = { data: [], pagination: { next_cursor: null } };
    server.use(
      handleGetV2Files(({ request }) => {
        requests.push(request);
        return HttpResponse.json(files);
      }),
    );

    const result = await run(
      [
        "files",
        "list-files",
        "--object",
        "companies",
        "--record-id",
        "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f",
        "--limit",
        "10",
      ],
      { ATTIO_ACCESS_TOKEN: "test-token" },
    );

    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: JSON.stringify(files, null, 2) });
    expect(requests).toHaveLength(1);
    const [request] = requests;
    const url = new URL(request?.url ?? "");
    expect(request?.method).toBe("GET");
    expect(request?.headers.get("authorization")).toBe("Bearer test-token");
    expect(request?.headers.get("accept")).toBe("application/json");
    expect(url.origin + url.pathname).toBe("https://api.attio.com/v2/files");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: "10",
      object: "companies",
      record_id: "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f",
    });
  });
});

describe("attio-api records delete-a-record", () => {
  const recordId = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";
  const argv = ["records", "delete-a-record", "--object", "companies", "--record-id", recordId];
  const url = `https://api.attio.com/v2/objects/companies/records/${recordId}`;

  function countDeletes() {
    const urls: string[] = [];
    server.use(
      handleDeleteV2ObjectsByObjectRecordsByRecordId(({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({});
      }),
    );
    return urls;
  }

  test("prints the request and sends nothing with --dry-run", async () => {
    const sent = countDeletes();

    const result = await run([...argv, "--dry-run"], { ATTIO_ACCESS_TOKEN: "test-token" });

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ dry_run: true, method: "DELETE", url }, null, 2),
    });
    expect(sent).toEqual([]);
  });

  test("deletes the record without --dry-run", async () => {
    const sent = countDeletes();

    const result = await run(argv, { ATTIO_ACCESS_TOKEN: "test-token" });

    expect(result.exitCode).toBe(0);
    expect(sent).toEqual([url]);
  });
});

describe("attio-api tasks list-tasks", () => {
  test.each([
    { argv: ["--is-completed"], sent: "true" },
    { argv: ["--no-is-completed"], sent: "false" },
    { argv: ["--is-completed=false"], sent: "false" },
    { argv: [], sent: null },
  ])("sends is_completed=$sent for $argv", async ({ argv, sent }) => {
    const queries: (string | null)[] = [];
    server.use(
      handleGetV2Tasks(({ request }) => {
        queries.push(new URL(request.url).searchParams.get("is_completed"));
        return HttpResponse.json({ data: [] });
      }),
    );

    const result = await run(["tasks", "list-tasks", ...argv], {
      ATTIO_ACCESS_TOKEN: "test-token",
    });

    expect(result.exitCode).toBe(0);
    expect(queries).toEqual([sent]);
  });
});

describe("attio-api records list-records", () => {
  test("puts the object in the path and sends the body as given", async () => {
    const requests: { body: unknown; method: string; url: string }[] = [];
    server.use(
      handlePostV2ObjectsByObjectRecordsQuery(async ({ request }) => {
        requests.push({ body: await request.json(), method: request.method, url: request.url });
        return HttpResponse.json({ data: [] });
      }),
    );

    const result = await run(
      ["records", "list-records", "--object", "companies", "--body", '{"limit":5,"offset":10}'],
      { ATTIO_ACCESS_TOKEN: "test-token" },
    );

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ data: [] }, null, 2),
    });
    expect(requests).toEqual([
      {
        body: { limit: 5, offset: 10 },
        method: "POST",
        url: "https://api.attio.com/v2/objects/companies/records/query",
      },
    ]);
  });
});

describe("attio-api records upsert-a-record", () => {
  test("sends values in Attio's shorthand as given, leaving their validation to Attio", async () => {
    const requests: { body: unknown; method: string; url: string }[] = [];
    server.use(
      handlePutV2ObjectsByObjectRecords(async ({ request }) => {
        requests.push({ body: await request.json(), method: request.method, url: request.url });
        return HttpResponse.json({ code: "x", message: "stop here", type: "x" }, { status: 400 });
      }),
    );
    const body = { data: { values: { domains: ["example.com"], name: "Example", priority: "A" } } };

    await run(
      [
        "records",
        "upsert-a-record",
        "--object",
        "companies",
        "--matching-attribute",
        "domains",
        "--body",
        JSON.stringify(body),
      ],
      { ATTIO_ACCESS_TOKEN: "test-token" },
    );

    expect(requests).toEqual([
      {
        body,
        method: "PUT",
        url: "https://api.attio.com/v2/objects/companies/records?matching_attribute=domains",
      },
    ]);
  });

  test.each([
    {
      argv: ["records", "upsert-a-record", "--object", "companies", "--body", "{}"],
      name: "a missing required option",
    },
    {
      argv: [
        "records",
        "upsert-a-record",
        "--object",
        "companies",
        "--matching-attribute",
        "domains",
      ],
      name: "a missing required body",
    },
    {
      argv: [
        "records",
        "upsert-a-record",
        "--object",
        "companies",
        "--matching-attribute",
        "domains",
        "--body",
        "{not json",
      ],
      name: "a body that is not JSON",
    },
  ])("rejects $name before sending anything", async ({ argv }) => {
    const result = await run(argv, { ATTIO_ACCESS_TOKEN: "test-token" });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
  });
});

describe("rate limiting", () => {
  const rateLimited = () =>
    HttpResponse.json(
      {
        code: "rate_limit_exceeded",
        message: "Rate limit exceeded, please try again later",
        status_code: 429,
        type: "rate_limit_error",
      },
      { headers: { "Retry-After": "0" }, status: 429 },
    );

  test("retries a read that Attio rate limited", async () => {
    let calls = 0;
    server.use(
      handleGetV2Self(() => {
        calls += 1;
        return calls === 1 ? rateLimited() : HttpResponse.json({ active: false });
      }),
    );

    const result = await run(["meta", "identify"], { ATTIO_ACCESS_TOKEN: "test-token" });

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ active: false }, null, 2),
    });
    expect(calls).toBe(2);
  });

  test("retries a write that Attio rate limited, because Attio did not process it", async () => {
    let calls = 0;
    server.use(
      handlePostV2ObjectsByObjectRecordsQuery(() => {
        calls += 1;
        return calls === 1 ? rateLimited() : HttpResponse.json({ data: [] });
      }),
    );

    const result = await run(["records", "list-records", "--object", "companies", "--body", "{}"], {
      ATTIO_ACCESS_TOKEN: "test-token",
    });

    expect(result.exitCode).toBe(0);
    expect(calls).toBe(2);
  });

  test("reports a write that stays rate limited as RATE_LIMITED once the retries run out", async () => {
    let calls = 0;
    server.use(
      handlePostV2ObjectsByObjectRecordsQuery(() => {
        calls += 1;
        return rateLimited();
      }),
    );

    const result = await run(["records", "list-records", "--object", "companies", "--body", "{}"], {
      ATTIO_ACCESS_TOKEN: "test-token",
    });

    expect(result.exitCode).toBe(4);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { attio: { code: "rate_limit_exceeded" }, code: "RATE_LIMITED", status: 429 },
    });
    expect(calls).toBe(3);
  });

  test("sends a write once when the connection fails, because Attio may have processed it", async () => {
    let calls = 0;
    server.use(
      handlePostV2ObjectsByObjectRecordsQuery(() => {
        calls += 1;
        return HttpResponse.error();
      }),
    );

    const result = await run(["records", "list-records", "--object", "companies", "--body", "{}"], {
      ATTIO_ACCESS_TOKEN: "test-token",
    });

    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: "NETWORK_ERROR" } });
    expect(calls).toBe(1);
  });
});

describe("attio-api --help", () => {
  test("describes each group of commands in Attio's own words", async () => {
    const result = await run(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(
      /^\s+meta\s+Meta endpoints are used to get information about the API token\.$/m,
    );
    expect(result.stdout).toMatch(
      /^\s+threads\s+Threads are groups of comments on either a record or entry\.$/m,
    );
    expect(result.stdout).toMatch(
      /^\s+records\s+Records are individual instances of objects e\.g\. a specific person or company\.$/m,
    );
  });
});

describe("attio-api records upsert-a-record --help", () => {
  test("links the page of Attio's API reference that documents the body", async () => {
    const result = await run(["records", "upsert-a-record", "--help"]);

    expect(result.stdout).toContain(
      "https://docs.attio.com/rest-api/endpoint-reference/records/upsert-a-record",
    );
  });

  test("shows an example built from the samples in Attio's schema", async () => {
    const result = await run(["records", "upsert-a-record", "--help"]);

    expect(result.stdout).toContain(
      `attio-api records upsert-a-record --object people --matching-attribute 41252299-f8c7-4b5e-99c9-4ff8321d2f96 --body '{"data":{"values":{`,
    );
  });
});

describe("every generated command", () => {
  const commands = Object.entries(groups).flatMap(([group, members]) =>
    Object.entries(members.commands).map(([name, { example, method }]) => ({
      example,
      group,
      method,
      name,
    })),
  );

  test("covers every operation in the schema except the two files operations left out", () => {
    const Schema = v.object({ paths: v.record(v.string(), v.record(v.string(), v.unknown())) });
    const schema = v.parse(
      Schema,
      JSON.parse(readFileSync(new URL("../openapi/attio-api.json", import.meta.url), "utf8")),
    );
    const methods = new Set(["delete", "get", "patch", "post", "put"]);
    const operations = Object.values(schema.paths).flatMap((path) =>
      Object.keys(path).filter((key) => methods.has(key)),
    );

    expect(commands).toHaveLength(operations.length - 2);
  });

  test.each(commands)("attio-api $group $name explains itself without a token", async (command) => {
    const result = await run([command.group, command.name, "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`attio-api ${command.group} ${command.name}`);
    expect(result.stdout.includes("--dry-run")).toBe(command.method === "DELETE");
  });

  test.each(commands)("attio-api $group $name accepts its own example", async (command) => {
    server.use(http.all("https://api.attio.com/*", () => HttpResponse.json({})));

    const result = await run([command.group, command.name, ...command.example], {
      ATTIO_ACCESS_TOKEN: "test-token",
    });

    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "{}" });
  });
});
