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

`attio-api --help`, a group's `--help`, and a command's `--help` are the command surface. A command carries the name of its page in Attio's API reference; its `--help` shows an example built from Attio's samples and links the page that documents `--body`.

For a named profile, pass `--profile <name>` to every command, including `meta identify`. It reads `ATTIO_ACCESS_TOKEN_<NAME>` with the name uppercased and fails if that token is missing.

1. Start with `meta identify` using the same profile as subsequent commands: a token belongs to one workspace, so confirm the workspace and the scopes it reports are the ones the task needs.
2. Resolve slugs and IDs with read commands before a write. A select or status value must already exist as an option.
3. To create something that may already exist, use an upsert command with a unique matching attribute, so that repeating it changes nothing.
4. Each command returns one page. With `limit` and `offset`, continue until a page comes back short; with a cursor, continue while the response carries a next cursor.
5. Before a delete, run the same command with `--dry-run` and check that the request it prints names the target you mean.

Check a write's returned values against the requested ones. On failure, act on `error.hint` and `error.message` from stderr.
