# attio-cli

An unofficial CLI for the [Attio API](https://docs.attio.com/rest-api/overview). Every command is generated from Attio's OpenAPI schema and carries the name Attio's own documentation gives the operation.

## Installation

Requires Node.js 24.11.0 or newer. macOS and Linux are supported; Windows is not tested. mise, pnpm, and Vite+ are development tools and are not required to use the npm package.

```sh
npm install --global @hiro5409/attio-cli
attio-api --version
attio-api --help
```

The command is `attio-api`. The `attio` command belongs to Attio's own CLI for building apps on its platform, and the two can be installed side by side.

## Authentication

Create an access token in Attio under Workspace settings → Developers, with the scopes the commands you run need, and provide it through the environment:

```sh
export ATTIO_ACCESS_TOKEN=…
attio-api meta identify
```

`meta identify` reports the token's workspace and scopes. The CLI reads the token from `ATTIO_ACCESS_TOKEN` only and stores nothing. Do not pass access tokens as command arguments or keep them in the repository; a secret manager that injects the variable into the command's environment keeps the token out of shell history.

## Usage

Commands are grouped the way Attio's API reference groups its operations, and each command is named after its page there. [Upsert a record](https://docs.attio.com/rest-api/endpoint-reference/records/upsert-a-record) is `attio-api records upsert-a-record`.

```sh
attio-api --help
attio-api records --help
attio-api records upsert-a-record --help
```

Path and query parameters are options; a boolean one is sent as false with `--no-<option>`. Operations that take a request body accept it as JSON through `--body`:

```sh
attio-api objects list-objects

attio-api attributes list-attributes --target objects --identifier companies

attio-api records list-records --object companies --body '{"limit": 10}'

attio-api records upsert-a-record --object companies --matching-attribute domains \
  --body '{"data": {"values": {"name": "Example", "domains": ["example.com"]}}}'

attio-api notes create-a-note --body "$(cat note.json)"
```

The body is the request body Attio documents for the operation, unchanged. Each command performs one operation and prints its response; to read a further page, pass the `offset` or `cursor` the operation documents.

Two operations have no command: uploading a file, which takes a multipart body, and downloading a file, which answers with a redirect.

## Output and failures

A successful command prints Attio's response to stdout as JSON and exits with 0. A failed command prints nothing to stdout and one JSON object to stderr:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "hint": "Attio's message names what is missing: a scope on the token, access to the resource, or a plan that allows the operation.",
    "attio": { "code": "…", "type": "…" },
    "status": 403,
    "message": "…"
  }
}
```

`code` is stable. `status` and `attio` appear when Attio answered, and `attio` carries the error code and type from Attio's own response.

| Exit code | `code`                                                             | Meaning                                                                                 |
| --------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 0         |                                                                    | Successful command or help                                                              |
| 1         | `API_ERROR`, `NOT_FOUND`, `NETWORK_ERROR`, `UNEXPECTED`            | Attio reported a failure or could not be reached, or the CLI itself failed              |
| 2         | `INVALID_ARGUMENT`, `BAD_REQUEST`, `AUTH_REQUIRED`, `UNAUTHORIZED` | The command line or the request is invalid, or the token is missing or rejected         |
| 3         | `FORBIDDEN`                                                        | Attio denied the operation: a missing scope, no access to the resource, or a plan limit |
| 4         | `RATE_LIMITED`                                                     | Attio is still rate limiting after the retries                                          |

`INVALID_ARGUMENT` comes from the command line itself: an unknown or missing option, or a body that is not JSON. No request reached Attio. The body's content is Attio's to validate, because Attio accepts shapes its schema does not describe, such as a single value where the schema shows a list; a rejected request is `BAD_REQUEST`, with Attio's explanation as the message. Responses are printed as Attio returned them.

Each attempt waits up to 10 seconds for Attio's response and up to 10 more for its body; a timeout is reported as `NETWORK_ERROR` without a retry. GET, PUT, and DELETE requests are retried up to twice after a rate limit, a server error, or a failed connection. POST and PATCH requests are retried only after a rate limit, because Attio does not process a rate-limited request. A retry waits as long as Attio's `Retry-After` header asks. After `NETWORK_ERROR` or a server error on a write, the write may have taken effect; check before repeating it.

During 0.x, minor releases may change commands; a command's name follows the summary in Attio's schema, so it changes when Attio renames the operation. Pin the version when depending on exact names.

## Agent skill

The [attio-cli skill](skills/attio-cli/SKILL.md) guides command discovery, authentication, and interpretation of failures. Install it for Codex with GitHub CLI's `gh skill` command:

```sh
gh skill install Hiro5409/attio-cli attio-cli --agent codex --scope user
```

Use `--agent claude-code` for Claude Code. The npm package also includes the skill under `skills/attio-cli`.

## Development

Install and [activate mise](https://mise.jdx.dev/getting-started.html), which provides the pinned tools:

```sh
mise trust
mise install
pnpm install --frozen-lockfile
lefthook install
vp pack
node bin/attio-api --help
```

`bin/attio-api` runs the build in `dist`, so run `vp pack` again after changing the source. The pnpm version is declared in both `mise.toml` and `package.json`; change them together.

## API schema

Everything under `src/types/attio` is generated from the committed OpenAPI snapshot, `openapi/attio-api.json`. A new operation in the schema becomes a command without further work; `openapi-ts.config.ts` lists the operations left out, each with the reason.

Check whether Attio's published schema changed, then update the snapshot and regenerate:

```sh
vp run api-schema:check
vp run api-schema:update
vp run generate-types
```

`@hey-api/openapi-ts` and `@hey-api/shared` are pinned to the same snapshot release and move together.

## Quality checks

```sh
vp run check
```

The tests run commands end to end and replace only Attio's HTTP API. To check a packed artifact the way the CI does, without contacting Attio:

```sh
package_dir=$(mktemp -d)
pnpm pack --pack-destination "$package_dir"
node scripts/check-package.ts "$package_dir"/*.tgz
```

## Dependency updates

Dependabot proposes the updates, and a maintainer reviews and merges them. The generator packages and Vite+ are updated by hand, because each moves together with other pins.

Dependency Review needs the repository's [dependency graph](https://docs.github.com/en/code-security/reference/supply-chain-security/dependency-graph-supported-package-ecosystems) to be enabled.

## Releases

A maintainer releases from `main`: commit the new `version` in `package.json`, push the commit to `main`, then push the annotated tag for that version:

```sh
git tag -a v1.2.3
git push origin v1.2.3
```

`git tag -a` opens an editor for the tag message; list there, as Markdown bullets, the changes a user will notice. The message becomes the GitHub Release notes.

The tag starts the Release workflow, which publishes the tested artifact to npm and then creates the GitHub Release from it.

Before publishing, configure three settings outside the repository:

- A GitHub environment `npm` whose deployment policy allows only `v*` tags.
- An npm [trusted publisher](https://docs.npmjs.com/trusted-publishers/) for user `Hiro5409`, repository `attio-cli`, workflow filename `release.yml`, and environment `npm`, with `npm publish` allowed and `npm dist-tag` left unchecked.
- [Immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases) for the repository, so that the tag and the attached artifact of a published GitHub Release cannot change.

To retry a failed run, run the workflow again from its tag. A rerun publishes only what is still missing:

```sh
gh workflow run release.yml --ref v1.2.3
```

## License

[MIT](LICENSE). This project is not affiliated with Attio.
