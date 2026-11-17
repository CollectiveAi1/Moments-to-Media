import type { ActionResult } from './action-types';

interface DbError {
  message?: string;
  code?: string;
  hint?: string | null;
  details?: string | null;
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * Database errors are written for people already: the state machines raise
 * "event … cannot move from draft to complete" and the like. This only takes
 * out the ids, which mean nothing on screen, and maps the two generic codes
 * that are not self-explanatory.
 */
export function friendly(error: DbError | null | undefined): string {
  if (!error) return 'Something went wrong. Try again.';
  if (error.code === '42501') {
    return error.hint ?? 'You do not have permission to do that.';
  }
  if (error.code === '23505') return 'That already exists.';
  if (error.code === 'PGRST116') return 'That record was not found, or you cannot see it.';

  let message = (error.message ?? 'Something went wrong.').replace(UUID, '').replace(/\s{2,}/g, ' ').trim();
  message = message.replace(/^(event|assignment|payout|slot|upload) (cannot|still|has|is)/i, (_m, noun: string, verb: string) => `This ${noun.toLowerCase()} ${verb}`);
  message = message.charAt(0).toUpperCase() + message.slice(1);
  if (!/[.!?]$/.test(message)) message += '.';
  return error.hint ? `${message} ${error.hint}` : message;
}

export const ok = (message: string): ActionResult => ({ ok: true, message, at: Date.now() });
export const fail = (message: string): ActionResult => ({ ok: false, message, at: Date.now() });
export const failWith = (error: DbError | null | undefined): ActionResult => fail(friendly(error));

/** Reads a required text field, or returns null when it is missing or blank. */
export function text(form: FormData, name: string): string | null {
  const value = form.get(name);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function int(form: FormData, name: string): number | null {
  const raw = text(form, name);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Dollars typed by a person, to integer cents (CLAUDE.md rule 5). */
export function cents(form: FormData, name: string): number | null {
  const raw = text(form, name);
  if (raw === null) return null;
  const n = Number(raw.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
