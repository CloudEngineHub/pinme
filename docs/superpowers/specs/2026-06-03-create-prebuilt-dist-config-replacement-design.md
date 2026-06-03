# Create Prebuilt Dist Config Replacement Design

## Context

`pinme create` is optimized for first-time users by downloading a template that
already ships with `dist-worker/` and `frontend/dist/`. This avoids requiring a
fresh `npm install` or Vite build before the first deploy.

The current create flow updates source files such as `pinme.toml`,
`frontend/.env`, `frontend/src/utils/config.ts`, and backend metadata after the
project is created. However, the first upload uses the prebuilt `frontend/dist`
directory, so values compiled into the bundle still contain empty defaults. This
breaks first-run frontend configuration such as the Worker API URL and auth
client config.

## Goal

Patch only the prebuilt frontend dist used by the initial `pinme create`
deployment after Pinme receives the latest project configuration from
`/create_worker`, and before the dist is uploaded to IPFS.

Normal `pinme save`, `pinme update-web`, and developer builds remain unchanged.
After dependencies are installed, those commands rebuild from source and do not
need dist replacement.

## Non-Goals

- Do not add a general runtime config system.
- Do not rebuild the frontend during `pinme create`.
- Do not change `pinme save` or `pinme update-web` behavior.
- Do not use empty-string replacement as the primary mechanism.

## Template Changes

The template should compile stable placeholders into `frontend/dist`.

Recommended placeholders:

```text
__PINME_VITE_API_URL__
__PINME_AUTH_API_KEY__
__PINME_AUTH_DOMAIN__
__PINME_AUTH_PROJECT_ID__
__PINME_TENANT_ID__
```

Source defaults should use those placeholders:

- `frontend/.env.example`
  - `VITE_API_URL="__PINME_VITE_API_URL__"`
- `frontend/src/utils/config.ts`
  - `auth_api_key: "__PINME_AUTH_API_KEY__"`
  - `auth_domain: "__PINME_AUTH_DOMAIN__"`
  - `auth_project_id: "__PINME_AUTH_PROJECT_ID__"`
  - `tenant_id: "__PINME_TENANT_ID__"`

`frontend/src/pages/Auth/index.tsx` should read Firebase auth configuration from
`public_client_config` instead of only `import.meta.env.VITE_FIREBASE_*`.
Otherwise, the CLI can update `frontend/src/utils/config.ts`, but the prebuilt
auth bundle will still stay unconfigured.

The template release process should rebuild `frontend/dist` after these source
changes. A quick release check should confirm the placeholders are present in
the built dist before publishing the template.

## CLI Changes

Add a create-only helper in `bin/create.ts`, or a small helper local to the
create command if it keeps the scope clearer:

```ts
patchPrebuiltFrontendDist(frontendDistDir, workerData)
```

Call it in `createCmd` after the source config files are updated and before:

```ts
uploadPath(frontendDistDir, { action: 'project_create', ... })
```

Replacement mapping:

```text
__PINME_VITE_API_URL__      <- workerData.api_domain
__PINME_AUTH_API_KEY__      <- workerData.public_client_config.auth_api_key
__PINME_AUTH_DOMAIN__       <- workerData.public_client_config.auth_domain
__PINME_AUTH_PROJECT_ID__   <- workerData.public_client_config.auth_project_id
__PINME_TENANT_ID__         <- workerData.public_client_config.tenant_id
```

If `public_client_config` is absent, replace auth placeholders with empty
strings so the Auth Demo clearly remains disabled. `workerData.api_domain` is
required; if it is missing, fail create before upload with a clear config error.

## File Scanning

Patch text files under `frontend/dist`, including:

- `.html`
- `.js`
- `.css`
- `.json`
- `.map`

Binary files and unrelated assets should be skipped.

The helper should count replacements and print a concise success line such as:

```text
Patched prebuilt frontend dist config
```

## Validation

Before upload, validate:

- `__PINME_VITE_API_URL__` no longer exists in `frontend/dist`.
- If `public_client_config` was returned, none of the auth placeholders remain.
- If no matching API URL placeholder was found, fail create with a message that
  the template prebuilt dist is missing required Pinme config placeholders.

This prevents uploading a known-bad first-run frontend.

## Error Handling

Use the existing CLI error style with `createConfigError` for local template
problems. The error should explain:

- the prebuilt dist is missing required placeholders;
- the template should be rebuilt from the placeholder-enabled source;
- users can run `npm install`, `npm run build:frontend`, and `pinme save` as a
  recovery path after create, if needed.

## Tests

Add focused unit coverage for the replacement helper where practical:

- API URL placeholder is replaced.
- Auth placeholders are replaced when `public_client_config` exists.
- Auth placeholders are replaced with empty strings when auth config is absent.
- Missing API URL placeholder fails validation.
- Binary or unsupported files are skipped.

Add a template-side build check or script-level assertion that the published
`frontend/dist` includes `__PINME_VITE_API_URL__`.

## Rollout

1. Update template source defaults and Auth config source.
2. Rebuild template `frontend/dist`.
3. Update CLI `pinme create` to patch the prebuilt dist before first upload.
4. Verify `pinme create <name>` uploads a frontend whose dist contains the real
   Worker API URL and auth config values.
