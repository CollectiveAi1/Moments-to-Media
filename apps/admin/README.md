# Admin console (Next.js)

Next.js App Router on Vercel. Built so far: sign-in by emailed link, and the
Operations board (`docs/ui/UI-SPEC.md` section 5.1). The other sidebar entries
are drawn but not built.

```sh
cp .env.example .env.local   # then fill in the two public values
pnpm --filter @mtm/admin dev
```

- Every query runs as the signed-in person through the anon key. There is no
  service-role key in this app, so what a producer sees is exactly what
  row-level security lets them see (CLAUDE.md rules 2 and 4).
- Colours, radii and font names come from `@mtm/shared` tokens. No raw hex in
  components (UI-SPEC acceptance checklist).
- `lib/board/build.ts` turns rows into the board and is pure, so the rules for
  what counts as "needs attention" are unit tested without a database.

The screens are specified in `docs/ui/UI-SPEC.md` (section 5), with shared components in section 3.
