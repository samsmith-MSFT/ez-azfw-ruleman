/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

interface Window {
  api: import('./shared/ipc').AzNetApi;
}
