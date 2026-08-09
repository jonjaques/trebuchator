#!/usr/bin/env bash
#
# Everything CI checks, in one command, runnable locally: `bun run healthcheck`.
#
# CI calls this script rather than listing the steps again in YAML, so the two
# cannot drift — if it passes on your machine it passes on the runner, and the
# only way to change what CI enforces is to change this file.
#
# It deliberately does NOT stop at the first failure. A healthcheck that dies on
# a stray unused import tells you nothing about whether the tests pass, and you
# end up running it four times to find four problems. Every step runs, every
# result is recorded, and the summary at the bottom is the whole picture.
#
# Hence `set -uo pipefail` and not `-e`: a failing step is the data we came for,
# not a reason to abort the run.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

declare -a RESULTS=()
FAILURES=0

# GitHub folds `::group::` blocks in the log, which keeps a green run to five
# readable lines. Locally that syntax is noise, so print a plain rule instead.
in_actions() { [[ -n "${GITHUB_ACTIONS:-}" ]]; }

step() {
  local name=$1 label=$2
  shift 2

  if in_actions; then echo "::group::$label"; else printf '\n\033[1m── %s ──\033[0m\n' "$label"; fi

  local start=$SECONDS
  "$@"
  local status=$?
  local elapsed=$((SECONDS - start))

  if in_actions; then echo "::endgroup::"; fi

  if [[ $status -eq 0 ]]; then
    RESULTS+=("  ✓ ${name} (${elapsed}s)")
  else
    RESULTS+=("  ✗ ${name} (${elapsed}s)")
    FAILURES=$((FAILURES + 1))
    # An annotation so the failure is visible on the PR itself, not only to
    # whoever thinks to open the log and expand the right group.
    if in_actions; then echo "::error title=healthcheck: ${name}::${label} failed"; fi
  fi
}

# Cheapest and most specific first: formatting and lint failures are one-line
# fixes and there is no sense waiting out a build to hear about them. Types
# before tests because a type error usually explains the test failure that
# follows it.
step format   'Formatting (prettier --check)' bun run format:check
step lint     'Lint (eslint)'                 bun run lint
step types    'Types (tsc -b)'                bun run typecheck
step test     'Tests (vitest)'                bun run test
# Runs `tsc -b` again on the way through, but that build is incremental and
# already warm from the step above — a second or two to confirm the thing the
# world actually gets is the thing that was checked.
step build    'Production build (vite)'       bun run build

printf '\n\033[1mHealthcheck\033[0m\n'
printf '%s\n' "${RESULTS[@]}"

if [[ $FAILURES -gt 0 ]]; then
  printf '\n%d of %d checks failed.\n' "$FAILURES" "${#RESULTS[@]}"
  exit 1
fi

printf '\nAll %d checks passed.\n' "${#RESULTS[@]}"
