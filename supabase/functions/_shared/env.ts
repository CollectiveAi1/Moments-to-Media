/**
 * Required secrets, read once and never logged.
 *
 * CLAUDE.md rule 4: the R2 credentials and the service role key live only in
 * Edge Function secrets. Nothing here prints a value — a missing variable is
 * reported by name, a present one is never echoed, and the error a caller
 * sees says "misconfigured" and nothing more.
 */

const NAMES = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
] as const;

export type EnvName = (typeof NAMES)[number];
export type Env = Record<EnvName, string>;

export class MissingEnv extends Error {
  constructor(public readonly missing: EnvName[]) {
    super(`missing Edge Function secrets: ${missing.join(", ")}`);
    this.name = "MissingEnv";
  }
}

/** Reads every required secret, or throws naming the ones that are absent. */
export function readEnv(source: { get(key: string): string | undefined } = Deno.env): Env {
  const out = {} as Env;
  const missing: EnvName[] = [];

  for (const name of NAMES) {
    const value = source.get(name);
    if (value === undefined || value.trim() === "") {
      missing.push(name);
    } else {
      out[name] = value;
    }
  }

  if (missing.length > 0) throw new MissingEnv(missing);
  return out;
}
