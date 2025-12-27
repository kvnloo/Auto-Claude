/**
 * API Client for the mobile companion app
 *
 * Provides authenticated REST API calls with:
 * - x-api-key header from SecureStore
 * - Request timeout handling via AbortController
 * - Automatic base URL from settings store
 * - Error handling and response parsing
 *
 * @see spec.md - API Request Pattern
 */

import { getApiKey, getApiBaseUrl } from '../stores/settingsStore';
import { createConnectionError } from './tailscale';
import type { ConnectionError, ConnectionErrorType } from '../types/settings';

// ============================================
// Constants
// ============================================

/**
 * Default request timeout in milliseconds (30 seconds)
 * Long enough for slow mobile networks
 */
export const DEFAULT_REQUEST_TIMEOUT = 30 * 1000;

/**
 * Short request timeout for quick operations (10 seconds)
 */
export const SHORT_REQUEST_TIMEOUT = 10 * 1000;

/**
 * Long request timeout for large uploads/downloads (60 seconds)
 */
export const LONG_REQUEST_TIMEOUT = 60 * 1000;

// ============================================
// Types
// ============================================

/**
 * HTTP methods supported by the API client
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Request options for API calls
 */
export interface ApiRequestOptions {
  /**
   * HTTP method (default: GET)
   */
  method?: HttpMethod;

  /**
   * Request body (will be JSON stringified)
   */
  body?: unknown;

  /**
   * Additional headers to include
   */
  headers?: Record<string, string>;

  /**
   * Request timeout in milliseconds (default: 30000)
   */
  timeout?: number;

  /**
   * External AbortSignal for cancellation
   */
  signal?: AbortSignal;

  /**
   * Skip API key authentication (for public endpoints like health check)
   */
  skipAuth?: boolean;
}

/**
 * Successful API response
 */
export interface ApiResponse<T> {
  success: true;
  data: T;
  status: number;
  headers: Headers;
}

/**
 * Failed API response
 */
export interface ApiError {
  success: false;
  error: ConnectionError;
  status?: number;
  statusText?: string;
}

/**
 * API result type - either success or error
 */
export type ApiResult<T> = ApiResponse<T> | ApiError;

// ============================================
// Error Handling
// ============================================

/**
 * Determine error type from HTTP status code
 *
 * @param status - HTTP status code
 * @returns Appropriate ConnectionErrorType
 */
function getErrorTypeFromStatus(status: number): ConnectionErrorType {
  if (status === 401 || status === 403) {
    return 'auth_error';
  }
  if (status >= 500) {
    return 'server_error';
  }
  if (status >= 400) {
    return 'network_error';
  }
  return 'unknown';
}

/**
 * Determine error type from fetch error
 *
 * @param error - Error from fetch
 * @returns Appropriate ConnectionErrorType
 */
function getErrorTypeFromError(error: unknown): ConnectionErrorType {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // AbortError indicates timeout or user cancellation
    if (name === 'aborterror' || message.includes('abort')) {
      return 'timeout';
    }

    // Network-related errors
    if (
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('connection') ||
      message.includes('offline')
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

// ============================================
// AbortController Utilities
// ============================================

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
 * Create an AbortController with automatic timeout
 *
 * @param timeout - Timeout in milliseconds
 * @returns Object with controller and cleanup function
 */
export function createTimeoutController(timeout: number): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  return {
    controller,
    cleanup: () => clearTimeout(timeoutId),
  };
}

// ============================================
// API Client
// ============================================

/**
 * Make an authenticated API request
 *
 * Handles:
 * - API key header from SecureStore
 * - Request timeout via AbortController
 * - JSON request/response handling
 * - Error normalization
 *
 * @param endpoint - API endpoint path (e.g., '/api/tasks')
 * @param options - Request options
 * @returns Promise resolving to API result
 *
 * @example
 * ```typescript
 * // GET request
 * const result = await apiRequest('/api/tasks');
 * if (result.success) {
 *   console.log('Tasks:', result.data);
 * } else {
 *   console.error('Error:', result.error.message);
 * }
 *
 * // POST request with body
 * const result = await apiRequest('/api/tasks', {
 *   method: 'POST',
 *   body: { title: 'New Task' },
 * });
 *
 * // Request with cancellation
 * const controller = new AbortController();
 * const result = await apiRequest('/api/tasks', {
 *   signal: controller.signal,
 * });
 * // Later: controller.abort();
 * ```
 */
export async function apiRequest<T = unknown>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<ApiResult<T>> {
  const {
    method = 'GET',
    body,
    headers: customHeaders = {},
    timeout = DEFAULT_REQUEST_TIMEOUT,
    signal: externalSignal,
    skipAuth = false,
  } = options;

  // Get base URL from settings
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    return {
      success: false,
      error: createConnectionError(
        'network_error',
        'API base URL not configured. Please enter Tailscale IP in settings.'
      ),
    };
  }

  // Get API key from SecureStore
  let apiKey: string | null = null;
  if (!skipAuth) {
    try {
      apiKey = await getApiKey();
      if (!apiKey) {
        return {
          success: false,
          error: createConnectionError(
            'auth_error',
            'API key not configured. Please enter your API key in settings.'
          ),
        };
      }
    } catch (error) {
      return {
        success: false,
        error: createConnectionError(
          'auth_error',
          `Failed to retrieve API key: ${getErrorMessage(error)}`
        ),
      };
    }
  }

  // Set up timeout controller
  const { controller: timeoutController, cleanup } = createTimeoutController(timeout);

  // Combine signals if external signal provided
  const combinedSignal = externalSignal
    ? createCombinedAbortSignal(externalSignal, timeoutController.signal)
    : timeoutController.signal;

  // Build request headers
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...customHeaders,
  };

  // Add API key if available
  if (apiKey) {
    requestHeaders['x-api-key'] = apiKey;
  }

  // Build request URL
  const url = endpoint.startsWith('/') ? `${baseUrl}${endpoint}` : `${baseUrl}/${endpoint}`;

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: combinedSignal,
    });

    cleanup();

    // Handle non-OK responses
    if (!response.ok) {
      const errorType = getErrorTypeFromStatus(response.status);
      let errorMessage = `Request failed with status ${response.status}`;

      // Try to parse error body
      try {
        const errorBody = await response.json();
        if (errorBody?.message) {
          errorMessage = errorBody.message;
        } else if (errorBody?.error) {
          errorMessage = typeof errorBody.error === 'string'
            ? errorBody.error
            : errorBody.error.message || errorMessage;
        }
      } catch {
        // Use default error message
      }

      return {
        success: false,
        error: createConnectionError(errorType, errorMessage),
        status: response.status,
        statusText: response.statusText,
      };
    }

    // Parse successful response
    let data: T;
    const contentType = response.headers.get('content-type');

    if (contentType?.includes('application/json')) {
      data = (await response.json()) as T;
    } else {
      // For non-JSON responses, return text as-is
      data = (await response.text()) as unknown as T;
    }

    return {
      success: true,
      data,
      status: response.status,
      headers: response.headers,
    };
  } catch (error) {
    cleanup();

    const errorType = getErrorTypeFromError(error);
    const errorMessage = getErrorMessage(error);

    return {
      success: false,
      error: createConnectionError(errorType, errorMessage),
    };
  }
}

// ============================================
// Convenience Methods
// ============================================

/**
 * Make a GET request
 *
 * @param endpoint - API endpoint path
 * @param options - Request options (method is ignored)
 * @returns Promise resolving to API result
 */
export async function get<T = unknown>(
  endpoint: string,
  options: Omit<ApiRequestOptions, 'method' | 'body'> = {}
): Promise<ApiResult<T>> {
  return apiRequest<T>(endpoint, { ...options, method: 'GET' });
}

/**
 * Make a POST request
 *
 * @param endpoint - API endpoint path
 * @param body - Request body
 * @param options - Request options (method and body are ignored)
 * @returns Promise resolving to API result
 */
export async function post<T = unknown>(
  endpoint: string,
  body?: unknown,
  options: Omit<ApiRequestOptions, 'method' | 'body'> = {}
): Promise<ApiResult<T>> {
  return apiRequest<T>(endpoint, { ...options, method: 'POST', body });
}

/**
 * Make a PUT request
 *
 * @param endpoint - API endpoint path
 * @param body - Request body
 * @param options - Request options (method and body are ignored)
 * @returns Promise resolving to API result
 */
export async function put<T = unknown>(
  endpoint: string,
  body?: unknown,
  options: Omit<ApiRequestOptions, 'method' | 'body'> = {}
): Promise<ApiResult<T>> {
  return apiRequest<T>(endpoint, { ...options, method: 'PUT', body });
}

/**
 * Make a PATCH request
 *
 * @param endpoint - API endpoint path
 * @param body - Request body
 * @param options - Request options (method and body are ignored)
 * @returns Promise resolving to API result
 */
export async function patch<T = unknown>(
  endpoint: string,
  body?: unknown,
  options: Omit<ApiRequestOptions, 'method' | 'body'> = {}
): Promise<ApiResult<T>> {
  return apiRequest<T>(endpoint, { ...options, method: 'PATCH', body });
}

/**
 * Make a DELETE request
 *
 * @param endpoint - API endpoint path
 * @param options - Request options (method is ignored)
 * @returns Promise resolving to API result
 */
export async function del<T = unknown>(
  endpoint: string,
  options: Omit<ApiRequestOptions, 'method'> = {}
): Promise<ApiResult<T>> {
  return apiRequest<T>(endpoint, { ...options, method: 'DELETE' });
}

// ============================================
// Health Check
// ============================================

/**
 * Health check response from the API
 */
export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy';
  version?: string;
  timestamp?: string;
}

/**
 * Check API health endpoint
 *
 * This is a public endpoint that doesn't require authentication.
 * Use for connectivity checks before attempting authenticated requests.
 *
 * @param options - Request options (skipAuth is always true)
 * @returns Promise resolving to API result
 *
 * @example
 * ```typescript
 * const result = await checkHealth();
 * if (result.success && result.data.status === 'healthy') {
 *   console.log('API is healthy');
 * }
 * ```
 */
export async function checkHealth(
  options: Omit<ApiRequestOptions, 'method' | 'body' | 'skipAuth'> = {}
): Promise<ApiResult<HealthCheckResponse>> {
  return apiRequest<HealthCheckResponse>('/api/health', {
    ...options,
    method: 'GET',
    skipAuth: true,
    timeout: options.timeout ?? SHORT_REQUEST_TIMEOUT,
  });
}

// ============================================
// Request Utilities
// ============================================

/**
 * Create an AbortController for request cancellation
 *
 * @returns AbortController instance
 *
 * @example
 * ```typescript
 * const controller = createAbortController();
 *
 * // Start request
 * const resultPromise = get('/api/tasks', { signal: controller.signal });
 *
 * // Cancel if needed
 * controller.abort();
 *
 * // Handle result
 * const result = await resultPromise;
 * if (!result.success && result.error.type === 'timeout') {
 *   console.log('Request was cancelled');
 * }
 * ```
 */
export function createAbortController(): AbortController {
  return new AbortController();
}

/**
 * Check if an API result is an error
 *
 * @param result - API result to check
 * @returns true if the result is an error
 */
export function isApiError<T>(result: ApiResult<T>): result is ApiError {
  return !result.success;
}

/**
 * Check if an API result is successful
 *
 * @param result - API result to check
 * @returns true if the result is successful
 */
export function isApiSuccess<T>(result: ApiResult<T>): result is ApiResponse<T> {
  return result.success;
}

/**
 * Check if an API error is an authentication error
 *
 * @param error - API error to check
 * @returns true if the error is auth-related (401/403)
 */
export function isAuthenticationError(error: ApiError): boolean {
  return error.error.type === 'auth_error';
}

/**
 * Check if an API error is a timeout error
 *
 * @param error - API error to check
 * @returns true if the error is a timeout
 */
export function isTimeoutError(error: ApiError): boolean {
  return error.error.type === 'timeout';
}

/**
 * Check if an API error is a network error
 *
 * @param error - API error to check
 * @returns true if the error is network-related
 */
export function isNetworkError(error: ApiError): boolean {
  return error.error.type === 'network_error';
}

/**
 * Check if an API error is a server error
 *
 * @param error - API error to check
 * @returns true if the error is server-side (5xx)
 */
export function isServerError(error: ApiError): boolean {
  return error.error.type === 'server_error';
}
