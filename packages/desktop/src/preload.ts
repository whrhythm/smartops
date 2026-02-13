import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { open as shellOpen } from '@tauri-apps/plugin-shell';

export interface DesktopConfig {
  env: string;
  tenantId: string;
  appUrl: string;
  tenantName: string;
}

const desktopApi = {
  getConfig: (): Promise<DesktopConfig> => invoke<DesktopConfig>('get_config'),

  notify: (title: string, body: string): Promise<void> => {
    return new Promise(async (resolve) => {
      let permissionGranted = await isPermissionGranted();
      if (!permissionGranted) {
        const permission = await requestPermission();
        permissionGranted = permission === 'granted';
      }
      if (permissionGranted) {
        sendNotification({ title, body });
      }
      resolve();
    });
  },

  openExternal: (url: string): Promise<void> => shellOpen(url),

  clipboard: {
    readText: (): Promise<string> => readText(),
    writeText: (text: string): Promise<void> => writeText(text),
  },

  files: {
    open: (options?: {
      multiple?: boolean;
      directory?: boolean;
      title?: string;
      defaultPath?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    }): Promise<string[] | null> => {
      return new Promise(async (resolve) => {
        const result = await open(options ?? {});
        if (result === null) {
          resolve(null);
          return;
        }
        if (Array.isArray(result)) {
          resolve(result);
        } else {
          resolve([result]);
        }
      });
    },

    save: (options?: {
      title?: string;
      defaultPath?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    }): Promise<string | null> => {
      return new Promise(async (resolve) => {
        const result = await open({
          ...options,
          directory: false,
          multiple: false,
        });
        resolve(result as string | null);
      });
    },

    read: (filePath: string): Promise<string> => readTextFile(filePath),

    write: (filePath: string, content: string): Promise<void> =>
      writeTextFile(filePath, content),
  },

  secureStore: {
    get: (key: string): Promise<string | null> =>
      invoke<string | null>('get_secure_store', { key }),
    set: (key: string, value: string): Promise<void> =>
      invoke('set_secure_store', { key, value }),
    delete: (key: string): Promise<void> =>
      invoke('delete_secure_store', { key }),
  },

  autoLaunch: {
    get: (): Promise<boolean> => invoke<boolean>('get_auto_launch'),
    set: (enabled: boolean): Promise<void> =>
      invoke('set_auto_launch', { enabled }),
  },
};

window.desktopApi = desktopApi;

declare global {
  interface Window {
    desktopApi: typeof desktopApi;
  }
}
