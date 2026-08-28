/**
 * IPC for the calendar connection.
 *
 * Note what is absent: there is no channel that returns the app-specific
 * password. The renderer may write one and may ask whether one exists; reading
 * it back is not a capability that exists anywhere in the bridge.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { KronosController } from "./kronos-controller";
import type { KronosPublicConfig } from "./kronos-settings";

export function registerKronosIpc(getController: () => KronosController | null): void {
  const withController = <T>(event: IpcMainInvokeEvent, fn: (controller: KronosController) => T): T => {
    const controller = getController();
    if (!controller || !controller.owns(event.sender.id)) throw new Error("Unauthorized Kronos IPC sender.");
    return fn(controller);
  };

  ipcMain.handle("rome:kronos:get-config", event =>
    withController(event, controller => controller.config()));

  ipcMain.handle("rome:kronos:update-config", (event, patch: unknown) =>
    withController(event, controller => controller.updateConfig((patch ?? {}) as Partial<KronosPublicConfig>)));

  ipcMain.handle("rome:kronos:set-password", (event, value: unknown) =>
    withController(event, controller => controller.setPassword(String(value ?? ""))));

  ipcMain.handle("rome:kronos:verify", event =>
    withController(event, controller => controller.verify()));

  ipcMain.handle("rome:kronos:create-calendar", (event, name: unknown) =>
    withController(event, controller => controller.createCalendar(String(name ?? "ROME").slice(0, 100))));

  ipcMain.handle("rome:kronos:disconnect", event =>
    withController(event, controller => controller.disconnect()));

  ipcMain.handle("rome:kronos:sync-status", event =>
    withController(event, controller => controller.syncStatus()));

  ipcMain.handle("rome:kronos:sync-now", (event, dryRun: unknown) =>
    withController(event, controller => controller.syncNow(Boolean(dryRun))));

  // No URL from the renderer: the destination is a constant in the controller.
  ipcMain.handle("rome:kronos:open-apple-id", event =>
    withController(event, controller => controller.openAppleIdPage()));
}
