/**
 * Client Mode Module for Secondary Instances
 *
 * Provides functionality for secondary instances to connect to an existing
 * primary backend. This enables multi-instance support where only the first
 * instance runs the backend, and subsequent instances connect as clients.
 *
 * Features:
 * - WebSocket client connection to primary backend
 * - Automatic reconnection with exponential backoff
 * - Event forwarding from WebSocket to renderer via IPC
 * - Connection state management for status reporting
 * - Graceful shutdown and cleanup
 *
 * Usage:
 * - Secondary instance: Call initializeClientMode(backendInfo) on startup
 * - Shutdown: Call shutdownClientMode() before quit
 *
 * Based on patterns from:
 * - apps/frontend/src/main/api/startup.ts (module structure)
 * - apps/frontend/src/main/api/websocket.ts (WebSocket message handling)
 * - apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts (IPC forwarding)
 */

import type { BrowserWindow } from 'electron';
import WebSocket from 'ws';

import { IPC_CHANNELS } from '../../shared/constants';
import type { BackendInfo } from './backend-discovery';
import type {
  WebSocketMessage,
  TaskProgressPayload,
  TaskStatusChangePayload,
  TaskLogPayload,
  TaskErrorPayload,
  TaskExecutionProgressPayload,
} from './types';

// ============================================
// Constants
// ============================================

/**
 * Initial reconnection delay (milliseconds)
 */
const INITIAL_RECONNECT_DELAY_MS = 1000;

/**
 * Maximum reconnection delay (milliseconds)
 */
const MAX_RECONNECT_DELAY_MS = 30000;

/**
 * Reconnection backoff multiplier
 */
const RECONNECT_BACKOFF_MULTIPLIER = 2;

/**
 * Ping interval for connection health (milliseconds)
 */
const PING_INTERVAL_MS = 30000;

// ============================================
// Types
// ============================================

/**
 * Connection state for the WebSocket client
 */
export type ClientConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * Client mode initialization options
 */
export interface ClientModeOptions {
  /** Enable verbose logging */
  debug?: boolean;
  /** Function to get the main BrowserWindow for IPC forwarding */
  getMainWindow?: () => BrowserWindow | null;
}

/**
 * Client mode initialization result
 */
export interface ClientModeResult {
  /** Whether initialization was successful */
  success: boolean;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Client mode shutdown result
 */
export interface ClientModeShutdownResult {
  /** Whether shutdown completed successfully */
  success: boolean;
  /** Error message (if any) */
  error?: string;
  /** Number of events received before shutdown */
  eventsReceived: number;
  /** Connection uptime before shutdown (milliseconds) */
  uptimeMs: number;
}

/**
 * Client mode status information
 */
export interface ClientModeStatus {
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
  /** Connection uptime (milliseconds) */
  uptimeMs: number | null;
}

// ============================================
// Module State
// ============================================

/**
 * Current connection state
 */
let connectionState: ClientConnectionState = 'disconnected';

/**
 * WebSocket client instance
 */
let wsClient: WebSocket | null = null;

/**
 * Backend info for the current connection
 */
let currentBackendInfo: BackendInfo | null = null;

/**
 * Reference to the main window getter
 */
let getMainWindowRef: (() => BrowserWindow | null) | null = null;

/**
 * Debug mode flag
 */
let debugMode = false;

/**
 * Whether client mode has been initialized
 */
let isInitialized = false;

/**
 * Timestamp when connection was established
 */
let connectionEstablishedAt: Date | null = null;

/**
 * Count of events received
 */
let eventsReceivedCount = 0;

/**
 * Current reconnection delay
 */
let currentReconnectDelay = INITIAL_RECONNECT_DELAY_MS;

/**
 * Number of reconnection attempts
 */
let reconnectAttempts = 0;

/**
 * Reconnection timeout handle
 */
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Ping interval handle
 */
let pingInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Whether shutdown has been requested
 */
let shutdownRequested = false;

// ============================================
// Internal Helpers
// ============================================

/**
 * Log a debug message if debug mode is enabled
 */
function debugLog(message: string): void {
  if (debugMode) {
    process.stdout.write(`[ClientMode] ${message}\n`);
  }
}

/**
 * Log an error message
 */
function errorLog(message: string): void {
  process.stderr.write(`[ClientMode] ${message}\n`);
}

/**
 * Update connection state and notify renderer
 */
function setConnectionState(newState: ClientConnectionState): void {
  if (connectionState === newState) {
    return;
  }
  connectionState = newState;
  debugLog(`Connection state changed to: ${newState}`);

  // Notify renderer of state change
  sendToRenderer(IPC_CHANNELS.CONNECTION_STATUS_CHANGE, newState);
}

/**
 * Get the WebSocket URL for the backend
 */
function getWebSocketUrl(backendInfo: BackendInfo): string {
  const apiKey = process.env.API_KEY || '';
  // Use the WebSocket address from backend info, append API key for authentication
  return `${backendInfo.wsAddress}?api_key=${encodeURIComponent(apiKey)}`;
}

/**
 * Send event to renderer via IPC
 */
function sendToRenderer(channel: string, ...args: unknown[]): void {
  const mainWindow = getMainWindowRef?.();
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send(channel, ...args);
    } catch (error) {
      errorLog(`Failed to send to renderer: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Handle incoming WebSocket message
 */
function handleWebSocketMessage(data: WebSocket.RawData): void {
  eventsReceivedCount++;

  let message: WebSocketMessage<unknown>;
  try {
    const messageStr = data.toString('utf-8');
    message = JSON.parse(messageStr);
  } catch (error) {
    errorLog(`Failed to parse WebSocket message: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  debugLog(`Received message: ${message.type}`);

  switch (message.type) {
    case 'task-progress': {
      const payload = message.payload as TaskProgressPayload;
      if (payload?.taskId && payload?.plan) {
        sendToRenderer(IPC_CHANNELS.TASK_PROGRESS, payload.taskId, payload.plan);
      }
      break;
    }

    case 'task-status-change': {
      const payload = message.payload as TaskStatusChangePayload;
      if (payload?.taskId && payload?.status) {
        sendToRenderer(IPC_CHANNELS.TASK_STATUS_CHANGE, payload.taskId, payload.status);
      }
      break;
    }

    case 'task-log': {
      const payload = message.payload as TaskLogPayload;
      if (payload?.taskId && payload?.log) {
        sendToRenderer(IPC_CHANNELS.TASK_LOG, payload.taskId, payload.log);
      }
      break;
    }

    case 'task-error': {
      const payload = message.payload as TaskErrorPayload;
      if (payload?.taskId && payload?.error) {
        sendToRenderer(IPC_CHANNELS.TASK_ERROR, payload.taskId, payload.error);
      }
      break;
    }

    case 'task-execution-progress': {
      const payload = message.payload as TaskExecutionProgressPayload;
      if (payload?.taskId && payload?.progress) {
        sendToRenderer(IPC_CHANNELS.TASK_EXECUTION_PROGRESS, payload.taskId, payload.progress);
      }
      break;
    }

    case 'pong': {
      // Connection health response - no action needed
      debugLog('Received pong');
      break;
    }

    case 'subscribe': {
      // Subscription acknowledgment
      debugLog('Subscription acknowledged');
      break;
    }

    case 'error': {
      const payload = message.payload as { code?: string; message?: string };
      errorLog(`Server error: ${payload?.code} - ${payload?.message}`);
      break;
    }

    default: {
      debugLog(`Unknown message type: ${message.type}`);
    }
  }
}

/**
 * Send subscription message to subscribe to all task events
 */
function sendSubscription(): void {
  if (wsClient?.readyState === WebSocket.OPEN) {
    const subscribeMessage = JSON.stringify({
      type: 'subscribe',
      payload: {
        // Empty arrays = subscribe to all tasks/projects/events
        taskIds: [],
        events: ['task-progress', 'task-status-change', 'task-log', 'task-error', 'task-execution-progress'],
      },
      timestamp: new Date().toISOString(),
    });
    wsClient.send(subscribeMessage);
    debugLog('Sent subscription request');
  }
}

/**
 * Send ping message for connection health
 */
function sendPing(): void {
  if (wsClient?.readyState === WebSocket.OPEN) {
    const pingMessage = JSON.stringify({
      type: 'ping',
      timestamp: new Date().toISOString(),
    });
    wsClient.send(pingMessage);
  }
}

/**
 * Start ping interval for connection health monitoring
 */
function startPingInterval(): void {
  stopPingInterval();
  pingInterval = setInterval(sendPing, PING_INTERVAL_MS);
}

/**
 * Stop ping interval
 */
function stopPingInterval(): void {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

/**
 * Schedule reconnection with exponential backoff
 */
function scheduleReconnect(): void {
  if (shutdownRequested || !currentBackendInfo) {
    return;
  }

  // Clear any existing reconnect timeout
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }

  reconnectAttempts++;
  setConnectionState('reconnecting');

  debugLog(`Scheduling reconnect in ${currentReconnectDelay}ms (attempt ${reconnectAttempts})`);

  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    if (!shutdownRequested && currentBackendInfo) {
      connectToBackend(currentBackendInfo);
    }
  }, currentReconnectDelay);

  // Increase delay for next attempt (exponential backoff)
  currentReconnectDelay = Math.min(
    currentReconnectDelay * RECONNECT_BACKOFF_MULTIPLIER,
    MAX_RECONNECT_DELAY_MS
  );
}

/**
 * Reset reconnection state after successful connection
 */
function resetReconnectState(): void {
  currentReconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  reconnectAttempts = 0;
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
}

/**
 * Connect to the backend WebSocket
 */
function connectToBackend(backendInfo: BackendInfo): void {
  // Clean up existing connection
  if (wsClient) {
    try {
      wsClient.removeAllListeners();
      wsClient.close();
    } catch {
      // Ignore cleanup errors
    }
    wsClient = null;
  }

  setConnectionState('connecting');
  currentBackendInfo = backendInfo;

  const wsUrl = getWebSocketUrl(backendInfo);
  debugLog(`Connecting to WebSocket: ${backendInfo.wsAddress}`);

  try {
    wsClient = new WebSocket(wsUrl);

    wsClient.on('open', () => {
      debugLog('WebSocket connected');
      setConnectionState('connected');
      connectionEstablishedAt = new Date();
      resetReconnectState();

      // Subscribe to all task events
      sendSubscription();

      // Start ping interval for connection health
      startPingInterval();
    });

    wsClient.on('message', (data) => {
      handleWebSocketMessage(data);
    });

    wsClient.on('close', (code, reason) => {
      debugLog(`WebSocket closed: code=${code} reason=${reason.toString('utf-8')}`);
      setConnectionState('disconnected');
      stopPingInterval();

      // Schedule reconnection unless shutdown was requested or server is shutting down
      if (!shutdownRequested && code !== 1001) {
        scheduleReconnect();
      }
    });

    wsClient.on('error', (error) => {
      errorLog(`WebSocket error: ${error.message}`);
      // Error will be followed by close event, which will trigger reconnection
    });

  } catch (error) {
    errorLog(`Failed to create WebSocket: ${error instanceof Error ? error.message : String(error)}`);
    setConnectionState('disconnected');
    scheduleReconnect();
  }
}

// ============================================
// Public API
// ============================================

/**
 * Initialize client mode for secondary instance
 *
 * Connects to the primary backend's WebSocket and sets up event forwarding
 * to the renderer process via IPC.
 *
 * @param backendInfo - Information about the primary backend to connect to
 * @param options - Optional configuration
 * @returns Result indicating success or failure
 */
export function initializeClientMode(
  backendInfo: BackendInfo,
  options: ClientModeOptions = {}
): ClientModeResult {
  // Prevent double initialization
  if (isInitialized) {
    return {
      success: true,
    };
  }

  debugMode = options.debug ?? false;
  getMainWindowRef = options.getMainWindow ?? null;

  debugLog('Initializing client mode');
  debugLog(`Backend: ${backendInfo.address}`);

  // Reset state
  eventsReceivedCount = 0;
  shutdownRequested = false;
  isInitialized = true;

  // Connect to the backend
  try {
    connectToBackend(backendInfo);
    return {
      success: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errorLog(`Initialization failed: ${errorMessage}`);
    isInitialized = false;
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Shutdown client mode and cleanup resources
 *
 * Closes the WebSocket connection and clears all timers.
 *
 * @returns Result with shutdown statistics
 */
export function shutdownClientMode(): ClientModeShutdownResult {
  debugLog('Shutting down client mode');

  shutdownRequested = true;

  const result: ClientModeShutdownResult = {
    success: true,
    eventsReceived: eventsReceivedCount,
    uptimeMs: connectionEstablishedAt
      ? Date.now() - connectionEstablishedAt.getTime()
      : 0,
  };

  // Stop ping interval
  stopPingInterval();

  // Clear reconnect timeout
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // Close WebSocket connection
  if (wsClient) {
    try {
      wsClient.removeAllListeners();
      wsClient.close(1000, 'Client shutdown');
      wsClient = null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errorLog(`Error closing WebSocket: ${errorMessage}`);
      result.success = false;
      result.error = errorMessage;
    }
  }

  // Reset state (use direct assignment since we're shutting down and may not have a window)
  connectionState = 'disconnected';
  currentBackendInfo = null;
  connectionEstablishedAt = null;
  isInitialized = false;

  debugLog(`Shutdown complete. Events received: ${result.eventsReceived}, Uptime: ${result.uptimeMs}ms`);

  return result;
}

/**
 * Get the current client mode status
 *
 * @returns Status information about the client mode connection
 */
export function getClientModeStatus(): ClientModeStatus {
  return {
    state: connectionState,
    isActive: isInitialized,
    backendAddress: currentBackendInfo?.address ?? null,
    eventsReceived: eventsReceivedCount,
    reconnectAttempts,
    uptimeMs: connectionEstablishedAt
      ? Date.now() - connectionEstablishedAt.getTime()
      : null,
  };
}

/**
 * Check if client mode is currently active
 */
export function isClientModeActive(): boolean {
  return isInitialized;
}

/**
 * Check if client mode is connected
 */
export function isClientModeConnected(): boolean {
  return connectionState === 'connected';
}

/**
 * Get the current connection state
 */
export function getConnectionState(): ClientConnectionState {
  return connectionState;
}

/**
 * Manually trigger reconnection
 *
 * Useful when the user wants to retry connection after failures.
 */
export function reconnect(): void {
  if (!isInitialized || !currentBackendInfo) {
    errorLog('Cannot reconnect: client mode not initialized');
    return;
  }

  if (shutdownRequested) {
    errorLog('Cannot reconnect: shutdown in progress');
    return;
  }

  debugLog('Manual reconnection requested');
  resetReconnectState();
  connectToBackend(currentBackendInfo);
}
