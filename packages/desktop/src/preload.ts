import { contextBridge, ipcRenderer } from 'electron';
import type { OpenDialogOptions, SaveDialogOptions } from 'electron';

contextBridge.exposeInMainWorld('desktopApi', {
  getConfig: () => ipcRenderer.invoke('desktop:getConfig'),
  notify: (title: string, body: string) =>
    ipcRenderer.invoke('desktop:notify', { title, body }),
  openExternal: (url: string) => ipcRenderer.invoke('desktop:openExternal', url),
  clipboard: {
    readText: () => ipcRenderer.invoke('desktop:clipboard:readText'),
    writeText: (text: string) =>
      ipcRenderer.invoke('desktop:clipboard:writeText', text),
  },
  files: {
    open: (options: OpenDialogOptions) =>
      ipcRenderer.invoke('desktop:files:open', options),
    save: (options: SaveDialogOptions) =>
      ipcRenderer.invoke('desktop:files:save', options),
    read: (filePath: string) =>
      ipcRenderer.invoke('desktop:files:read', filePath),
    write: (filePath: string, content: string) =>
      ipcRenderer.invoke('desktop:files:write', filePath, content),
  },
  secureStore: {
    get: (key: string) => ipcRenderer.invoke('desktop:secureStore:get', key),
    set: (key: string, value: string) =>
      ipcRenderer.invoke('desktop:secureStore:set', key, value),
    delete: (key: string) =>
      ipcRenderer.invoke('desktop:secureStore:delete', key),
  },
  autoLaunch: {
    get: () => ipcRenderer.invoke('desktop:autoLaunch:get'),
    set: (enabled: boolean) =>
      ipcRenderer.invoke('desktop:autoLaunch:set', enabled),
  },
});
