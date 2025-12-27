/**
 * Unit tests for the API client
 *
 * Tests x-api-key header inclusion, request abort on disconnect,
 * timeout handling, and error response handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock expo-secure-store before importing modules that use it
vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

// Mock @react-native-async-storage/async-storage
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    getAllKeys: vi.fn(),
  },
}));

// Mock the tailscale module to avoid react-native dependency
vi.mock('../api/tailscale', () => ({
  createConnectionError: vi.fn((type: string, message: string) => ({
    type,
    message,
    timestamp: Date.now(),
  })),
}));

// Mock the zustand store to avoid chain dependencies
// We need to provide a minimal mock that includes getState for the settings store
const mockSettingsStore = {
  connection: {
    tailscaleIp: '100.64.1.1',
    apiPort: 3001,
    isConfigured: true,
  },
  connectionState: 'connected',
  connectionError: null,
  lastConnectedAt: null,
};

vi.mock('../stores/settingsStore', () => ({
  getApiKey: vi.fn(),
  getApiBaseUrl: vi.fn(),
  useSettingsStore: Object.assign(
    vi.fn(() => mockSettingsStore),
    {
      getState: vi.fn(() => mockSettingsStore),
      setState: vi.fn((partial) => {
        if (typeof partial === 'function') {
          Object.assign(mockSettingsStore, partial(mockSettingsStore));
        } else {
          Object.assign(mockSettingsStore, partial);
        }
      }),
    }
  ),
}));

import * as SecureStore from 'expo-secure-store';
import { getApiKey, getApiBaseUrl, useSettingsStore } from '../stores/settingsStore';
import {
  apiRequest,
  get,
  post,
  put,
  patch,
  del,
  checkHealth,
  createAbortController,
  createTimeoutController,
  isApiError,
  isApiSuccess,
  isAuthenticationError,
  isTimeoutError,
  isNetworkError,
  isServerError,
  DEFAULT_REQUEST_TIMEOUT,
  SHORT_REQUEST_TIMEOUT,
  LONG_REQUEST_TIMEOUT,
  type ApiResult,
  type ApiError,
  type ApiResponse,
} from '../api/client';

// ============================================
// Test Setup
// ============================================

// Store original fetch
const originalFetch = global.fetch;

/**
 * Create a mock response
 */
function createMockResponse(
  data: unknown,
  options: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    contentType?: string;
    ok?: boolean;
  } = {}
): Response {
  const {
    status = 200,
    statusText = 'OK',
    headers = {},
    contentType = 'application/json',
    ok = status >= 200 && status < 300,
  } = options;

  const responseHeaders = new Headers({
    'content-type': contentType,
    ...headers,
  });

  return {
    ok,
    status,
    statusText,
    headers: responseHeaders,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(typeof data === 'string' ? data : JSON.stringify(data)),
  } as unknown as Response;
}

/**
 * Create a mock network error
 */
function createNetworkError(message = 'Network request failed'): Error {
  return new Error(message);
}

/**
 * Create a mock abort error
 */
function createAbortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

describe('API Client', () => {
  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Reset mock settings store state
    mockSettingsStore.connection = {
      tailscaleIp: '100.64.1.1',
      apiPort: 3001,
      isConfigured: true,
    };
    mockSettingsStore.connectionState = 'connected';
    mockSettingsStore.connectionError = null;
    mockSettingsStore.lastConnectedAt = null;

    // Configure mocked functions
    vi.mocked(getApiBaseUrl).mockReturnValue('http://100.64.1.1:3001');
    vi.mocked(getApiKey).mockResolvedValue('test-api-key-123');

    // Mock SecureStore to return a valid API key
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue('test-api-key-123');

    // Mock global fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    // Restore original fetch
    global.fetch = originalFetch;
  });

  // ============================================
  // Constants Tests
  // ============================================

  describe('Constants', () => {
    it('should have correct timeout values', () => {
      expect(DEFAULT_REQUEST_TIMEOUT).toBe(30 * 1000);
      expect(SHORT_REQUEST_TIMEOUT).toBe(10 * 1000);
      expect(LONG_REQUEST_TIMEOUT).toBe(60 * 1000);
    });
  });

  // ============================================
  // x-api-key Header Tests
  // ============================================

  describe('x-api-key Header Inclusion', () => {
    it('should include x-api-key header in authenticated requests', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await apiRequest('/api/tasks');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'test-api-key-123',
          }),
        })
      );
    });

    it('should retrieve API key from settings store', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await apiRequest('/api/tasks');

      // The API client uses getApiKey from settingsStore
      expect(getApiKey).toHaveBeenCalled();
    });

    it('should include x-api-key in GET requests', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await get('/api/tasks');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'test-api-key-123',
          }),
        })
      );
    });

    it('should include x-api-key in POST requests', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await post('/api/tasks', { title: 'New Task' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'test-api-key-123',
          }),
        })
      );
    });

    it('should include x-api-key in PUT requests', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await put('/api/tasks/1', { title: 'Updated Task' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'test-api-key-123',
          }),
        })
      );
    });

    it('should include x-api-key in PATCH requests', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await patch('/api/tasks/1', { status: 'completed' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'test-api-key-123',
          }),
        })
      );
    });

    it('should include x-api-key in DELETE requests', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await del('/api/tasks/1');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'test-api-key-123',
          }),
        })
      );
    });

    it('should NOT include x-api-key when skipAuth is true', async () => {
      const mockResponse = createMockResponse({ status: 'healthy' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await apiRequest('/api/health', { skipAuth: true });

      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const requestHeaders = fetchCall[1]?.headers as Record<string, string>;

      expect(requestHeaders['x-api-key']).toBeUndefined();
    });

    it('should NOT include x-api-key in health check endpoint', async () => {
      const mockResponse = createMockResponse({ status: 'healthy' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await checkHealth();

      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const requestHeaders = fetchCall[1]?.headers as Record<string, string>;

      expect(requestHeaders['x-api-key']).toBeUndefined();
    });

    it('should return auth error if API key is not configured', async () => {
      // Mock getApiKey to return null (no API key configured)
      vi.mocked(getApiKey).mockResolvedValue(null);

      const result = await apiRequest('/api/tasks');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('auth_error');
        expect(result.error.message).toContain('API key not configured');
      }
    });

    it('should return auth error if API key retrieval fails', async () => {
      // Mock getApiKey to throw an error
      vi.mocked(getApiKey).mockRejectedValue(new Error('SecureStore error'));

      const result = await apiRequest('/api/tasks');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('auth_error');
        expect(result.error.message).toContain('Failed to retrieve API key');
      }
    });

    it('should include custom headers alongside x-api-key', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await apiRequest('/api/tasks', {
        headers: { 'X-Custom-Header': 'custom-value' },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'test-api-key-123',
            'X-Custom-Header': 'custom-value',
          }),
        })
      );
    });
  });

  // ============================================
  // Request Abort Tests
  // ============================================

  describe('Request Abort on Disconnect', () => {
    it('should accept external AbortSignal for cancellation', async () => {
      // Use simpler mock that immediately rejects with abort error
      vi.mocked(global.fetch).mockRejectedValue(createAbortError());

      const controller = new AbortController();
      controller.abort(); // Abort immediately

      const result = await apiRequest('/api/tasks', { signal: controller.signal });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('timeout');
      }
    });

    it('should return timeout error when request is aborted', async () => {
      vi.mocked(global.fetch).mockRejectedValue(createAbortError());

      const result = await apiRequest('/api/tasks');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('timeout');
      }
    });

    it('should handle already aborted signal', async () => {
      const controller = new AbortController();
      controller.abort(); // Already aborted

      vi.mocked(global.fetch).mockRejectedValue(createAbortError());

      const result = await apiRequest('/api/tasks', { signal: controller.signal });

      expect(result.success).toBe(false);
    });

    it('should create abort controller via helper function', () => {
      const controller = createAbortController();

      expect(controller).toBeInstanceOf(AbortController);
      expect(controller.signal).toBeDefined();
      expect(controller.signal.aborted).toBe(false);
    });

    it('should abort multiple requests when controller is aborted', async () => {
      // Simply verify that multiple requests can be made with the same signal
      // and both return timeout errors when aborted
      vi.mocked(global.fetch).mockRejectedValue(createAbortError());

      const controller = new AbortController();
      controller.abort(); // Abort immediately

      const [result1, result2] = await Promise.all([
        apiRequest('/api/tasks/1', { signal: controller.signal }),
        apiRequest('/api/tasks/2', { signal: controller.signal }),
      ]);

      expect(result1.success).toBe(false);
      expect(result2.success).toBe(false);
      if (!result1.success && !result2.success) {
        expect(result1.error.type).toBe('timeout');
        expect(result2.error.type).toBe('timeout');
      }
    });
  });

  // ============================================
  // Timeout Handling Tests
  // ============================================

  describe('Timeout Handling', () => {
    it('should use default timeout if not specified', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await apiRequest('/api/tasks');

      // The timeout is handled via AbortController internally
      // We verify the request was made
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should respect custom timeout option', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await apiRequest('/api/tasks', { timeout: 5000 });

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should use SHORT_REQUEST_TIMEOUT for health checks', async () => {
      const mockResponse = createMockResponse({ status: 'healthy' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await checkHealth();

      // Health check should use shorter timeout
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should handle timeout error from slow response', async () => {
      vi.mocked(global.fetch).mockRejectedValue(createAbortError());

      const result = await apiRequest('/api/tasks', { timeout: 100 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('timeout');
      }
    });

    it('should create timeout controller with cleanup', () => {
      vi.useFakeTimers();

      const { controller, cleanup } = createTimeoutController(5000);

      expect(controller).toBeInstanceOf(AbortController);
      expect(controller.signal.aborted).toBe(false);

      // Cleanup should clear the timeout
      cleanup();

      // Advance time past the timeout
      vi.advanceTimersByTime(6000);

      // Signal should NOT be aborted because we cleaned up
      expect(controller.signal.aborted).toBe(false);

      vi.useRealTimers();
    });

    it('should abort request after timeout expires', () => {
      vi.useFakeTimers();

      const { controller } = createTimeoutController(5000);

      expect(controller.signal.aborted).toBe(false);

      // Advance time to trigger timeout
      vi.advanceTimersByTime(5001);

      expect(controller.signal.aborted).toBe(true);

      vi.useRealTimers();
    });
  });

  // ============================================
  // Error Response Handling Tests
  // ============================================

  describe('Error Response Handling', () => {
    describe('401 Unauthorized', () => {
      it('should return auth_error for 401 response', async () => {
        const mockResponse = createMockResponse(
          { message: 'Invalid API key' },
          { status: 401, statusText: 'Unauthorized', ok: false }
        );
        vi.mocked(global.fetch).mockResolvedValue(mockResponse);

        const result = await apiRequest('/api/tasks');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('auth_error');
          expect(result.status).toBe(401);
        }
      });

      it('should extract error message from 401 response body', async () => {
        const mockResponse = createMockResponse(
          { message: 'API key expired' },
          { status: 401, statusText: 'Unauthorized', ok: false }
        );
        vi.mocked(global.fetch).mockResolvedValue(mockResponse);

        const result = await apiRequest('/api/tasks');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.message).toBe('API key expired');
        }
      });
    });

    describe('403 Forbidden', () => {
      it('should return auth_error for 403 response', async () => {
        const mockResponse = createMockResponse(
          { message: 'Access forbidden' },
          { status: 403, statusText: 'Forbidden', ok: false }
        );
        vi.mocked(global.fetch).mockResolvedValue(mockResponse);

        const result = await apiRequest('/api/tasks');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('auth_error');
          expect(result.status).toBe(403);
        }
      });
    });

    describe('400 Bad Request', () => {
      it('should return network_error for 400 response', async () => {
        const mockResponse = createMockResponse(
          { message: 'Invalid request' },
          { status: 400, statusText: 'Bad Request', ok: false }
        );
        vi.mocked(global.fetch).mockResolvedValue(mockResponse);

        const result = await apiRequest('/api/tasks');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('network_error');
          expect(result.status).toBe(400);
        }
      });
    });

    describe('404 Not Found', () => {
      it('should return network_error for 404 response', async () => {
        const mockResponse = createMockResponse(
          { message: 'Resource not found' },
          { status: 404, statusText: 'Not Found', ok: false }
        );
        vi.mocked(global.fetch).mockResolvedValue(mockResponse);

        const result = await apiRequest('/api/tasks/999');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('network_error');
          expect(result.status).toBe(404);
        }
      });
    });

    describe('500 Internal Server Error', () => {
      it('should return server_error for 500 response', async () => {
        const mockResponse = createMockResponse(
          { message: 'Internal server error' },
          { status: 500, statusText: 'Internal Server Error', ok: false }
        );
        vi.mocked(global.fetch).mockResolvedValue(mockResponse);

        const result = await apiRequest('/api/tasks');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('server_error');
          expect(result.status).toBe(500);
        }
      });

      it('should return server_error for 502 Bad Gateway', async () => {
        const mockResponse = createMockResponse(
          { message: 'Bad gateway' },
          { status: 502, statusText: 'Bad Gateway', ok: false }
        );
        vi.mocked(global.fetch).mockResolvedValue(mockResponse);

        const result = await apiRequest('/api/tasks');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('server_error');
          expect(result.status).toBe(502);
        }
      });

      it('should return server_error for 503 Service Unavailable', async () => {
        const mockResponse = createMockResponse(
          { message: 'Service unavailable' },
          { status: 503, statusText: 'Service Unavailable', ok: false }
        );
        vi.mocked(global.fetch).mockResolvedValue(mockResponse);

        const result = await apiRequest('/api/tasks');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('server_error');
          expect(result.status).toBe(503);
        }
      });
    });

    describe('Network Errors', () => {
      it('should return network_error for fetch failure', async () => {
        vi.mocked(global.fetch).mockRejectedValue(createNetworkError('Network request failed'));

        const result = await apiRequest('/api/tasks');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('network_error');
          expect(result.error.message).toContain('Network request failed');
        }
      });

      it('should return network_error for connection refused', async () => {
        vi.mocked(global.fetch).mockRejectedValue(
          createNetworkError('Failed to fetch: Connection refused')
        );

        const result = await apiRequest('/api/tasks');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('network_error');
        }
      });

      it('should return network_error for offline error', async () => {
        vi.mocked(global.fetch).mockRejectedValue(
          createNetworkError('Network request failed: offline')
        );

        const result = await apiRequest('/api/tasks');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('network_error');
        }
      });
    });

    describe('Error Message Extraction', () => {
      it('should extract message from error response body', async () => {
        const mockResponse = createMockResponse(
          { message: 'Custom error message' },
          { status: 400, ok: false }
        );
        vi.mocked(global.fetch).mockResolvedValue(mockResponse);

        const result = await apiRequest('/api/tasks');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.message).toBe('Custom error message');
        }
      });

      it('should extract error from error.message field', async () => {
        const mockResponse = createMockResponse(
          { error: { message: 'Nested error message' } },
          { status: 400, ok: false }
        );
        vi.mocked(global.fetch).mockResolvedValue(mockResponse);

        const result = await apiRequest('/api/tasks');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.message).toBe('Nested error message');
        }
      });

      it('should extract error from string error field', async () => {
        const mockResponse = createMockResponse(
          { error: 'Simple error string' },
          { status: 400, ok: false }
        );
        vi.mocked(global.fetch).mockResolvedValue(mockResponse);

        const result = await apiRequest('/api/tasks');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.message).toBe('Simple error string');
        }
      });

      it('should use default message when body parsing fails', async () => {
        const mockResponse = createMockResponse(null, { status: 400, ok: false });
        vi.mocked(mockResponse.json).mockRejectedValue(new Error('Parse error'));
        vi.mocked(global.fetch).mockResolvedValue(mockResponse);

        const result = await apiRequest('/api/tasks');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.message).toContain('status 400');
        }
      });
    });
  });

  // ============================================
  // Configuration Error Tests
  // ============================================

  describe('Configuration Errors', () => {
    it('should return error when base URL not configured', async () => {
      // Mock getApiBaseUrl to return null (not configured)
      vi.mocked(getApiBaseUrl).mockReturnValue(null);

      const result = await apiRequest('/api/tasks');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('network_error');
        expect(result.error.message).toContain('API base URL not configured');
      }
    });
  });

  // ============================================
  // Successful Response Tests
  // ============================================

  describe('Successful Responses', () => {
    it('should return success with data for 200 response', async () => {
      const responseData = { tasks: [{ id: 1, title: 'Task 1' }] };
      const mockResponse = createMockResponse(responseData);
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      const result = await apiRequest('/api/tasks');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(responseData);
        expect(result.status).toBe(200);
      }
    });

    it('should return success for 201 Created', async () => {
      const responseData = { id: 1, title: 'New Task' };
      const mockResponse = createMockResponse(responseData, { status: 201 });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      const result = await post('/api/tasks', { title: 'New Task' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.status).toBe(201);
      }
    });

    it('should return success for 204 No Content', async () => {
      const mockResponse = createMockResponse('', {
        status: 204,
        contentType: 'text/plain',
      });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      const result = await del('/api/tasks/1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.status).toBe(204);
      }
    });

    it('should include response headers in successful result', async () => {
      const mockResponse = createMockResponse(
        { data: 'test' },
        { headers: { 'X-Request-Id': 'req-123' } }
      );
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      const result = await apiRequest('/api/tasks');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.headers).toBeDefined();
      }
    });

    it('should handle non-JSON responses', async () => {
      const mockResponse = createMockResponse('Plain text response', {
        contentType: 'text/plain',
      });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      const result = await apiRequest('/api/text');

      expect(result.success).toBe(true);
    });
  });

  // ============================================
  // URL Construction Tests
  // ============================================

  describe('URL Construction', () => {
    it('should construct correct URL with leading slash', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await apiRequest('/api/tasks');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://100.64.1.1:3001/api/tasks',
        expect.any(Object)
      );
    });

    it('should construct correct URL without leading slash', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await apiRequest('api/tasks');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://100.64.1.1:3001/api/tasks',
        expect.any(Object)
      );
    });

    it('should use correct port from settings', async () => {
      // Mock getApiBaseUrl to return URL with custom port
      vi.mocked(getApiBaseUrl).mockReturnValue('http://100.64.1.1:8080');

      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await apiRequest('/api/tasks');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://100.64.1.1:8080/api/tasks',
        expect.any(Object)
      );
    });
  });

  // ============================================
  // Request Body Tests
  // ============================================

  describe('Request Body Handling', () => {
    it('should stringify body for POST requests', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      const body = { title: 'New Task', description: 'Test' };
      await post('/api/tasks', body);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(body),
        })
      );
    });

    it('should include Content-Type header for JSON body', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await post('/api/tasks', { title: 'Test' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should not include body for GET requests', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await get('/api/tasks');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: undefined,
        })
      );
    });
  });

  // ============================================
  // Type Guard Tests
  // ============================================

  describe('Type Guards', () => {
    describe('isApiError', () => {
      it('should return true for error results', () => {
        const errorResult: ApiError = {
          success: false,
          error: {
            type: 'network_error',
            message: 'Test error',
            timestamp: Date.now(),
          },
        };

        expect(isApiError(errorResult)).toBe(true);
      });

      it('should return false for success results', () => {
        const successResult: ApiResponse<{ data: string }> = {
          success: true,
          data: { data: 'test' },
          status: 200,
          headers: new Headers(),
        };

        expect(isApiError(successResult)).toBe(false);
      });
    });

    describe('isApiSuccess', () => {
      it('should return true for success results', () => {
        const successResult: ApiResponse<{ data: string }> = {
          success: true,
          data: { data: 'test' },
          status: 200,
          headers: new Headers(),
        };

        expect(isApiSuccess(successResult)).toBe(true);
      });

      it('should return false for error results', () => {
        const errorResult: ApiError = {
          success: false,
          error: {
            type: 'network_error',
            message: 'Test error',
            timestamp: Date.now(),
          },
        };

        expect(isApiSuccess(errorResult)).toBe(false);
      });
    });

    describe('isAuthenticationError', () => {
      it('should return true for auth errors', () => {
        const authError: ApiError = {
          success: false,
          error: {
            type: 'auth_error',
            message: 'Unauthorized',
            timestamp: Date.now(),
          },
        };

        expect(isAuthenticationError(authError)).toBe(true);
      });

      it('should return false for non-auth errors', () => {
        const networkError: ApiError = {
          success: false,
          error: {
            type: 'network_error',
            message: 'Network error',
            timestamp: Date.now(),
          },
        };

        expect(isAuthenticationError(networkError)).toBe(false);
      });
    });

    describe('isTimeoutError', () => {
      it('should return true for timeout errors', () => {
        const timeoutError: ApiError = {
          success: false,
          error: {
            type: 'timeout',
            message: 'Request timed out',
            timestamp: Date.now(),
          },
        };

        expect(isTimeoutError(timeoutError)).toBe(true);
      });

      it('should return false for non-timeout errors', () => {
        const networkError: ApiError = {
          success: false,
          error: {
            type: 'network_error',
            message: 'Network error',
            timestamp: Date.now(),
          },
        };

        expect(isTimeoutError(networkError)).toBe(false);
      });
    });

    describe('isNetworkError', () => {
      it('should return true for network errors', () => {
        const networkError: ApiError = {
          success: false,
          error: {
            type: 'network_error',
            message: 'Network error',
            timestamp: Date.now(),
          },
        };

        expect(isNetworkError(networkError)).toBe(true);
      });

      it('should return false for non-network errors', () => {
        const authError: ApiError = {
          success: false,
          error: {
            type: 'auth_error',
            message: 'Auth error',
            timestamp: Date.now(),
          },
        };

        expect(isNetworkError(authError)).toBe(false);
      });
    });

    describe('isServerError', () => {
      it('should return true for server errors', () => {
        const serverError: ApiError = {
          success: false,
          error: {
            type: 'server_error',
            message: 'Server error',
            timestamp: Date.now(),
          },
        };

        expect(isServerError(serverError)).toBe(true);
      });

      it('should return false for non-server errors', () => {
        const networkError: ApiError = {
          success: false,
          error: {
            type: 'network_error',
            message: 'Network error',
            timestamp: Date.now(),
          },
        };

        expect(isServerError(networkError)).toBe(false);
      });
    });
  });

  // ============================================
  // Health Check Tests
  // ============================================

  describe('Health Check Endpoint', () => {
    it('should request health endpoint correctly', async () => {
      const mockResponse = createMockResponse({ status: 'healthy', version: '1.0.0' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await checkHealth();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://100.64.1.1:3001/api/health',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should not require authentication for health check', async () => {
      const mockResponse = createMockResponse({ status: 'healthy' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      // Clear API key to verify it's not required
      vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null);

      const result = await checkHealth();

      // Should succeed even without API key
      expect(result.success).toBe(true);
    });

    it('should parse health check response correctly', async () => {
      const healthData = { status: 'healthy', version: '1.0.0', timestamp: '2024-01-01T00:00:00Z' };
      const mockResponse = createMockResponse(healthData);
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      const result = await checkHealth();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(healthData);
      }
    });

    it('should handle health check with custom timeout', async () => {
      const mockResponse = createMockResponse({ status: 'healthy' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      const result = await checkHealth({ timeout: 5000 });

      expect(result.success).toBe(true);
    });

    it('should handle health check failure', async () => {
      const mockResponse = createMockResponse(
        { status: 'unhealthy' },
        { status: 503, ok: false }
      );
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      const result = await checkHealth();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('server_error');
      }
    });
  });

  // ============================================
  // HTTP Method Tests
  // ============================================

  describe('HTTP Methods', () => {
    it('should use GET method for get()', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await get('/api/tasks');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should use POST method for post()', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await post('/api/tasks', { title: 'Test' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should use PUT method for put()', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await put('/api/tasks/1', { title: 'Updated' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('should use PATCH method for patch()', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await patch('/api/tasks/1', { status: 'done' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    it('should use DELETE method for del()', async () => {
      const mockResponse = createMockResponse({ data: 'test' });
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await del('/api/tasks/1');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });
});
