import { type Args, define } from "gunshi";

import { attioClient, type Environment } from "../api/client.ts";
import { usageError } from "../errors.ts";
import type { Client } from "../types/attio/client/index.ts";

type OperationOption = {
  description: string;
  in: "path" | "query";
  name: string;
  required: boolean;
  type: "boolean" | "integer" | "string";
};

type OperationDetails = {
  body: "none" | "optional" | "required";
  description: string;
  example: readonly string[];
  method: string;
  options: readonly OperationOption[];
};

type OperationInput = {
  body?: unknown;
  fetch?: typeof fetch;
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
};

/** One Attio API operation, ready to run against input taken from the command line. */
export type Operation = OperationDetails & {
  run: (client: Client, input: OperationInput) => Promise<unknown>;
};

/**
 * Wraps an SDK function so every operation runs the same way. Command-line input has no static
 * type, and Attio is what validates it.
 */
export function operation(
  definition: OperationDetails & {
    // `never` admits every SDK function, whatever options it declares.
    call: (options: never) => Promise<{ data: unknown }>;
  },
): Operation {
  const { call, ...details } = definition;
  return {
    ...details,
    run: async (client, input) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- command-line input has no static type; Attio validates it
      const { data } = await call({ ...input, client } as never);
      return data;
    },
  };
}

const ARGUMENT_TYPES = { boolean: "boolean", integer: "number", string: "string" } as const;

function optionName(parameter: string): string {
  return parameter.replaceAll("_", "-");
}

/** Answers with the request it was given instead of sending it. */
const preview: typeof fetch = (...input) => {
  const { method, url } = new Request(...input);
  return Promise.resolve(Response.json({ dry_run: true, method, url }));
};

/** Quotes an argument for a shell when it holds anything a shell would interpret. */
function quoted(argument: string): string {
  return /^[\w@%+=:,./<>-]+$/.test(argument) ? argument : `'${argument.replaceAll("'", `'\\''`)}'`;
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw usageError("--body must be valid JSON.");
  }
}

/** Builds the CLI command that runs one operation with the options given on the command line. */
export function operationCommand(group: string, name: string, source: Operation, env: Environment) {
  const args: Args = {};
  for (const option of source.options) {
    args[optionName(option.name)] = {
      description: option.description,
      // `--no-<option>` sends false, which Attio reads differently from leaving the option out.
      negatable: option.type === "boolean" || undefined,
      required: option.required || undefined,
      type: ARGUMENT_TYPES[option.type],
    };
  }
  if (source.body !== "none") {
    args.body = {
      // Attio names the page after the operation, as the generator names the command.
      description: `Request body as JSON, documented at https://docs.attio.com/rest-api/endpoint-reference/${group}/${name}`,
      required: source.body === "required" || undefined,
      type: "string",
    };
  }

  if (source.method === "DELETE") {
    args["dry-run"] = { description: "Print the request without sending it", type: "boolean" };
  }

  const example = ["attio-api", group, name, ...source.example].map(quoted).join(" ");
  const note = "# The body shows every field with a sample value; send the ones you need.";

  return define({
    name,
    description: source.description,
    // A command without arguments is its own example.
    examples:
      source.example.length === 0
        ? undefined
        : source.body === "none"
          ? example
          : `${note}\n${example}`,
    args,
    run: async (ctx) => {
      const values: Record<string, unknown> = ctx.values;
      const input: OperationInput = {};
      for (const option of source.options) {
        const value = values[optionName(option.name)];
        if (value !== undefined) (input[option.in] ??= {})[option.name] = value;
      }
      if (typeof values.body === "string") input.body = parseBody(values.body);
      if (values["dry-run"]) input.fetch = preview;
      const profile = typeof values.profile === "string" ? values.profile : undefined;
      return JSON.stringify(await source.run(attioClient(env, profile), input), null, 2);
    },
  });
}
