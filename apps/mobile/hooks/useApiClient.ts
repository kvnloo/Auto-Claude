/**
 * React hook for authenticated API calls with Tailscale connection management
 *
 * Provides methods for making authenticated REST API calls with:
 * - Automatic connection checking (blocks requests when not connected)
 * - Error handling with proper responses for 401/auth errors
 * - AbortController support for request cancellation
 * - Integration patterns for TanStack Query
 *
 * @see spec.md - API Request Pattern
 * @see client.ts - Core API client functions
 */

import { useCallback, useRef } from 'react';

import {
  apiRequest,
  get as apiGet,
  post as apiPost,
  put as apiPut,
  patch as apiPatch,
  del as apiDel,
  checkHealth,
  createAbortController,
  isApiError,
  isApiSuccess,
  type ApiRequestOptions,
  type ApiResult,
  type ApiError,
  type HealthCheckResponse,
} from '../api/client';
import { createConnectionError } from '../api/tailscale';
import { useSettingsStore } from '../stores/settingsStore';
import type { ConnectionError } from '../types/settings';

// ============================================
// Types
// ============================================

/**
 * Options for API client hook
 */
export interface UseApiClientOptions {
  /**
   * Whether to automatically check connection before requests
   * @default true
   */
  checkConnection?: boolean;

  /**
   * Whether to throw an error when not connected instead of returning an error result
   * Useful for TanStack Query which expects errors to be thrown
   * @default false
   */
  throwOnNotConnected?: boolean;
}

/**
 * Error thrown when trying to make a request while not connected
 */
export class NotConnectedError extends Error {
  readonly connectionError: ConnectionError;

  constructor(message: string = 'Not connected to Tailscale server') {
    super(message);
    this.name = 'NotConnectedError';
    this.connectionError = createConnectionError('network_error', message);
  }
}

/**
 * Return type for useApiClient hook
 */
export interface UseApiClientResult {
  /**
   * Whether the client is currently connected and ready for requests
   */
  isReady: boolean;

  /**
   * Whether a request is currently in progress
   * Note: This tracks the AbortController state, not individual requests
   */
  isLoading: boolean;

  /**
   * Make a GET request
   *
   * @param endpoint - API endpoint path
   * @param options - Request options
   * @returns Promise resolving to API result
   */
  get: <T = unknown>(
    endpoint: string,
    options?: Omit<ApiRequestOptions, 'method' | 'body'>
  ) => Promise<ApiResult<T>>;

  /**
   * Make a POST request
   *
   * @param endpoint - API endpoint path
   * @param body - Request body
   * @param options - Request options
   * @returns Promise resolving to API result
   */
  post: <T = unknown>(
    endpoint: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, 'method' | 'body'>
  ) => Promise<ApiResult<T>>;

  /**
   * Make a PUT request
   *
   * @param endpoint - API endpoint path
   * @param body - Request body
   * @param options - Request options
   * @returns Promise resolving to API result
   */
  put: <T = unknown>(
    endpoint: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, 'method' | 'body'>
  ) => Promise<ApiResult<T>>;

  /**
   * Make a PATCH request
   *
   * @param endpoint - API endpoint path
   * @param body - Request body
   * @param options - Request options
   * @returns Promise resolving to API result
   */
  patch: <T = unknown>(
    endpoint: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, 'method' | 'body'>
  ) => Promise<ApiResult<T>>;

  /**
   * Make a DELETE request
   *
   * @param endpoint - API endpoint path
   * @param options - Request options
   * @returns Promise resolving to API result
   */
  del: <T = unknown>(
    endpoint: string,
    options?: Omit<ApiRequestOptions, 'method'>
  ) => Promise<ApiResult<T>>;

  /**
   * Make a generic API request
   *
   * @param endpoint - API endpoint path
   * @param options - Request options
   * @returns Promise resolving to API result
   */
  request: <T = unknown>(
    endpoint: string,
    options?: ApiRequestOptions
  ) => Promise<ApiResult<T>>;

  /**
   * Check API health (does not require connection or auth)
   *
   * @param options - Request options
   * @returns Promise resolving to health check result
   */
  checkHealth: (
    options?: Omit<ApiRequestOptions, 'method' | 'body' | 'skipAuth'>
  ) => Promise<ApiResult<HealthCheckResponse>>;

  /**
   * Create a new AbortController for request cancellation
   *
   * @returns AbortController instance
   */
  createAbortController: () => AbortController;

  /**
   * Abort all pending requests made through this hook instance
   */
  abortAll: () => void;
}

// ============================================
// Hook Implementation
// ============================================

/**
 * React hook for making authenticated API calls with Tailscale connection management
 *
 * Automatically checks connection state before making requests and blocks
 * requests when not connected. Provides TanStack Query-compatible patterns.
 *
 * @param options - Hook configuration options
 * @returns API client methods and state
 *
 * @example
 * ```typescript
 * function TaskList() {
 *   const { get, isReady } = useApiClient();
 *
 *   const fetchTasks = async () => {
 *     const result = await get<Task[]>('/api/tasks');
 *     if (result.success) {
 *       return result.data;
 *     }
 *     throw new Error(result.error.message);
 *   };
 *
 *   // Use with TanStack Query
 *   const { data, error } = useQuery({
 *     queryKey: ['tasks'],
 *     queryFn: fetchTasks,
 *     enabled: isReady,
 *   });
 *
 *   // ... render
 * }
 * ```
 *
 * @example
 * ```typescript
 * // With abort controller
 * function SearchComponent() {
 *   const { get, createAbortController } = useApiClient();
 *   const controllerRef = useRef<AbortController | null>(null);
 *
 *   const search = async (query: string) => {
 *     // Abort previous search
 *     controllerRef.current?.abort();
 *     controllerRef.current = createAbortController();
 *
 *     const result = await get(`/api/search?q=${query}`, {
 *       signal: controllerRef.current.signal,
 *     });
 *
 *     return result;
 *   };
 * }
 * ```
 */
export function useApiClient(options: UseApiClientOptions = {}): UseApiClientResult {
  const { checkConnection = true, throwOnNotConnected = false } = options;

  // Track active abort controllers for cleanup
  const activeControllersRef = useRef<Set<AbortController>>(new Set());
  const isLoadingRef = useRef<boolean>(false);

  // Get connection state from store
  const connectionState = useSettingsStore((s) => s.connectionState);
  const isConfigured = useSettingsStore((s) => s.connection.isConfigured);

  // Determine if ready for requests
  const isReady = connectionState === 'connected' && isConfigured;

  /**
   * Create not connected error result
   */
  const createNotConnectedResult = useCallback((): ApiError => {
    return {
      success: false,
      error: createConnectionError(
        'network_error',
        'Not connected to Tailscale server. Please check your connection.'
      ),
    };
  }, []);

  /**
   * Check connection state and handle not connected case
   *
   * @returns true if connected, false otherwise
   * @throws NotConnectedError if throwOnNotConnected is true and not connected
   */
  const ensureConnected = useCallback((): boolean => {
    if (!checkConnection) {
      return true;
    }

    if (!isReady) {
      if (throwOnNotConnected) {
        throw new NotConnectedError();
      }
      return false;
    }

    return true;
  }, [checkConnection, isReady, throwOnNotConnected]);

  /**
   * Register an abort controller for tracking
   */
  const registerController = useCallback((controller: AbortController): void => {
    activeControllersRef.current.add(controller);

    // Remove on abort
    controller.signal.addEventListener('abort', () => {
      activeControllersRef.current.delete(controller);
    });
  }, []);

  /**
   * Create a new abort controller for request cancellation
   */
  const createAbortControllerWithTracking = useCallback((): AbortController => {
    const controller = createAbortController();
    registerController(controller);
    return controller;
  }, [registerController]);

  /**
   * Abort all pending requests
   */
  const abortAll = useCallback((): void => {
    activeControllersRef.current.forEach((controller) => {
      controller.abort();
    });
    activeControllersRef.current.clear();
  }, []);

  /**
   * Make a generic API request with connection checking
   */
  const request = useCallback(
    async <T = unknown>(
      endpoint: string,
      requestOptions: ApiRequestOptions = {}
    ): Promise<ApiResult<T>> => {
      if (!ensureConnected()) {
        return createNotConnectedResult() as ApiResult<T>;
      }

      isLoadingRef.current = true;

      try {
        return await apiRequest<T>(endpoint, requestOptions);
      } finally {
        isLoadingRef.current = false;
      }
    },
    [ensureConnected, createNotConnectedResult]
  );

  /**
   * Make a GET request with connection checking
   */
  const get = useCallback(
    async <T = unknown>(
      endpoint: string,
      requestOptions: Omit<ApiRequestOptions, 'method' | 'body'> = {}
    ): Promise<ApiResult<T>> => {
      if (!ensureConnected()) {
        return createNotConnectedResult() as ApiResult<T>;
      }

      isLoadingRef.current = true;

      try {
        return await apiGet<T>(endpoint, requestOptions);
      } finally {
        isLoadingRef.current = false;
      }
    },
    [ensureConnected, createNotConnectedResult]
  );

  /**
   * Make a POST request with connection checking
   */
  const post = useCallback(
    async <T = unknown>(
      endpoint: string,
      body?: unknown,
      requestOptions: Omit<ApiRequestOptions, 'method' | 'body'> = {}
    ): Promise<ApiResult<T>> => {
      if (!ensureConnected()) {
        return createNotConnectedResult() as ApiResult<T>;
      }

      isLoadingRef.current = true;

      try {
        return await apiPost<T>(endpoint, body, requestOptions);
      } finally {
        isLoadingRef.current = false;
      }
    },
    [ensureConnected, createNotConnectedResult]
  );

  /**
   * Make a PUT request with connection checking
   */
  const put = useCallback(
    async <T = unknown>(
      endpoint: string,
      body?: unknown,
      requestOptions: Omit<ApiRequestOptions, 'method' | 'body'> = {}
    ): Promise<ApiResult<T>> => {
      if (!ensureConnected()) {
        return createNotConnectedResult() as ApiResult<T>;
      }

      isLoadingRef.current = true;

      try {
        return await apiPut<T>(endpoint, body, requestOptions);
      } finally {
        isLoadingRef.current = false;
      }
    },
    [ensureConnected, createNotConnectedResult]
  );

  /**
   * Make a PATCH request with connection checking
   */
  const patch = useCallback(
    async <T = unknown>(
      endpoint: string,
      body?: unknown,
      requestOptions: Omit<ApiRequestOptions, 'method' | 'body'> = {}
    ): Promise<ApiResult<T>> => {
      if (!ensureConnected()) {
        return createNotConnectedResult() as ApiResult<T>;
      }

      isLoadingRef.current = true;

      try {
        return await apiPatch<T>(endpoint, body, requestOptions);
      } finally {
        isLoadingRef.current = false;
      }
    },
    [ensureConnected, createNotConnectedResult]
  );

  /**
   * Make a DELETE request with connection checking
   */
  const del = useCallback(
    async <T = unknown>(
      endpoint: string,
      requestOptions: Omit<ApiRequestOptions, 'method'> = {}
    ): Promise<ApiResult<T>> => {
      if (!ensureConnected()) {
        return createNotConnectedResult() as ApiResult<T>;
      }

      isLoadingRef.current = true;

      try {
        return await apiDel<T>(endpoint, requestOptions);
      } finally {
        isLoadingRef.current = false;
      }
    },
    [ensureConnected, createNotConnectedResult]
  );

  /**
   * Check API health (does not require connection check)
   * This is used for connectivity testing
   */
  const checkHealthEndpoint = useCallback(
    async (
      requestOptions: Omit<ApiRequestOptions, 'method' | 'body' | 'skipAuth'> = {}
    ): Promise<ApiResult<HealthCheckResponse>> => {
      isLoadingRef.current = true;

      try {
        return await checkHealth(requestOptions);
      } finally {
        isLoadingRef.current = false;
      }
    },
    []
  );

  return {
    isReady,
    isLoading: isLoadingRef.current,
    get,
    post,
    put,
    patch,
    del,
    request,
    checkHealth: checkHealthEndpoint,
    createAbortController: createAbortControllerWithTracking,
    abortAll,
  };
}

// ============================================
// TanStack Query Integration Helpers
// ============================================

/**
 * Create a query function for TanStack Query that throws on error
 *
 * Wraps the API client get method to work with TanStack Query's
 * expected behavior of throwing errors.
 *
 * @param client - API client instance from useApiClient
 * @param endpoint - API endpoint path
 * @param options - Request options
 * @returns Query function for use with useQuery
 *
 * @example
 * ```typescript
 * function TaskList() {
 *   const client = useApiClient();
 *
 *   const { data, error, isLoading } = useQuery({
 *     queryKey: ['tasks'],
 *     queryFn: createQueryFn(client, '/api/tasks'),
 *     enabled: client.isReady,
 *   });
 * }
 * ```
 */
export function createQueryFn<T = unknown>(
  client: UseApiClientResult,
  endpoint: string,
  options?: Omit<ApiRequestOptions, 'method' | 'body'>
): () => Promise<T> {
  return async () => {
    const result = await client.get<T>(endpoint, options);

    if (!result.success) {
      throw new Error(result.error.message);
    }

    return result.data;
  };
}

/**
 * Create a mutation function for TanStack Query that throws on error
 *
 * Wraps the API client post/put/patch/delete methods to work with
 * TanStack Query's expected behavior of throwing errors.
 *
 * @param client - API client instance from useApiClient
 * @param method - HTTP method to use
 * @param endpoint - API endpoint path
 * @param options - Request options
 * @returns Mutation function for use with useMutation
 *
 * @example
 * ```typescript
 * function CreateTask() {
 *   const client = useApiClient();
 *
 *   const mutation = useMutation({
 *     mutationFn: createMutationFn<Task>(client, 'POST', '/api/tasks'),
 *     onSuccess: () => queryClient.invalidateQueries(['tasks']),
 *   });
 *
 *   const handleSubmit = (data: CreateTaskInput) => {
 *     mutation.mutate(data);
 *   };
 * }
 * ```
 */
export function createMutationFn<T = unknown, TVariables = unknown>(
  client: UseApiClientResult,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  endpoint: string,
  options?: Omit<ApiRequestOptions, 'method' | 'body'>
): (variables: TVariables) => Promise<T> {
  return async (variables: TVariables) => {
    let result: ApiResult<T>;

    switch (method) {
      case 'POST':
        result = await client.post<T>(endpoint, variables, options);
        break;
      case 'PUT':
        result = await client.put<T>(endpoint, variables, options);
        break;
      case 'PATCH':
        result = await client.patch<T>(endpoint, variables, options);
        break;
      case 'DELETE':
        result = await client.del<T>(endpoint, options);
        break;
    }

    if (!result.success) {
      throw new Error(result.error.message);
    }

    return result.data;
  };
}

// ============================================
// Convenience Hooks
// ============================================

/**
 * Simple hook to check if API client is ready
 *
 * @returns true if connected and configured
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *   const isApiReady = useApiClientReady();
 *
 *   if (!isApiReady) {
 *     return <Text>Connecting...</Text>;
 *   }
 *
 *   return <Content />;
 * }
 * ```
 */
export function useApiClientReady(): boolean {
  const connectionState = useSettingsStore((s) => s.connectionState);
  const isConfigured = useSettingsStore((s) => s.connection.isConfigured);

  return connectionState === 'connected' && isConfigured;
}

// ============================================
// Re-exports for convenience
// ============================================

// Re-export type guards from client for convenience
export { isApiError, isApiSuccess } from '../api/client';
export type { ApiResult, ApiError, ApiResponse } from '../api/client';
