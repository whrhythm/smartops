# SmartOps Desktop (Tauri)

This package wraps the web app in a Tauri shell.

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

- `yarn desktop:dev` - run Tauri development mode
- `yarn desktop:start` - run Tauri development mode
- `yarn desktop:build` - build Tauri application

## Development

1. Install dependencies:
   ```bash
   yarn install
   ```

2. Run in development mode:
   ```bash
   yarn desktop:dev
   ```

3. Build for production:
   ```bash
   yarn desktop:build
   ```

## Requirements

- Rust (latest stable)
- Node.js 22+
- For Windows: WebView2 runtime (pre-installed on Windows 10/11)
