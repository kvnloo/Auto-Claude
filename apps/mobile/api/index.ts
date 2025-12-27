/**
 * API module exports for the mobile companion app
 */

// Tailscale connection detection and monitoring
export {
  // Constants
  NETINFO_TIMEOUTS,
  HEALTH_CHECK_INTERVAL,
  MIN_HEALTH_CHECK_INTERVAL,
  // Types
  type HealthCheckResult,
  type TailscaleConnectionStatus,
  type ConnectionStateCallback,
  type NetInfoStateCallback,
  type ConfigureNetInfoOptions,
  type CheckConnectivityOptions,
  // Configuration
  configureNetInfo,
  isNetInfoSetUp,
  getReachabilityUrl,
  resetNetInfoConfiguration,
  // Connectivity checking
  getNetworkState,
  isTailscaleReachable,
  checkHealthEndpoint,
  checkTailscaleConnectivity,
  // Connection monitoring
  subscribeToNetworkChanges,
  createConnectionMonitor,
  // Error utilities
  createConnectionError,
  isTimeoutError as isTailscaleTimeoutError,
  isServerError as isTailscaleServerError,
  isAuthError as isTailscaleAuthError,
} from './tailscale';

// API client for authenticated requests
export {
  // Constants
  DEFAULT_REQUEST_TIMEOUT,
  SHORT_REQUEST_TIMEOUT,
  LONG_REQUEST_TIMEOUT,
  // Types
  type HttpMethod,
  type ApiRequestOptions,
  type ApiResponse,
  type ApiError,
  type ApiResult,
  type HealthCheckResponse,
  // Core API functions
  apiRequest,
  get,
  post,
  put,
  patch,
  del,
  checkHealth,
  // Utilities
  createAbortController,
  createTimeoutController,
  isApiError,
  isApiSuccess,
  isAuthenticationError,
  isTimeoutError,
  isNetworkError,
  isServerError,
} from './client';
