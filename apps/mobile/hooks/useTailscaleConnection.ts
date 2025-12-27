/**
 * React hook for managing Tailscale connection state machine
 *
 * Manages the connection lifecycle: disconnected → connecting → connected → error
 * Listens to NetInfo events and handles AppState for background/foreground transitions.
 *
 * @see spec.md - Technical Architecture - Connection State Machine
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import {
  configureNetInfo,
  checkTailscaleConnectivity,
  createConnectionMonitor,
  isNetInfoSetUp,
  resetNetInfoConfiguration,
  type TailscaleConnectionStatus,
} from '../api/tailscale';
import {
  useSettingsStore,
  getHealthCheckUrl,
} from '../stores/settingsStore';
import type { ConnectionState, ConnectionError } from '../types/settings';
import { constructHealthCheckUrl } from '../utils/validation';

// ============================================
// Types
// ============================================

/**
 * Options for the useTailscaleConnection hook
 */
export interface UseTailscaleConnectionOptions {
  /**
   * Whether to automatically connect when the hook mounts
   * and tailscaleIp is configured
   * @default true
   */
  autoConnect?: boolean;

  /**
   * Callback when connection state changes
   */
  onStateChange?: (state: ConnectionState) => void;

  /**
   * Callback when an error occurs
   */
  onError?: (error: ConnectionError) => void;

  /**
   * Callback when successfully connected
   */
  onConnected?: () => void;

  /**
   * Callback when disconnected
   */
  onDisconnected?: () => void;
}

/**
 * Return type for the useTailscaleConnection hook
 */
export interface UseTailscaleConnectionResult {
  /**
   * Current connection state
   */
  state: ConnectionState;

  /**
   * Whether the connection is currently active
   */
  isConnected: boolean;

  /**
   * Whether connection is currently being established
   */
  isConnecting: boolean;

  /**
   * Whether in a disconnected state
   */
  isDisconnected: boolean;

  /**
   * Whether in an error state
   */
  hasError: boolean;

  /**
   * Current connection error, if any
   */
  error: ConnectionError | null;

  /**
   * Whether Tailscale IP is configured in settings
   */
  isConfigured: boolean;

  /**
   * Initiate connection to Tailscale server
   */
  connect: () => Promise<void>;

  /**
   * Disconnect from Tailscale server
   */
  disconnect: () => void;

  /**
   * Retry connection after an error
   */
  retry: () => Promise<void>;

  /**
   * Force a connectivity check
   */
  checkConnection: () => Promise<TailscaleConnectionStatus>;
}

// ============================================
// Constants
// ============================================

/**
 * Minimum time between connection attempts (ms)
 */
const MIN_CONNECT_INTERVAL = 1000;

/**
 * Timeout for initial connection attempt (ms)
 */
const CONNECT_TIMEOUT = 15000;

// ============================================
// Hook Implementation
// ============================================

/**
 * React hook for managing Tailscale connection state
 *
 * Provides connection state machine management with automatic
 * NetInfo monitoring and AppState handling.
 *
 * @param options - Hook configuration options
 * @returns Connection state and control functions
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *   const {
 *     state,
 *     isConnected,
 *     error,
 *     connect,
 *     disconnect,
 *     retry
 *   } = useTailscaleConnection({
 *     autoConnect: true,
 *     onConnected: () => console.log('Connected!'),
 *     onError: (err) => console.error('Error:', err.message)
 *   });
 *
 *   if (!isConnected) {
 *     return <ReconnectBanner onRetry={retry} />;
 *   }
 *
 *   return <AppContent />;
 * }
 * ```
 */
export function useTailscaleConnection(
  options: UseTailscaleConnectionOptions = {}
): UseTailscaleConnectionResult {
  const {
    autoConnect = true,
    onStateChange,
    onError,
    onConnected,
    onDisconnected,
  } = options;

  // Refs for cleanup and state tracking
  const abortControllerRef = useRef<AbortController | null>(null);
  const monitorUnsubscribeRef = useRef<(() => void) | null>(null);
  const lastConnectAttemptRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);
  const previousStateRef = useRef<ConnectionState>('disconnected');

  // Settings store state and actions
  const tailscaleIp = useSettingsStore((s) => s.connection.tailscaleIp);
  const apiPort = useSettingsStore((s) => s.connection.apiPort);
  const isStoreConfigured = useSettingsStore((s) => s.connection.isConfigured);
  const connectionState = useSettingsStore((s) => s.connectionState);
  const connectionError = useSettingsStore((s) => s.connectionError);
  const setConnectionState = useSettingsStore((s) => s.setConnectionState);
  const setConnectionError = useSettingsStore((s) => s.setConnectionError);
  const markConnected = useSettingsStore((s) => s.markConnected);
  const markDisconnected = useSettingsStore((s) => s.markDisconnected);

  // Track if configured
  const [isConfigured, setIsConfigured] = useState<boolean>(isStoreConfigured && Boolean(tailscaleIp));

  // Update isConfigured when settings change
  useEffect(() => {
    setIsConfigured(isStoreConfigured && Boolean(tailscaleIp));
  }, [isStoreConfigured, tailscaleIp]);

  // Call state change callbacks when state changes
  useEffect(() => {
    if (connectionState !== previousStateRef.current) {
      previousStateRef.current = connectionState;
      onStateChange?.(connectionState);

      if (connectionState === 'connected') {
        onConnected?.();
      } else if (connectionState === 'disconnected') {
        onDisconnected?.();
      }
    }
  }, [connectionState, onStateChange, onConnected, onDisconnected]);

  // Call error callback when error changes
  useEffect(() => {
    if (connectionError) {
      onError?.(connectionError);
    }
  }, [connectionError, onError]);

  /**
   * Get the health check URL for the current configuration
   */
  const getHealthUrl = useCallback((): string | null => {
    if (!tailscaleIp) {
      return null;
    }
    return constructHealthCheckUrl(tailscaleIp, apiPort);
  }, [tailscaleIp, apiPort]);

  /**
   * Cancel any ongoing connection attempt
   */
  const cancelOngoingConnection = useCallback((): void => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  /**
   * Stop the connection monitor
   */
  const stopMonitor = useCallback((): void => {
    if (monitorUnsubscribeRef.current) {
      monitorUnsubscribeRef.current();
      monitorUnsubscribeRef.current = null;
    }
  }, []);

  /**
   * Handle connection status updates from the monitor
   */
  const handleStatusUpdate = useCallback(
    (status: TailscaleConnectionStatus): void => {
      if (!isMountedRef.current) return;

      // Update store based on status
      setConnectionState(status.state);

      if (status.error) {
        setConnectionError(status.error);
      }

      if (status.state === 'connected') {
        markConnected();
      } else if (status.state === 'disconnected') {
        // Only mark disconnected if we're not actively trying to connect
        if (connectionState !== 'connecting') {
          markDisconnected();
        }
      }
    },
    [connectionState, setConnectionState, setConnectionError, markConnected, markDisconnected]
  );

  /**
   * Start the connection monitor
   */
  const startMonitor = useCallback((): void => {
    // Stop any existing monitor
    stopMonitor();

    const healthUrl = getHealthUrl();
    if (!healthUrl) return;

    // Create new monitor
    const { unsubscribe } = createConnectionMonitor(handleStatusUpdate, healthUrl);
    monitorUnsubscribeRef.current = unsubscribe;
  }, [getHealthUrl, handleStatusUpdate, stopMonitor]);

  /**
   * Perform a connection check
   */
  const checkConnection = useCallback(async (): Promise<TailscaleConnectionStatus> => {
    const healthUrl = getHealthUrl();
    const status = await checkTailscaleConnectivity(healthUrl, {
      signal: abortControllerRef.current?.signal,
    });
    return status;
  }, [getHealthUrl]);

  /**
   * Initiate connection to Tailscale server
   */
  const connect = useCallback(async (): Promise<void> => {
    // Rate limit connection attempts
    const now = Date.now();
    if (now - lastConnectAttemptRef.current < MIN_CONNECT_INTERVAL) {
      return;
    }
    lastConnectAttemptRef.current = now;

    // Check if configured
    if (!tailscaleIp) {
      setConnectionState('disconnected');
      return;
    }

    // Cancel any ongoing connection
    cancelOngoingConnection();

    // Create new abort controller for this connection attempt
    abortControllerRef.current = new AbortController();

    // Set state to connecting
    setConnectionState('connecting');
    setConnectionError(null);

    try {
      // Configure NetInfo for this Tailscale IP if not already configured
      // or if the IP has changed
      if (!isNetInfoSetUp()) {
        configureNetInfo({ tailscaleIp, port: apiPort });
      }

      // Perform initial connectivity check with timeout
      const timeoutId = setTimeout(() => {
        abortControllerRef.current?.abort();
      }, CONNECT_TIMEOUT);

      const healthUrl = getHealthUrl();
      const status = await checkTailscaleConnectivity(healthUrl, {
        signal: abortControllerRef.current.signal,
      });

      clearTimeout(timeoutId);

      if (!isMountedRef.current) return;

      if (status.state === 'connected') {
        markConnected();
        // Start monitoring for ongoing connectivity changes
        startMonitor();
      } else {
        setConnectionState(status.state);
        if (status.error) {
          setConnectionError(status.error);
        }
      }
    } catch (error) {
      if (!isMountedRef.current) return;

      // Handle abort (not an error)
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      setConnectionState('error');
      setConnectionError({
        type: 'unknown',
        message: error instanceof Error ? error.message : 'Connection failed',
        timestamp: Date.now(),
      });
    }
  }, [
    tailscaleIp,
    apiPort,
    getHealthUrl,
    cancelOngoingConnection,
    setConnectionState,
    setConnectionError,
    markConnected,
    startMonitor,
  ]);

  /**
   * Disconnect from Tailscale server
   */
  const disconnect = useCallback((): void => {
    // Cancel any ongoing connection
    cancelOngoingConnection();

    // Stop the monitor
    stopMonitor();

    // Update state
    markDisconnected();
  }, [cancelOngoingConnection, stopMonitor, markDisconnected]);

  /**
   * Retry connection after an error
   */
  const retry = useCallback(async (): Promise<void> => {
    // Reset error state first
    setConnectionError(null);

    // Reset NetInfo configuration to force reconfiguration
    resetNetInfoConfiguration();

    // Attempt to connect again
    await connect();
  }, [connect, setConnectionError]);

  // Configure NetInfo when tailscaleIp changes
  useEffect(() => {
    if (tailscaleIp) {
      // Reset and reconfigure NetInfo for new IP
      resetNetInfoConfiguration();
      configureNetInfo({ tailscaleIp, port: apiPort });
    }
  }, [tailscaleIp, apiPort]);

  // Auto-connect on mount if configured
  useEffect(() => {
    if (autoConnect && isConfigured && connectionState === 'disconnected') {
      connect();
    }
  }, [autoConnect, isConfigured]); // Intentionally not including connect/connectionState to prevent loops

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      cancelOngoingConnection();
      stopMonitor();
    };
  }, [cancelOngoingConnection, stopMonitor]);

  // Handle AppState changes for background/foreground transitions
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus): void => {
      // When app comes to foreground, recheck connectivity
      if (nextAppState === 'active' && isConfigured && connectionState === 'connected') {
        // Perform a quick connectivity check
        checkConnection().then((status) => {
          if (isMountedRef.current && status.state !== 'connected') {
            // If we lost connection while in background, update state
            setConnectionState(status.state);
            if (status.error) {
              setConnectionError(status.error);
            }
          }
        });
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [isConfigured, connectionState, checkConnection, setConnectionState, setConnectionError]);

  // Derived state values
  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting';
  const isDisconnected = connectionState === 'disconnected';
  const hasError = connectionState === 'error';

  return {
    state: connectionState,
    isConnected,
    isConnecting,
    isDisconnected,
    hasError,
    error: connectionError,
    isConfigured,
    connect,
    disconnect,
    retry,
    checkConnection,
  };
}

// ============================================
// Convenience Hooks
// ============================================

/**
 * Simple hook to check if Tailscale is connected
 *
 * @returns true if connected to Tailscale server
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *   const isConnected = useTailscaleConnected();
 *
 *   if (!isConnected) {
 *     return <Text>Not connected</Text>;
 *   }
 *
 *   return <AppContent />;
 * }
 * ```
 */
export function useTailscaleConnected(): boolean {
  const connectionState = useSettingsStore((s) => s.connectionState);
  return connectionState === 'connected';
}

/**
 * Hook to get the current connection state
 *
 * @returns Current connection state
 *
 * @example
 * ```typescript
 * function StatusIndicator() {
 *   const state = useTailscaleState();
 *
 *   return <Text>Status: {state}</Text>;
 * }
 * ```
 */
export function useTailscaleState(): ConnectionState {
  return useSettingsStore((s) => s.connectionState);
}

/**
 * Hook to get the current connection error
 *
 * @returns Current connection error or null
 *
 * @example
 * ```typescript
 * function ErrorDisplay() {
 *   const error = useTailscaleError();
 *
 *   if (!error) return null;
 *
 *   return <Text>Error: {error.message}</Text>;
 * }
 * ```
 */
export function useTailscaleError(): ConnectionError | null {
  return useSettingsStore((s) => s.connectionError);
}
