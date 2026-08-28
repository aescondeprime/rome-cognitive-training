import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { BrowserController } from "./browser-controller";
import type { BrowserSessionKind, BrowserViewport } from "./types";

export function registerBrowserIpc(getController: () => BrowserController | null): void {
  const withController = <T>(event: IpcMainInvokeEvent, fn: (controller: BrowserController) => T): T => {
    const controller = getController();
    if (!controller || !controller.owns(event.sender)) throw new Error("Unauthorized browser IPC sender");
    return fn(controller);
  };

  ipcMain.handle("rome:browser:initialize", (event) => withController(event, (c) => c.initialize()));
  ipcMain.handle("rome:browser:create-tab", (event, url?: string, kind?: BrowserSessionKind) =>
    withController(event, (c) => c.createTab(typeof url === "string" ? url : undefined, kind === "incognito" || kind?.startsWith("profile:") ? kind : "default")),
  );
  ipcMain.handle("rome:browser:close-tab", (event, id: string) => withController(event, (c) => c.tabs.close(String(id))));
  ipcMain.handle("rome:browser:activate-tab", (event, id: string) => withController(event, (c) => c.tabs.activate(String(id))));
  ipcMain.handle("rome:browser:navigate", (event, id: string, input: string) => withController(event, (c) => c.tabs.navigate(String(id), String(input))));
  ipcMain.handle("rome:browser:back", (event, id: string) => withController(event, (c) => c.tabs.goBack(String(id))));
  ipcMain.handle("rome:browser:forward", (event, id: string) => withController(event, (c) => c.tabs.goForward(String(id))));
  ipcMain.handle("rome:browser:reload", (event, id: string) => withController(event, (c) => c.tabs.reload(String(id))));
  ipcMain.handle("rome:browser:stop", (event, id: string) => withController(event, (c) => c.tabs.stop(String(id))));
  ipcMain.handle("rome:browser:home", (event, id: string) => withController(event, (c) => c.tabs.home(String(id))));
  ipcMain.handle("rome:browser:set-zoom", (event, id: string, value: number) => withController(event, (c) => c.tabs.setZoom(String(id), Number(value))));
  ipcMain.handle("rome:browser:recover", (event, id: string) => withController(event, (c) => c.tabs.recover(String(id))));
  ipcMain.handle("rome:browser:open-external", (event, id: string) => withController(event, (c) => c.tabs.openExternal(String(id))));
  ipcMain.handle("rome:browser:set-viewport", (event, viewport: BrowserViewport) => withController(event, (c) => c.setViewport(viewport)));
  ipcMain.handle("rome:browser:set-fullscreen", (event, value: boolean) => withController(event, (c) => c.setFullscreen(Boolean(value))));
  ipcMain.handle("rome:browser:get-opacity", (event) => withController(event, (c) => c.tabs.getOpacity()));
  ipcMain.handle("rome:browser:set-opacity", (event, value: number) => withController(event, (c) => c.tabs.setOpacity(Number(value))));
  ipcMain.handle("rome:browser:get-text-color", (event) => withController(event, (c) => c.tabs.getTextColor()));
  ipcMain.handle("rome:browser:set-text-color", (event, value: string | null) => withController(event, (c) => c.tabs.setTextColor(value == null ? null : String(value))));
  ipcMain.handle("rome:browser:get-history", (event) => withController(event, (c) => c.storage.getHistory()));
  ipcMain.handle("rome:browser:clear-history", (event) => withController(event, (c) => c.storage.clearHistory()));
  ipcMain.handle("rome:browser:get-bookmarks", (event) => withController(event, (c) => c.storage.getBookmarks()));
  ipcMain.handle("rome:browser:toggle-bookmark", (event, url: string, title: string) => withController(event, (c) => c.storage.toggleBookmark(String(url), String(title))));
  ipcMain.handle("rome:browser:get-downloads", (event) => withController(event, (c) => c.downloads.list()));
  ipcMain.handle("rome:browser:open-download", (event, id: string) => withController(event, (c) => c.downloads.open(String(id))));
  ipcMain.handle("rome:browser:show-download", (event, id: string) => withController(event, (c) => c.downloads.showInFolder(String(id))));
  ipcMain.handle("rome:browser:permission-response", (event, id: string, allowed: boolean) => withController(event, (c) => c.permissions.respond(String(id), Boolean(allowed))));
}
