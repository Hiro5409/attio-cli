import ky, { isHTTPError, type RetryOptions } from "ky";

import { CliError, httpError, networkError } from "../errors.ts";
import { type Client, createClient } from "../types/attio/client/index.ts";

export type Environment = Record<string, string | undefined>;

/** The methods Ky does not repeat by default, because repeating them is not safe in general. */
const WRITE_METHODS = new Set(["PATCH", "POST"]);

/** Attio does not process a rate-limited request, so that is the one failure after which a write is repeated. */
const writeRetry: RetryOptions = {
  methods: ["patch", "post"],
  shouldRetry: ({ error }) => isHTTPError(error) && error.response.status === 429,
};

/** Sends a request through Ky for its timeout and its retries. */
async function transport(...input: Parameters<typeof fetch>): Promise<Response> {
  const request = new Request(...input);
  const pending = ky(request, WRITE_METHODS.has(request.method) ? { retry: writeRetry } : {});
  // Ky's timeout covers a body only when Ky reads it, so the body is read here and handed on whole.
  const [response, body] = await Promise.all([pending, pending.text()]);
  return new Response(body || null, response);
}

export function attioClient(env: Environment): Client {
  const accessToken = env.ATTIO_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    throw new CliError("No Attio access token is configured.", {
      code: "AUTH_REQUIRED",
      exitCode: 2,
      hint: "Set ATTIO_ACCESS_TOKEN to an Attio access token.",
    });
  }

  const client = createClient({
    auth: accessToken,
    baseUrl: "https://api.attio.com",
    fetch: transport,
    throwOnError: true,
  });
  client.interceptors.error.use((error, response) => {
    // Ky raises HTTP failures itself once its retries run out, with Attio's body already parsed.
    if (isHTTPError(error)) return httpError(error.response.status, error.data);
    return response ? error : networkError(error);
  });
  return client;
}
