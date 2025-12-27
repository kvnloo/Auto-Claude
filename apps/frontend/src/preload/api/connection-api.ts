import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';

/**
 * Backend mode - indicates if this instance is primary (runs backend) or secondary (client mode)
 */
export type BackendMode = 'primary' | 'secondary';

/**
 * Connection state for client mode WebSocket
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * Connection status result from IPC
 */
export interface ConnectionStatusResult {
  /** Current connection state */
  state: ConnectionState;
  /** Whether client mode is active */
  isActive: boolean;
  /** Backend address if connected */
  backendAddress: string | null;
  /** Number of events received */
  eventsReceived: number;
  /** Number of reconnection attempts */
  reconnectAttempts: number;
}

export interface ConnectionAPI {
  /**
   * Get whether this instance is running as primary (backend owner) or secondary (client)
   */
  getBackendMode: () => Promise<IPCResult<BackendMode>>;

  /**
   * Get the current connection status for secondary instances
   */
  getConnectionStatus: () => Promise<IPCResult<ConnectionStatusResult>>;

  /**
   * Trigger a reconnection attempt for secondary instances
   */
  reconnect: () => Promise<IPCResult<void>>;

  /**
   * Subscribe to connection status changes
   * @param callback - Called when connection state changes
   * @returns Cleanup function to unsubscribe
   */
  onConnectionStatusChange: (
    callback: (state: ConnectionState) => void
  ) => () => void;
}

export const createConnectionAPI = (): ConnectionAPI => ({
  getBackendMode: (): Promise<IPCResult<BackendMode>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_GET_BACKEND_MODE),

  getConnectionStatus: (): Promise<IPCResult<ConnectionStatusResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_GET_STATUS),

  reconnect: (): Promise<IPCResult<void>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_RECONNECT),

  onConnectionStatusChange: (
    callback: (state: ConnectionState) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: ConnectionState
    ): void => {
      callback(state);
    };
    ipcRenderer.on(IPC_CHANNELS.CONNECTION_STATUS_CHANGE, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.CONNECTION_STATUS_CHANGE, handler);
    };
  }
});
