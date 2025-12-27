/**
 * Tailscale connection detection and monitoring utilities
 *
 * Provides functions to configure NetInfo for Tailscale network detection,
 * check connectivity status, and monitor connection changes.
 *
 * @see spec.md - Tailscale Connectivity Detection
 */

import NetInfo, {
  NetInfoState,
  NetInfoSubscription,
  type NetInfoConfiguration,
} from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';

import { constructHealthCheckUrl, DEFAULT_API_PORT } from '../utils/validation';
import type { ConnectionState, ConnectionError, ConnectionErrorType } from '../types/settings';

// ============================================
// Constants
// ============================================

/**
 * Default NetInfo configuration timeouts for Tailscale health checks
 * These are tuned for mobile network conditions
 */
export const NETINFO_TIMEOUTS = {
  /**
   * Long timeout for reachability checks (15 seconds)
   * Used when connectivity might be recovering
   */
  REACHABILITY_LONG: 15 * 1000,

  /**
   * Short timeout for quick checks (5 seconds)
   * Used for periodic health checks
   */
  REACHABILITY_SHORT: 5 * 1000,

  /**
   * Request timeout (10 seconds)
   * Maximum time to wait for health check response
   */
  REQUEST: 10 * 1000,
} as const;

/**
 * Health check polling interval (30 seconds)
 * Only used when actively monitoring connection
 */
export const HEALTH_CHECK_INTERVAL = 30 * 1000;

/**
 * Minimum interval between health checks (2 seconds)
 * Prevents excessive checking during rapid state changes
 */
export const MIN_HEALTH_CHECK_INTERVAL = 2 * 1000;

// ============================================
// Types
// ============================================

/**
 * Result of a health check
 */
export interface HealthCheckResult {
  success: boolean;
  isReachable: boolean;
  latencyMs?: number;
  error?: ConnectionError;
}

/**
 * Tailscale connection status
 */
export interface TailscaleConnectionStatus {
  state: ConnectionState;
  isReachable: boolean;
  lastChecked: number | null;
  error: ConnectionError | null;
}

/**
 * Callback for connection state changes
 */
export type ConnectionStateCallback = (status: TailscaleConnectionStatus) => void;

/**
 * Callback for NetInfo state changes
 */
export type NetInfoStateCallback = (state: NetInfoState) => void;

/**
 * Options for configuring NetInfo
 */
export interface ConfigureNetInfoOptions {
  tailscaleIp: string;
  port?: number;
}

/**
 * Options for checking connectivity
 */
export interface CheckConnectivityOptions {
  timeout?: number;
  signal?: AbortSignal;
}

// ============================================
// NetInfo Configuration
// ============================================

/**
 * Track whether NetInfo has been configured
 * Prevents reconfiguration warnings
 */
let isNetInfoConfigured = false;

/**
 * Current reachability URL for reference
 */
let currentReachabilityUrl: string | null = null;

/**
 * Configure NetInfo with Tailscale health endpoint as reachability URL
 *
 * IMPORTANT: This should be called BEFORE creating any QueryClient or
 * adding NetInfo listeners to ensure proper configuration.
 *
 * @param options - Configuration options
 * @param options.tailscaleIp - Server's Tailscale IP address
 * @param options.port - API port (default: 3001)
 * @returns The configured reachability URL, or null if IP is invalid
 *
 * @example
 * ```typescript
 * const reachabilityUrl = configureNetInfo({ tailscaleIp: '100.64.1.1' });
 * if (reachabilityUrl) {
 *   // NetInfo is now configured for Tailscale connectivity detection
 * }
 * ```
 */
export function configureNetInfo(options: ConfigureNetInfoOptions): string | null {
  const { tailscaleIp, port = DEFAULT_API_PORT } = options;

  // Construct health check URL
  const reachabilityUrl = constructHealthCheckUrl(tailscaleIp, port);

  if (!reachabilityUrl) {
    return null;
  }

  // Configure NetInfo with custom reachability settings
  // Only provide the properties we need - NetInfo.configure accepts partial config
  const config: Partial<NetInfoConfiguration> = {
    reachabilityUrl,
    reachabilityTest: async (response: Response): Promise<boolean> => {
      return response.status === 200;
    },
    reachabilityLongTimeout: NETINFO_TIMEOUTS.REACHABILITY_LONG,
    reachabilityShortTimeout: NETINFO_TIMEOUTS.REACHABILITY_SHORT,
    reachabilityRequestTimeout: NETINFO_TIMEOUTS.REQUEST,
  };

  NetInfo.configure(config as NetInfoConfiguration);

  isNetInfoConfigured = true;
  currentReachabilityUrl = reachabilityUrl;

  return reachabilityUrl;
}

/**
 * Check if NetInfo has been configured
 *
 * @returns true if NetInfo has been configured with Tailscale settings
 */
export function isNetInfoSetUp(): boolean {
  return isNetInfoConfigured;
}

/**
 * Get the current reachability URL
 *
 * @returns The configured reachability URL or null if not configured
 */
export function getReachabilityUrl(): string | null {
  return currentReachabilityUrl;
}

/**
 * Reset NetInfo configuration state
 * Useful for testing or when changing Tailscale IP
 */
export function resetNetInfoConfiguration(): void {
  isNetInfoConfigured = false;
  currentReachabilityUrl = null;
}

// ============================================
// Connectivity Checking
// ============================================

/**
 * Fetch the current network state from NetInfo
 *
 * @returns Promise resolving to current network state
 */
export async function getNetworkState(): Promise<NetInfoState> {
  return NetInfo.fetch();
}

/**
 * Check if the Tailscale network is currently reachable
 *
 * Uses NetInfo's isInternetReachable property which is based on
 * the configured reachability URL (Tailscale health endpoint).
 *
 * @returns Promise resolving to true if Tailscale is reachable
 *
 * @example
 * ```typescript
 * const isReachable = await isTailscaleReachable();
 * if (!isReachable) {
 *   // Show reconnection UI
 * }
 * ```
 */
export async function isTailscaleReachable(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isInternetReachable === true;
  } catch {
    return false;
  }
}

/**
 * Perform a direct health check to the Tailscale server
 *
 * This bypasses NetInfo and makes a direct HTTP request to the health endpoint.
 * Use this when you need immediate verification or more control over the request.
 *
 * @param healthUrl - The health check URL to test
 * @param options - Additional options
 * @param options.timeout - Request timeout in milliseconds
 * @param options.signal - AbortSignal for request cancellation
 * @returns Promise resolving to health check result
 *
 * @example
 * ```typescript
 * const controller = new AbortController();
 * const result = await checkHealthEndpoint(
 *   'http://100.64.1.1:3001/api/health',
 *   { timeout: 5000, signal: controller.signal }
 * );
 * ```
 */
export async function checkHealthEndpoint(
  healthUrl: string,
  options: CheckConnectivityOptions = {}
): Promise<HealthCheckResult> {
  const { timeout = NETINFO_TIMEOUTS.REQUEST, signal } = options;

  const startTime = Date.now();

  // Create AbortController for timeout if not provided
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeout);

  // Combine signals if external signal provided
  const combinedSignal = signal
    ? createCombinedAbortSignal(signal, timeoutController.signal)
    : timeoutController.signal;

  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: combinedSignal,
    });

    clearTimeout(timeoutId);

    const latencyMs = Date.now() - startTime;
    const success = response.status === 200;

    if (!success) {
      return {
        success: false,
        isReachable: true, // Server was reached but returned error
        latencyMs,
        error: createConnectionError(
          response.status >= 500 ? 'server_error' : 'network_error',
          `Health check failed with status ${response.status}`
        ),
      };
    }

    return {
      success: true,
      isReachable: true,
      latencyMs,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    // Determine error type
    const errorType = getErrorType(error);
    const errorMessage = getErrorMessage(error);

    return {
      success: false,
      isReachable: false,
      error: createConnectionError(errorType, errorMessage),
    };
  }
}

/**
 * Create a combined AbortSignal from multiple signals
 *
 * @param signals - Abort signals to combine
 * @returns Combined signal that aborts when any input signal aborts
 */
function createCombinedAbortSignal(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  return controller.signal;
}

/**
 * Check Tailscale connectivity and return status
 *
 * Combines NetInfo state with optional direct health check for
 * comprehensive connectivity status.
 *
 * @param healthUrl - Optional health URL for direct check
 * @param options - Connectivity check options
 * @returns Promise resolving to connection status
 */
export async function checkTailscaleConnectivity(
  healthUrl?: string | null,
  options: CheckConnectivityOptions = {}
): Promise<TailscaleConnectionStatus> {
  try {
    const netInfoState = await NetInfo.fetch();

    // If no internet connection at all
    if (!netInfoState.isConnected) {
      return {
        state: 'disconnected',
        isReachable: false,
        lastChecked: Date.now(),
        error: createConnectionError('network_error', 'No network connection'),
      };
    }

    // If NetInfo reports not reachable
    if (netInfoState.isInternetReachable === false) {
      return {
        state: 'disconnected',
        isReachable: false,
        lastChecked: Date.now(),
        error: createConnectionError('network_error', 'Tailscale server not reachable'),
      };
    }

    // If health URL provided, do a direct check for confirmation
    if (healthUrl) {
      const healthResult = await checkHealthEndpoint(healthUrl, options);

      if (!healthResult.success) {
        return {
          state: healthResult.isReachable ? 'error' : 'disconnected',
          isReachable: healthResult.isReachable,
          lastChecked: Date.now(),
          error: healthResult.error ?? null,
        };
      }

      return {
        state: 'connected',
        isReachable: true,
        lastChecked: Date.now(),
        error: null,
      };
    }

    // NetInfo says reachable and no direct check requested
    return {
      state: 'connected',
      isReachable: netInfoState.isInternetReachable === true,
      lastChecked: Date.now(),
      error: null,
    };
  } catch (error) {
    return {
      state: 'error',
      isReachable: false,
      lastChecked: Date.now(),
      error: createConnectionError('unknown', getErrorMessage(error)),
    };
  }
}

// ============================================
// Connection Monitoring
// ============================================

/**
 * Subscribe to NetInfo network state changes
 *
 * @param callback - Function to call when network state changes
 * @returns Unsubscribe function
 *
 * @example
 * ```typescript
 * const unsubscribe = subscribeToNetworkChanges((state) => {
 *   if (!state.isInternetReachable) {
 *     handleDisconnection();
 *   }
 * });
 *
 * // Later: cleanup
 * unsubscribe();
 * ```
 */
export function subscribeToNetworkChanges(
  callback: NetInfoStateCallback
): NetInfoSubscription {
  return NetInfo.addEventListener(callback);
}

/**
 * Create a subscription that monitors Tailscale connection state
 *
 * Combines NetInfo events with AppState monitoring for comprehensive
 * connection tracking, including proper handling of app background/foreground.
 *
 * @param callback - Function to call when connection status changes
 * @param healthUrl - Health URL for verification checks
 * @returns Object with unsubscribe function
 *
 * @example
 * ```typescript
 * const { unsubscribe } = createConnectionMonitor(
 *   (status) => {
 *     console.log('Connection state:', status.state);
 *     if (status.state === 'disconnected') {
 *       showReconnectBanner();
 *     }
 *   },
 *   'http://100.64.1.1:3001/api/health'
 * );
 *
 * // Later: cleanup
 * unsubscribe();
 * ```
 */
export function createConnectionMonitor(
  callback: ConnectionStateCallback,
  healthUrl: string | null
): { unsubscribe: () => void } {
  let lastCheckTime = 0;
  let isChecking = false;

  /**
   * Perform a connectivity check with debouncing
   */
  const performCheck = async (): Promise<void> => {
    const now = Date.now();

    // Debounce: skip if checked too recently
    if (now - lastCheckTime < MIN_HEALTH_CHECK_INTERVAL) {
      return;
    }

    // Skip if already checking
    if (isChecking) {
      return;
    }

    isChecking = true;
    lastCheckTime = now;

    try {
      const status = await checkTailscaleConnectivity(healthUrl);
      callback(status);
    } finally {
      isChecking = false;
    }
  };

  // Subscribe to NetInfo changes
  const netInfoUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    // Map NetInfo state to our status
    const status: TailscaleConnectionStatus = {
      state: state.isInternetReachable
        ? 'connected'
        : state.isConnected
          ? 'connecting'
          : 'disconnected',
      isReachable: state.isInternetReachable === true,
      lastChecked: Date.now(),
      error: null,
    };

    callback(status);

    // Perform additional verification if transitioning to connected
    if (state.isInternetReachable && healthUrl) {
      performCheck();
    }
  });

  // Subscribe to AppState changes for foreground transitions
  const appStateSubscription = AppState.addEventListener(
    'change',
    (nextAppState: AppStateStatus) => {
      // When app comes to foreground, recheck connectivity
      if (nextAppState === 'active') {
        performCheck();
      }
    }
  );

  // Initial check
  performCheck();

  return {
    unsubscribe: (): void => {
      netInfoUnsubscribe();
      appStateSubscription.remove();
    },
  };
}

// ============================================
// Error Handling Utilities
// ============================================

/**
 * Create a ConnectionError object
 *
 * @param type - Error type
 * @param message - Error message
 * @returns ConnectionError object
 */
export function createConnectionError(
  type: ConnectionErrorType,
  message: string
): ConnectionError {
  return {
    type,
    message,
    timestamp: Date.now(),
  };
}

/**
 * Determine error type from an error object
 *
 * @param error - Error object
 * @returns Appropriate ConnectionErrorType
 */
function getErrorType(error: unknown): ConnectionErrorType {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // AbortError indicates timeout or cancellation
    if (error.name === 'AbortError' || message.includes('abort')) {
      return 'timeout';
    }

    // Network errors
    if (
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('connection')
    ) {
      return 'network_error';
    }

    // Timeout patterns
    if (message.includes('timeout') || message.includes('timed out')) {
      return 'timeout';
    }
  }

  return 'unknown';
}

/**
 * Extract error message from error object
 *
 * @param error - Error object
 * @returns Human-readable error message
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return 'Request was cancelled or timed out';
    }
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unknown error occurred';
}

/**
 * Check if an error indicates a timeout
 *
 * @param error - ConnectionError to check
 * @returns true if the error was a timeout
 */
export function isTimeoutError(error: ConnectionError | null): boolean {
  return error?.type === 'timeout';
}

/**
 * Check if an error indicates the server is reachable but erroring
 *
 * @param error - ConnectionError to check
 * @returns true if server was reached but returned an error
 */
export function isServerError(error: ConnectionError | null): boolean {
  return error?.type === 'server_error';
}

/**
 * Check if an error indicates an authentication problem
 *
 * @param error - ConnectionError to check
 * @returns true if error is authentication related
 */
export function isAuthError(error: ConnectionError | null): boolean {
  return error?.type === 'auth_error';
}
