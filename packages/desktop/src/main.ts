import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  safeStorage,
  session,
  shell,
  Tray,
} from 'electron';
import type {
  Event,
  HandlerDetails,
  OpenDialogOptions,
  SaveDialogOptions,
  WebContents,
} from 'electron';
import AutoLaunch from 'auto-launch';
import fs from 'fs';
import path from 'path';

type TenantConfig = {
  appUrl: string;
  name?: string;
};

type DesktopConfig = {
  env: string;
  defaultTenant: string;
  tenants: Record<string, TenantConfig>;
  keycloak?: {
    tenantClaim?: string;
  };
};

type SecureStore = Record<string, string>;

const getConfigPath = (env: string) =>
  path.join(__dirname, '..', 'config', `${env}.json`);

const loadConfig = (): DesktopConfig => {
  const env = process.env.DESKTOP_ENV ?? 'dev';
  const configPath = getConfigPath(env);
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as DesktopConfig;
};

const config = loadConfig();
const tenantId = process.env.DESKTOP_TENANT ?? config.defaultTenant;
const tenant =
  config.tenants[tenantId] ??
  config.tenants[Object.keys(config.tenants)[0] ?? ''];

if (!tenant) {
  throw new Error('No tenant configuration found');
}

const appPartition = `persist:${tenantId}`;
const appSession = session.fromPartition(appPartition);
const secureStorePath = () =>
  path.join(app.getPath('userData'), 'secure-store.json');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
type AutoLaunchInstance = ReturnType<typeof AutoLaunch>;
let autoLauncher: AutoLaunchInstance | null = null;

const trayIconBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAOElEQVR4AWMYu+H6fwY8gBGIMn8GBoYJcXGZQjA4jA0YIYwYqQ0GJDBhWQ0Gcg0AAMFdKxYp4n8oAAAAAElFTkSuQmCC';

const getSecureStore = (): SecureStore => {
  const storePath = secureStorePath();
  if (!fs.existsSync(storePath)) {
    return {};
  }
  const raw = fs.readFileSync(storePath, 'utf-8');
  return JSON.parse(raw) as SecureStore;
};

const saveSecureStore = (data: SecureStore) => {
  fs.writeFileSync(secureStorePath(), JSON.stringify(data, null, 2));
};

const encryptValue = (value: string) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system');
  }
  return safeStorage.encryptString(value).toString('base64');
};

const decryptValue = (value: string) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system');
  }
  return safeStorage.decryptString(Buffer.from(value, 'base64'));
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0b0f1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      partition: appPartition,
    },
  });

  mainWindow.loadURL(tenant.appUrl);

  mainWindow.webContents.setWindowOpenHandler(({ url }: HandlerDetails) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event: Event, url: string) => {
    const currentUrl = new URL(tenant.appUrl);
    if (!url.startsWith(currentUrl.origin)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

const createTray = () => {
  if (tray) return;
  const icon = nativeImage.createFromDataURL(
    `data:image/png;base64,${trayIconBase64}`,
  );
  tray = new Tray(icon);
  tray.setToolTip('SmartOps Desktop');
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => mainWindow?.show(),
    },
    {
      label: 'Hide',
      click: () => mainWindow?.hide(),
    },
    {
      label: 'Reload',
      click: () => mainWindow?.reload(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
    }
  });
};

const initAutoLaunch = () => {
  autoLauncher = new AutoLaunch({
    name: 'SmartOps Desktop',
  });
};

const setAutoLaunch = async (enabled: boolean) => {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return;
  }

  if (!autoLauncher) {
    initAutoLaunch();
  }
  if (!autoLauncher) return;
  const isEnabled = await autoLauncher.isEnabled();
  if (enabled && !isEnabled) {
    await autoLauncher.enable();
  }
  if (!enabled && isEnabled) {
    await autoLauncher.disable();
  }
};

const getAutoLaunch = async () => {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return app.getLoginItemSettings().openAtLogin;
  }
  if (!autoLauncher) {
    initAutoLaunch();
  }
  return autoLauncher ? autoLauncher.isEnabled() : false;
};

const registerIpc = () => {
  ipcMain.handle('desktop:getConfig', () => ({
    env: config.env,
    tenantId,
    appUrl: tenant.appUrl,
    tenantName: tenant.name ?? tenantId,
  }));

  ipcMain.handle(
    'desktop:notify',
    (_: Event, { title, body }: { title: string; body: string }) => {
      new Notification({ title, body }).show();
    },
  );

  ipcMain.handle('desktop:clipboard:readText', () => clipboard.readText());
  ipcMain.handle('desktop:clipboard:writeText', (_: Event, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle('desktop:openExternal', (_: Event, url: string) =>
    shell.openExternal(url),
  );

  ipcMain.handle(
    'desktop:files:open',
    async (_: Event, options: OpenDialogOptions) => {
      const result = await dialog.showOpenDialog(mainWindow!, options);
      return result.canceled ? [] : result.filePaths;
    },
  );

  ipcMain.handle(
    'desktop:files:save',
    async (_: Event, options: SaveDialogOptions) => {
      const result = await dialog.showSaveDialog(mainWindow!, options);
      return result.canceled ? null : result.filePath ?? null;
    },
  );

  ipcMain.handle('desktop:files:read', async (_: Event, filePath: string) => {
    return fs.promises.readFile(filePath, 'utf-8');
  });

  ipcMain.handle(
    'desktop:files:write',
    async (_: Event, filePath: string, content: string) => {
      await fs.promises.writeFile(filePath, content, 'utf-8');
    },
  );

  ipcMain.handle('desktop:secureStore:get', (_: Event, key: string) => {
    const store = getSecureStore();
    if (!store[key]) return null;
    return decryptValue(store[key]);
  });

  ipcMain.handle(
    'desktop:secureStore:set',
    (_: Event, key: string, value: string) => {
      const store = getSecureStore();
      store[key] = encryptValue(value);
      saveSecureStore(store);
    },
  );

  ipcMain.handle('desktop:secureStore:delete', (_: Event, key: string) => {
    const store = getSecureStore();
    delete store[key];
    saveSecureStore(store);
  });

  ipcMain.handle('desktop:autoLaunch:get', () => getAutoLaunch());
  ipcMain.handle(
    'desktop:autoLaunch:set',
    (_: Event, enabled: boolean) => setAutoLaunch(enabled),
  );
};

app.whenReady().then(() => {
  appSession.setPermissionRequestHandler(
    (_: WebContents, permission: string, callback: (allowed: boolean) => void) => {
    const allowed = permission === 'notifications';
    callback(allowed);
    },
  );

  createWindow();
  createTray();
  registerIpc();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
