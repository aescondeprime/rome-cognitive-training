// Type declarations for Electron context bridge APIs
interface Window {
  romeDesktop?: {
    getDataDir: () => Promise<string>;
    getDbPath: () => Promise<string>;
    getAppVersion: () => Promise<string>;
    isDesktop: boolean;
  };
}
