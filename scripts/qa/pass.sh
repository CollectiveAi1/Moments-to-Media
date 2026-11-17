#!/usr/bin/env bash
# One QA pass: typecheck, lint, unit tests, production build, and the
# end-to-end run against a live Supabase project. Every step must pass.
# Needs the QA_* and SUPABASE_* variables scripts/qa/e2e.ts documents.
set -u
cd "$(dirname "$0")/../.."
fail=0
step() {
  local name="$1"; shift
  if "$@" > "/tmp/qa_${name// /_}.log" 2>&1; then echo "  PASS  $name"; else echo "  FAIL  $name"; tail -25 "/tmp/qa_${name// /_}.log"; fail=1; fi
}
step "typecheck" pnpm typecheck
step "lint" pnpm lint
step "unit tests" pnpm exec turbo run test --force
grep -hE "# (pass|fail) " /tmp/qa_unit_tests.log | sed 's/.*# //' | awk '{s[$1]+=$2} END {printf "        %d passed, %d failed\n", s["pass"], s["fail"]}'
step "production build" bash -c 'cd apps/admin && rm -rf .next && pnpm build'
step "end-to-end" node --no-warnings --experimental-strip-types scripts/qa/e2e.ts
grep -E "passed, .* failed" /tmp/qa_end-to-end.log | sed 's/^/        /'
[ $fail -eq 0 ] && echo "QA PASS: GREEN" || echo "QA PASS: RED"
exit $fail
