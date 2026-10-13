import {
  $,
  type DefinePlugin,
  definePluginConfig,
  type IR,
  type Plugin,
} from "@hey-api/openapi-ts";
import * as v from "valibot";

type Options = {
  /** Operations that get no command, keyed by "METHOD /path", each with the reason. */
  exclude: Record<string, string>;
};

type UserConfig = Plugin.Name<"commands"> & Plugin.Hooks & Plugin.UserExports & Options;

type Config = Plugin.Name<"commands"> & Plugin.Hooks & Plugin.Exports & Options;

type CommandsPlugin = DefinePlugin<UserConfig, Config>;

declare module "@hey-api/shared" {
  interface PluginConfigMap {
    commands: CommandsPlugin["Types"];
  }
}

const TaggedSpec = v.object({
  tags: v.optional(v.array(v.object({ description: v.optional(v.string()), name: v.string() }))),
});

const OPTION_TYPES = new Set(["boolean", "integer", "string"]);
const RESERVED_OPTIONS = new Set(["body", "dry_run", "help", "version"]);

/** "Call recordings" becomes "call-recordings", the form Attio's documentation uses in its URLs. */
function kebab(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

/** The first sentence of a tag's description, with Markdown links reduced to their text. */
function summary(description: string | undefined): string {
  const text = (description ?? "").replaceAll(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // A sentence ends where the next one starts with a capital, so "e.g. a person" stays whole.
  return /^.*?\.(?=\s+[A-Z]|\s*$)/.exec(text)?.[0] ?? text;
}

/** The command-line option type for a path or query parameter. */
function optionType(parameter: IR.ParameterObject): string {
  const schema = parameter.schema;
  // An array's items would otherwise pass for the alternatives of a union.
  if (schema.type === "array") {
    throw new Error(`Unsupported array parameter "${parameter.name}".`);
  }
  // A nullable string arrives as a union of string and null; an enum of strings as an enum.
  const candidates = schema.items?.length ? schema.items : [schema];
  const types = new Set(candidates.map((item) => item.type).filter((type) => type !== "null"));
  const [type] = types;
  if (types.size !== 1 || !type || !OPTION_TYPES.has(type)) {
    throw new Error(
      `Unsupported parameter schema for "${parameter.name}": ${JSON.stringify(schema)}`,
    );
  }
  return type;
}

const handler: CommandsPlugin["Handler"] = ({ plugin }) => {
  const operation = plugin.symbolFactory.register("operation", {
    external: "../../commands/operation.ts",
  });
  const excluded = new Set(Object.keys(plugin.config.exclude));
  const groups = new Map<string, Map<string, ReturnType<typeof $.object>>>();

  plugin.forEach("operation", ({ operation: source }) => {
    const key = `${source.method.toUpperCase()} ${source.path}`;
    if (excluded.delete(key)) return;

    // Attio names every operation with one tag and a summary; its documentation URLs use the same pair.
    const [tag, ...otherTags] = source.tags ?? [];
    if (!tag || otherTags.length > 0 || !source.summary) {
      throw new Error(`${key} needs exactly one tag and a summary to be named.`);
    }
    const group = groups.get(kebab(tag)) ?? new Map<string, ReturnType<typeof $.object>>();
    groups.set(kebab(tag), group);
    const name = kebab(source.summary);
    if (group.has(name)) throw new Error(`${key} repeats the command "${kebab(tag)} ${name}".`);

    const meta = (extra: Record<string, string>) => ({
      resource: "operation",
      resourceId: source.id,
      ...extra,
    });
    const reference = (extra: Record<string, string>) =>
      $.lazy((ctx) => ctx.access(plugin.referenceSymbol(meta(extra))));

    const parameters = (["path", "query"] as const).flatMap((location) =>
      Object.values(source.parameters?.[location] ?? {}).map((parameter) => ({
        location,
        parameter,
      })),
    );
    const names = parameters.map(({ parameter }) => parameter.name);
    if (new Set(names).size !== names.length || names.some((item) => RESERVED_OPTIONS.has(item))) {
      throw new Error(`${key} has parameters that cannot become options: ${names.join(", ")}`);
    }

    group.set(
      name,
      $.object()
        .pretty()
        .prop(
          "body",
          $.literal(source.body ? (source.body.required ? "required" : "optional") : "none"),
        )
        .prop("call", reference({ category: "sdk" }))
        .prop("description", $.literal(source.summary))
        .prop("method", $.literal(source.method.toUpperCase()))
        .prop(
          "options",
          $.array(
            ...parameters.map(({ location, parameter }) =>
              $.object()
                .prop(
                  "description",
                  $.literal(parameter.description ?? parameter.schema.description ?? ""),
                )
                .prop("in", $.literal(location))
                .prop("name", $.literal(parameter.name))
                .prop("required", $.literal(parameter.required ?? false))
                .prop("type", $.literal(optionType(parameter))),
            ),
          ),
        ),
    );
  });

  if (excluded.size > 0) {
    throw new Error(`Excluded operations the schema does not have: ${[...excluded].join(", ")}`);
  }

  const { tags = [] } = v.parse(TaggedSpec, plugin.context.spec);
  const descriptions = new Map(tags.map((tag) => [kebab(tag.name), summary(tag.description)]));
  const commandGroups = $.object().pretty();
  for (const [group, members] of groups) {
    const groupCommands = $.object().pretty();
    for (const [name, definition] of members) {
      groupCommands.prop(name, $(operation).call(definition));
    }
    commandGroups.prop(
      group,
      $.object()
        .pretty()
        .prop("commands", groupCommands)
        .prop("description", $.literal(descriptions.get(group) ?? "")),
    );
  }
  plugin.node($.const(plugin.symbol("groups")).export().assign(commandGroups));
};

export const commands = definePluginConfig<CommandsPlugin["Types"]>({
  config: { exclude: {} },
  dependencies: ["@hey-api/sdk"],
  handler,
  name: "commands",
});
