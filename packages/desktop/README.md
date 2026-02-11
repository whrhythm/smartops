# SmartOps Desktop (Electron)

This package wraps the web app in an Electron shell.

## Environment selection

Set `DESKTOP_ENV` to choose the config file:

```bash
DESKTOP_ENV=dev yarn desktop:start
```

Available configs live in `packages/desktop/config/`.

## Tenant selection

Set `DESKTOP_TENANT` to choose the tenant entry from the config.

```bash
DESKTOP_TENANT=default yarn desktop:start
```

## Scripts

- `yarn desktop:dev` - watch TypeScript changes
- `yarn desktop:start` - run Electron from `dist/`
- `yarn desktop:pack` - package without installer
- `yarn desktop:dist` - build installers
