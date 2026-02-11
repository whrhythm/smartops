# AGENTS.md

This guide is for agentic coding tools working in this repository.
It focuses on the commands and conventions you need most often.

## Repo snapshot

- Project: Red Hat Developer Hub monorepo (Backstage-based).
- Package manager: Yarn 3.8.7 (`packageManager` in root `package.json`).
- Node.js: 22 (`.nvmrc` = `22.22.0`, engines = `22`).
- Task runner: Turborepo (`turbo.json`).
- Main workspaces: `packages/*`, `plugins/*`.
- Extra areas: `e2e-tests/`, `.ibm/`, `catalog-entities/`, `third-party-plugins/`.

## Setup and common root commands

- Install deps: `yarn install`
- Start backend only: `yarn start`
- Start backend + frontend: `yarn dev`
- Build all packages: `yarn build`
- Typecheck all packages: `yarn tsc`
- Run all tests: `yarn test`
- Lint (check): `yarn lint:check`
- Lint (fix): `yarn lint:fix`
- Format check: `yarn prettier:check`
- Format fix: `yarn prettier:fix`
- Clean artifacts: `yarn clean`

## Scoped build/lint/test (preferred during development)

Use Turbo filters from repo root to keep runs fast.

- Build one package: `yarn build --filter=packages/app`
- Build backend only: `yarn build --filter=packages/backend`
- Typecheck one package: `yarn tsc --filter=packages/app`
- Lint one package: `yarn lint:check --filter=packages/backend`
- Test one package: `yarn test --filter=packages/app`

## Running a single unit test (important)

Backstage package tests are Jest via `backstage-cli package test`.
Pass Jest args after `--`.

- Single test file from root:
  `yarn test --filter=packages/app -- --runTestsByPath packages/app/src/.../MyFile.test.tsx`
- Single test name from root:
  `yarn test --filter=packages/app -- --testNamePattern "my test name"`
- Single file from package dir:
  `yarn test -- --runTestsByPath src/.../MyFile.test.tsx`
- For backend package, use same pattern with `--filter=packages/backend`.

## E2E tests (Playwright)

E2E lives in `e2e-tests/` (Playwright + TypeScript).

- Install e2e deps and browser: `yarn install` in `e2e-tests`
- Run a project: `yarn showcase`
- Run with grep: `yarn showcase --grep "login"`
- Run one file: `yarn playwright test playwright/e2e/<file>.spec.ts --project=showcase`
- Run one test by title: `yarn playwright test --project=showcase --grep "<test name>"`
- Debug mode: `yarn playwright test --debug`

Common projects:

- `showcase`, `showcase-rbac`, `showcase-k8s`, `showcase-rbac-k8s`
- `showcase-operator`, `showcase-operator-rbac`, `showcase-runtime`
- `showcase-upgrade`, `showcase-auth-providers`, `showcase-sanity-plugins`

## Formatting, linting, and import order

- Prettier base comes from `@backstage/cli/config/prettier.json`.
- Many packages add `@ianvs/prettier-plugin-sort-imports`.
- Follow local `.prettierrc.js` in the package you touch.
- ESLint is run via package scripts (`backstage-cli package lint` or local config).

Default import order used in multiple packages:

1. `react` and related imports
2. `@backstage/*`
3. Third-party modules
4. `@janus-idp/*`
5. Node built-ins
6. Relative imports (`./`, `../`)

## Code style and TypeScript conventions

- Default to TypeScript for new code.
- Match surrounding code patterns before introducing new abstractions.
- Prefer named exports unless the local module pattern is default export.
- Keep functions/components focused; extract reusable helpers.
- Avoid broad refactors when solving a scoped task.
- Use explicit, descriptive names; avoid single-letter vars except tiny loops.
- Components/types/interfaces/classes use `PascalCase`; functions/variables use `camelCase`; hooks use `useXxx`.
- Constants use `UPPER_SNAKE_CASE` only for true module-level constants.
- File names should follow nearest neighboring pattern (do not rename casually).
- Prefer precise types over `any`.
- Use existing shared types before creating duplicates.
- Keep public function return types clear for exported APIs.
- For reusable React components, type props explicitly.

## Backend and error-handling guidance

- Backend code is in `packages/backend` and backend plugin modules.
- Follow existing logger/error patterns in the target module.
- Do not swallow errors; either handle with context or rethrow with context.
- Prefer typed/domain errors when available.
- Error messages should be actionable and include relevant identifiers.
- Avoid leaking secrets/tokens in logs or thrown errors.

## Testing conventions

- Prefer deterministic tests; avoid brittle timing assumptions.
- Frontend tests: Testing Library + Backstage test utilities.
- Backend tests: prefer `@backstage/backend-test-utils` over custom mocks.
- Keep assertions behavior-focused, not implementation-detail-focused.
- Use `--passWithNoTests` only when it is already part of package scripts.

## CI and infra notes

- E2E/CI scripts and docs are heavily centered in `.ibm/` and `e2e-tests/`.
- For `.ibm/` checks, run `yarn install` in `.ibm`, then `yarn shellcheck` and Prettier scripts.
- Do not commit secrets; CI secrets come from Vault.

## Cursor and Copilot rules present in this repo

Follow the nearest applicable rule file(s) before making changes.

Root-level Cursor rules:

- `.cursor/rules/managing-ai-rules.mdc`
- `.cursor/rules/playwright-locators.mdc`
- `.cursor/rules/ci-e2e-testing.mdc`
- `.cursor/rules/add_extension_metadata.mdc`

Additional rules in `third-party-plugins/backstage/`:

- Copilot: `third-party-plugins/backstage/.github/copilot-instructions.md`
- Cursor: `third-party-plugins/backstage/.cursor/rules/general.mdc`
- Cursor: `third-party-plugins/backstage/.cursor/rules/tests/test-utils.mdc`
- Cursor: `third-party-plugins/backstage/.cursor/rules/tests/backend-test-utils.mdc`

Practical precedence:

- If editing under `third-party-plugins/backstage/`, follow that subtree's Copilot/Cursor rules.
- Otherwise follow root rules and local package configs; if rules conflict, prefer the most specific path.

## Contribution and commit expectations

- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, etc.).
- Update docs when `app-config.yaml` requirements change.
- If adding new internal plugins, update required Dockerfiles per `CONTRIBUTING.md`.
- Keep changes scoped; avoid unrelated file churn.
