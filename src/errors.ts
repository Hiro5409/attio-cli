import * as v from "valibot";

type CliErrorCode =
  | "API_ERROR"
  | "AUTH_REQUIRED"
  | "BAD_REQUEST"
  | "FORBIDDEN"
  | "INVALID_ARGUMENT"
  | "NETWORK_ERROR"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UNAUTHORIZED";

type CliErrorOptions = {
  /** The error type and code Attio reported, kept so callers can branch on Attio's own vocabulary. */
  attio?: { code?: string; type?: string };
  code: CliErrorCode;
  exitCode: number;
  hint?: string;
  status?: number;
};

export class CliError extends Error {
  readonly options: CliErrorOptions;

  constructor(message: string, options: CliErrorOptions) {
    super(message);
    this.name = "CliError";
    this.options = options;
  }
}

const AttioErrorBody = v.object({
  code: v.optional(v.string()),
  message: v.optional(v.string()),
  type: v.optional(v.string()),
});

const HTTP_FAILURES: Record<number, Pick<CliErrorOptions, "code" | "exitCode" | "hint">> = {
  400: {
    code: "BAD_REQUEST",
    exitCode: 2,
    hint: "Correct the options or the body against the operation's page in Attio's API reference.",
  },
  401: {
    code: "UNAUTHORIZED",
    exitCode: 2,
    hint: "Set ATTIO_ACCESS_TOKEN to a valid Attio access token.",
  },
  403: {
    code: "FORBIDDEN",
    exitCode: 3,
    hint: "Attio's message names what is missing: a scope on the token, access to the resource, or a plan that allows the operation.",
  },
  404: { code: "NOT_FOUND", exitCode: 1 },
  429: { code: "RATE_LIMITED", exitCode: 4, hint: "Wait before running the command again." },
};

/** A server failure leaves open whether Attio carried the request out. */
function serverFailureHint(status: number): string | undefined {
  return status >= 500 ? "A write may have reached Attio, so check before retrying." : undefined;
}

/** Turns an HTTP failure and the body Attio sent with it into a CLI error. */
export function httpError(status: number, body: unknown): CliError {
  const parsed = v.safeParse(AttioErrorBody, body);
  const { code, message, type } = parsed.success ? parsed.output : {};
  return new CliError(message || `Attio returned HTTP ${status}.`, {
    ...(HTTP_FAILURES[status] ?? {
      code: "API_ERROR",
      exitCode: 1,
      hint: serverFailureHint(status),
    }),
    attio: { code, type },
    status,
  });
}

/** Describes a command line that the CLI cannot act on. */
export function usageError(message: string): CliError {
  return new CliError(message, { code: "INVALID_ARGUMENT", exitCode: 2 });
}

/** Describes a request that never produced a response from Attio. */
export function networkError(cause: unknown): CliError {
  const detail = cause instanceof Error && cause.message ? ` (${cause.message})` : "";
  return new CliError(`Could not reach Attio${detail}.`, {
    code: "NETWORK_ERROR",
    exitCode: 1,
    hint: "Check the network connection. A write may have reached Attio, so check before retrying.",
  });
}

/** Writes the failure to stderr as JSON and returns the process exit code. */
export function reportError(error: unknown): number {
  // Gunshi collects every problem with the command line into one AggregateError.
  if (error instanceof AggregateError) {
    const messages = error.errors.map((item) =>
      item instanceof Error ? item.message : String(item),
    );
    return reportError(
      usageError(messages.filter(Boolean).join("; ") || "Invalid command arguments."),
    );
  }
  if (error instanceof CliError) {
    const { exitCode, ...details } = error.options;
    console.error(JSON.stringify({ error: { ...details, message: error.message } }, null, 2));
    return exitCode;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ error: { code: "UNEXPECTED", message } }, null, 2));
  return 1;
}
