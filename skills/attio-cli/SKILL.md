---
name: attio-cli
description: Use when reading or changing an Attio workspace through the attio-api CLI, including records, list entries, attributes, notes, tasks, and webhooks.
license: MIT
metadata:
  source: https://github.com/Hiro5409/attio-cli
---

# attio-cli

Probe with `command -v attio-api && attio-api --version`.
If unavailable, install with `npm install --global @hiro5409/attio-cli`.

1. Use `attio-api --help` and `attio-api <group> --help` as the supported command surface. Each command carries the name of its page in Attio's API reference: "Upsert a record" is `attio-api records upsert-a-record`.
   Read the selected command's `--help` for its options.
2. Start with `attio-api meta identify`. An access token belongs to one workspace; confirm the reported workspace is the intended one and that its scopes cover the task.
   For a missing token, have `ATTIO_ACCESS_TOKEN` supplied through the execution environment. Keep tokens out of command arguments, logs, and repository files.
3. `--help` names `--body` without describing its shape. Take the shape from the command's page, `https://docs.attio.com/rest-api/endpoint-reference/<group>/<command>`, and pass it as one JSON string.
4. Resolve what a write refers to with read commands first: `objects list-objects`, `lists list-all-lists`, `attributes list-attributes`, `attributes list-select-options`, `attributes list-statuses`. Write with the slugs and IDs they return; a select or status value must already exist as an option.
5. To create something that may already exist, use the upsert commands with a unique matching attribute, so that repeating the command changes nothing.
6. Each command returns one page. With `limit` and `offset`, continue until a page comes back short; with a cursor, continue while the response carries a next cursor.
7. Before a delete, run the same command with `--dry-run` and check that the request it prints names the target you mean.

A command succeeded when it exits with 0 and prints parseable JSON; check a write's returned values against the requested ones.

On failure, read `error.code` and `error.hint` from stderr. `INVALID_ARGUMENT` means the command line was wrong and nothing was sent. `BAD_REQUEST` means Attio rejected the options or the body: correct them against `error.message` and the command's page. `FORBIDDEN` means Attio denied the operation; `error.message` says whether a scope, access to the resource, or the workspace's plan is missing, and only the workspace's owner can change that. After `NETWORK_ERROR` or `API_ERROR` on a write, read the target back before sending the write again.
