import { contextBridge, ipcRenderer } from 'electron';
import { createElectronAPI } from './api';

// Create the unified API by combining all domain-specific APIs
const electronAPI = createElectronAPI();

// Expose to renderer via contextBridge
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Expose debug flag for debug logging
contextBridge.exposeInMainWorld('DEBUG', process.env.DEBUG === 'true');

// Console bridge: Forward renderer console errors to main process for visibility
// This allows Claude Code to see React errors in the terminal output
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.error = (...args: unknown[]) => {
  originalConsoleError.apply(console, args);
  try {
    const message = args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    ipcRenderer.send('renderer-console', { level: 'error', message });
  } catch {
    // Ignore serialization errors
  }
};

console.warn = (...args: unknown[]) => {
  originalConsoleWarn.apply(console, args);
  try {
    const message = args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    ipcRenderer.send('renderer-console', { level: 'warn', message });
  } catch {
    // Ignore serialization errors
  }
};

// Capture unhandled errors and rejections
window.addEventListener('error', (event) => {
  ipcRenderer.send('renderer-console', {
    level: 'error',
    message: `Uncaught Error: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`
  });
});

window.addEventListener('unhandledrejection', (event) => {
  ipcRenderer.send('renderer-console', {
    level: 'error',
    message: `Unhandled Promise Rejection: ${event.reason}`
  });
});
