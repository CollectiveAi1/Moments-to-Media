/** What every server action returns to the form that called it. */
export type ActionResult = {
  ok: boolean;
  message: string;
  /** Changes on every call, so the same message twice still re-renders. */
  at: number;
} | null;

export type Action = (previous: ActionResult, form: FormData) => Promise<ActionResult>;
