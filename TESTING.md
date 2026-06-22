# PinMe Testing Guide

This document describes the test system for the PinMe CLI. It is intended for
maintainers, contributors, and AI coding agents working on this repository.

## Goals

The test suite is designed to catch regressions across the full CLI lifecycle:

- TypeScript and lint checks.
- Unit tests for pure utility logic.
- Mocked integration tests for API wrappers and HTTP clients.
- Real CLI black-box tests against the bundled `dist/index.js`.
- npm package shape tests using `npm pack`.
- Coverage thresholds for the core in-process modules.
- Mutation testing for stricter confidence in critical logic.

Normal tests must not call real PinMe, IPFS, CAR, GitHub template, or other
external services. Use `nock`, local fixture servers, temporary HOME
directories, and test fixtures instead.

## Test Commands

Use these commands from the repository root.

```bash
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run test:cli
npm run test:pack
npm run verify
npm run test:mutation
```

Command meanings:

| Command | Purpose |
| --- | --- |
| `npm run lint` | Runs ESLint over TypeScript, MJS tests, and Vitest config files. |
| `npm run typecheck` | Runs `tsc --noEmit` with `tsconfig.test.json`. |
| `npm run test` | Runs unit, integration, source-regression, and legacy MJS tests. |
| `npm run test:coverage` | Runs the same in-process tests with V8 coverage thresholds. |
| `npm run build` | Bundles the CLI to `dist/index.js` with esbuild. |
| `npm run test:cli` | Builds and runs black-box CLI tests against `node dist/index.js`. |
| `npm run test:pack` | Builds, packs, installs, and verifies the npm package shape. |
| `npm run verify` | Main PR gate: lint, typecheck, tests, coverage, build, CLI, and pack. |
| `npm run test:mutation` | Slow strict check using Stryker mutation testing. |

For pull requests, `npm run verify` is the required local confidence check.
Mutation testing is intentionally slower and is best run before risky releases,
large refactors, or from scheduled/manual CI jobs.

## Test Layout

```text
test/
  unit/             Pure utility and service tests.
  integration/      Mocked API/client integration tests.
  cli/              Real bundled CLI black-box tests.
  pack/             npm pack and installed-tarball tests.
  helpers/          Shared test helpers.
  setup/            Global test setup such as nock network guards.
tests/              Existing MJS regression tests.
```

Important files:

- `vitest.config.ts` controls the normal Vitest and coverage setup.
- `vitest.mutation.config.ts` narrows Stryker's test set to unit/integration
  tests so mutation runs do not execute slow CLI/package black-box tests.
- `stryker.config.json` lists the core files mutation testing is allowed to
  mutate.
- `.github/workflows/ci.yml` runs the open-source CI gates.

## Coverage Policy

Coverage focuses on in-process core modules where V8 can reliably attribute
executed code back to TypeScript source files.

Currently covered core modules include:

- `bin/utils/domainValidator.ts`
- `bin/utils/config.ts`
- `bin/utils/uploadLimits.ts`
- `bin/utils/apiClient.ts`
- `bin/utils/cliError.ts`
- `bin/utils/history.ts`
- `bin/utils/pinmeApi.ts`
- `bin/utils/webLogin.ts`
- `bin/services/uploadService.ts`

The configured minimums are:

| Metric | Minimum |
| --- | ---: |
| Statements | 85% |
| Branches | 80% |
| Functions | 85% |
| Lines | 85% |

Command files are primarily covered by `test:cli`, which executes the bundled
CLI as a subprocess. Subprocess coverage is not reliably attributed back to the
original TypeScript command files, so those checks live in CLI tests rather than
the V8 coverage gate.

## Mutation Policy

Mutation testing is configured for critical utility/API/service logic rather
than the entire repository. This keeps the signal high and avoids very slow or
flaky mutants in CLI subprocess tests.

Run:

```bash
npm run test:mutation
```

Current target:

- Overall mutation score should stay above the configured Stryker break
  threshold.
- The practical project target is `80+`.
- If the score drops, first inspect survivors in:

```text
reports/mutation/index.html
```

The report directory is generated output and should not be committed.

## Network and Filesystem Rules

Tests must be hermetic by default.

- `test/setup/nock.ts` disables accidental external network access for normal
  unit and integration tests.
- API behavior should be mocked with `nock`.
- CLI success-path tests may use local HTTP servers bound to `127.0.0.1`.
- Tests that touch user auth must isolate `HOME` and `~/.pinme` with temporary
  directories.
- Do not depend on the real user's PinMe credentials.
- Do not write persistent files outside temporary directories unless the test is
  explicitly verifying package/build output inside the repository.

In restricted sandboxes, CLI success-path tests can fail with:

```text
listen EPERM: operation not permitted 127.0.0.1
```

That means the sandbox blocked local mock servers. Re-run the command in an
environment that permits local loopback listeners.

## What To Test When Changing Code

Use the narrowest command while developing, then run the full gate before
opening a PR.

| Change area | Recommended tests |
| --- | --- |
| Pure utility logic | `npm run test -- test/unit/<file>.test.ts` |
| API wrappers or Axios client behavior | `npm run test -- test/integration` |
| Auth file handling | `npm run test -- test/unit/webLogin.test.ts` |
| Upload URL/result formatting | `npm run test -- test/unit/uploadService.test.ts` |
| CLI command behavior | `npm run build && vitest run test/cli` |
| Build or package metadata | `npm run test:pack` |
| Release confidence | `npm run verify && npm run test:mutation` |

Before finishing a non-trivial change, run:

```bash
npm run verify
```

Before finishing a risky core-logic change, also run:

```bash
npm run test:mutation
```

## Adding New Tests

Choose the test layer based on what can catch the bug most directly:

- Put pure function and local formatting tests in `test/unit/`.
- Put mocked API behavior in `test/integration/`.
- Put user-visible command behavior in `test/cli/`.
- Put publish/install behavior in `test/pack/`.
- Put old MJS regression tests in `tests/` only when matching existing
  regression-test style.

Guidelines:

- Prefer testing public or intentionally exported helper behavior.
- Keep external services mocked.
- Use realistic fixtures for CLI tests.
- Assert both success output and failure messages when user behavior matters.
- Avoid brittle snapshots for colorful CLI output; normalize ANSI output when
  necessary.
- If an internal function is hard to test, prefer a small pure helper export
  over changing runtime behavior.

## CI Expectations

The GitHub Actions workflow keeps normal contribution feedback fast:

- Pull requests run `npm run verify` across supported Node versions.
- Mutation testing is scheduled/manual rather than required for every PR.
- Audit checks are non-blocking so dependency advisories can be triaged without
  preventing unrelated contributions.

Generated directories such as `coverage/`, `reports/`, and `.stryker-tmp/`
should remain ignored and uncommitted.
