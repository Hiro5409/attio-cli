import { cli, define } from "gunshi";
import { plugin } from "gunshi/plugin";
import { renderHeader } from "gunshi/renderer";

import type { Environment } from "./api/client.ts";
import { type Operation, operationCommand } from "./commands/operation.ts";
import { reportError, usageError } from "./errors.ts";
import { groups } from "./types/attio/commands.gen.ts";

type Command = ReturnType<typeof define>;

const rootCommand = define({
  name: "attio-api",
  description: "Agent-friendly access to the Attio API",
  run: () => {
    throw usageError('No command given. Run "attio-api --help".');
  },
});

type Group = { commands: Record<string, Operation>; description: string };

/** One command per group of operations, with the group's operations beneath it. */
function commandTree(env: Environment): Record<string, Command> {
  const tree: Record<string, Command> = {};
  for (const [group, { commands, description }] of Object.entries<Group>(groups)) {
    const subCommands: Record<string, Command> = {};
    for (const [name, source] of Object.entries(commands)) {
      subCommands[name] = operationCommand(group, name, source, env);
    }
    tree[group] = define({
      name: group,
      description,
      run: () => {
        throw usageError(`No ${group} command given. Run "attio-api ${group} --help".`);
      },
      subCommands,
    });
  }
  return tree;
}

export async function main(
  argv: string[] = process.argv.slice(2),
  env: Environment = process.env,
): Promise<number> {
  try {
    const pkg = await import("../package.json", { with: { type: "json" } });

    await cli(argv, rootCommand, {
      name: "attio-api",
      version: pkg.default.version,
      strict: true,
      plugins: [
        plugin({
          id: "attio:profile",
          setup: (ctx) => {
            ctx.addGlobalOption("profile", {
              description: "Use ATTIO_ACCESS_TOKEN_<NAME> for the named profile",
              type: "string",
            });
          },
        }),
      ],
      subCommands: commandTree(env),
      // A header on every run would precede the JSON that scripts and agents parse.
      renderHeader: (ctx) => (ctx.values.help ? renderHeader(ctx) : Promise.resolve("")),
      // Usage problems go to stderr as JSON, like every other failure.
      renderValidationErrors: null,
      onBeforeCommand: (ctx) => {
        // Strict mode rejects unknown options only; no command takes positional arguments.
        if (ctx.validationError || ctx.values.help || ctx.values.version) return;
        const unexpected = [...ctx.positionals.slice(ctx.commandPath.length), ...ctx.rest];
        if (unexpected.length > 0) throw usageError(`Unexpected argument: ${unexpected.join(" ")}`);
      },
      onAfterCommand: (ctx, result) => {
        if (ctx.values.help || ctx.values.version) return;
        if (result) console.log(result);
      },
    });
    return 0;
  } catch (error) {
    return reportError(error);
  }
}
