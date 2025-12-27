/**
 * Connection Handlers - IPC handlers for multi-instance connection status
 *
 * These handlers expose the connection state of secondary instances to the
 * renderer process. Primary instances always report 'primary' mode, while
 * secondary instances report their WebSocket connection status.
 *
 * Based on patterns from:
 * - apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts (event forwarding)
 * - apps/frontend/src/main/ipc-handlers/settings-handlers.ts (ipcMain.handle pattern)
 */

import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import {
  getClientModeStatus,
  isClientModeActive,
  reconnect as clientModeReconnect,
  type ClientConnectionState
} from '../api/client-mode';

/**
 * Backend mode - indicates if this instance is primary (runs backend) or secondary (client mode)
 */
export type BackendMode = 'primary' | 'secondary';

/**
 * Connection status result from IPC
 */
export interface ConnectionStatusResult {
  /** Current connection state */
  state: ClientConnectionState;
  /** Whether client mode is active */
  isActive: boolean;
  /** Backend address if connected */
  backendAddress: string | null;
  /** Number of events received */
  eventsReceived: number;
  /** Number of reconnection attempts */
  reconnectAttempts: number;
}

/**
 * Module state: whether this instance is primary or secondary
 */
let instanceMode: BackendMode = 'primary';

/**
 * Reference to main window getter for sending status change events
 */
let mainWindowGetter: (() => BrowserWindow | null) | null = null;

/**
 * Set the instance mode (called during initialization)
 */
export function setInstanceMode(mode: BackendMode): void {
  instanceMode = mode;
}

/**
 * Get the current instance mode
 */
export function getInstanceMode(): BackendMode {
  return instanceMode;
}

/**
 * Send connection status change to renderer
 */
export function notifyConnectionStatusChange(state: ClientConnectionState): void {
  const mainWindow = mainWindowGetter?.();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.CONNECTION_STATUS_CHANGE, state);
  }
}

/**
 * Register connection-related IPC handlers
 *
 * @param getMainWindow - Function to get the main BrowserWindow
 */
export function registerConnectionHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  // Store the main window getter for event forwarding
  mainWindowGetter = getMainWindow;

  // ============================================
  // Get backend mode (primary vs secondary)
  // ============================================
  ipcMain.handle(
    IPC_CHANNELS.CONNECTION_GET_BACKEND_MODE,
    async (): Promise<IPCResult<BackendMode>> => {
      return {
        success: true,
        data: instanceMode
      };
    }
  );

  // ============================================
  // Get connection status (for secondary instances)
  // ============================================
  ipcMain.handle(
    IPC_CHANNELS.CONNECTION_GET_STATUS,
    async (): Promise<IPCResult<ConnectionStatusResult>> => {
      if (instanceMode === 'primary') {
        // Primary instance is always "connected" to itself
        return {
          success: true,
          data: {
            state: 'connected',
            isActive: false,
            backendAddress: null,
            eventsReceived: 0,
            reconnectAttempts: 0
          }
        };
      }

      // Secondary instance: get actual client mode status
      const status = getClientModeStatus();
      return {
        success: true,
        data: {
          state: status.state,
          isActive: status.isActive,
          backendAddress: status.backendAddress,
          eventsReceived: status.eventsReceived,
          reconnectAttempts: status.reconnectAttempts
        }
      };
    }
  );

  // ============================================
  // Trigger reconnection (for secondary instances)
  // ============================================
  ipcMain.handle(
    IPC_CHANNELS.CONNECTION_RECONNECT,
    async (): Promise<IPCResult<void>> => {
      if (instanceMode === 'primary') {
        return {
          success: false,
          error: 'Primary instance does not need reconnection'
        };
      }

      if (!isClientModeActive()) {
        return {
          success: false,
          error: 'Client mode is not active'
        };
      }

      try {
        clientModeReconnect();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );
}
