import { toToolErrorMessage, NotFoundError } from "../../utils/errors.js";
import { getClientById, type LoadedClient } from "../../database/repositories/client-repo.js";

/** Standard successful tool result. */
export function ok(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

/** Standard failed tool result. */
export function fail(err: unknown) {
  return { content: [{ type: "text" as const, text: toToolErrorMessage(err) }], isError: true as const };
}

/** Loads a client or throws NotFoundError. */
export async function requireClient(clientId: string): Promise<LoadedClient> {
  const client = await getClientById(clientId);
  if (!client) throw new NotFoundError(`No client found with id ${clientId}`);
  return client;
}

export function defaultRange(lookbackDays: number, now: Date = new Date()) {
  const start = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(now) };
}
