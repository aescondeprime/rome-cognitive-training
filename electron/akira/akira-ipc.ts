import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { AkiraRendererCommandResult, AkiraSecretName, AkiraSettings } from "../../shared/akira";
import type { AkiraController } from "./controller";

export function registerAkiraIpc(getController: () => AkiraController | null): void {
  const withController = <T>(event: IpcMainInvokeEvent, fn: (controller: AkiraController) => T): T => {
    const controller = getController();
    if (!controller || !controller.owns(event.sender.id)) throw new Error("Unauthorized Akira IPC sender.");
    return fn(controller);
  };

  ipcMain.handle("rome:akira:status", event => withController(event, controller => controller.status()));
  ipcMain.handle("rome:akira:activate", (event, viaWakeWord: unknown) => withController(event, controller => controller.activate(Boolean(viaWakeWord))));
  ipcMain.handle("rome:akira:standby", event => withController(event, controller => controller.standby()));
  ipcMain.handle("rome:akira:interrupt", event => withController(event, controller => controller.interrupt()));
  ipcMain.handle("rome:akira:submit-text", (event, text: unknown) => withController(event, controller => controller.submitText(String(text ?? ""))));
  ipcMain.handle("rome:akira:transcribe", (event, dataUrl: unknown, mimeType: unknown) => withController(event, controller => controller.transcribe(String(dataUrl ?? ""), String(mimeType ?? ""))));
  // Microphone frames arrive continuously while a conversation is live, so
  // these are `on`, not `handle` — a round-trip acknowledgement per 250ms chunk
  // would be pure overhead on the hottest path in the system.
  ipcMain.on("rome:akira:audio-chunk", (event, base64: unknown) => {
    const controller = getController();
    if (!controller || !controller.owns(event.sender.id)) return;
    controller.pushAudio(String(base64 ?? ""));
  });
  ipcMain.on("rome:akira:context", (event, text: unknown) => {
    const controller = getController();
    if (!controller || !controller.owns(event.sender.id)) return;
    controller.notifyContext(String(text ?? ""));
  });
  ipcMain.handle("rome:akira:approval-response", (event, id: unknown, approved: unknown) => withController(event, controller => controller.resolveApproval(String(id ?? ""), Boolean(approved))));
  ipcMain.handle("rome:akira:update-settings", (event, patch: Partial<AkiraSettings>) => withController(event, controller => controller.updateSettings(patch && typeof patch === "object" ? patch : {})));
  ipcMain.handle("rome:akira:set-secret", (event, name: AkiraSecretName, value: unknown) => withController(event, controller => controller.setSecret(name, String(value ?? ""))));
  ipcMain.handle("rome:akira:install-runtime", event => withController(event, controller => controller.installRuntime()));
  ipcMain.handle("rome:akira:activity", event => withController(event, controller => controller.listActivity()));
  ipcMain.handle("rome:akira:diagnostics", event => withController(event, controller => controller.diagnostics()));
  ipcMain.handle("rome:akira:capabilities", event => withController(event, controller => controller.listCapabilities()));
  ipcMain.handle("rome:akira:renderer-command-result", (event, result: AkiraRendererCommandResult) => withController(event, controller => controller.resolveRendererCommand(result)));
  ipcMain.handle("rome:akira:call-capability", (event, name: unknown, args: unknown) => withController(event, controller => controller.callCapability(String(name ?? ""), args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {})));
  ipcMain.handle("rome:akira:shortcut", (event, action: unknown) => withController(event, controller => controller.shortcut(String(action ?? ""))));
}
