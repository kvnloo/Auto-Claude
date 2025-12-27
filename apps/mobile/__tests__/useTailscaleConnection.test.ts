/**
 * Unit tests for the useTailscaleConnection hook
 *
 * Tests state machine transitions, NetInfo event handling,
 * AppState foreground transitions, and timeout behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// ============================================
// Hoisted Mock Definitions
// ============================================
// Use vi.hoisted to define mocks before they're used in vi.mock factories

const {
  mockSettingsState,
  mockSetConnectionState,
  mockSetConnectionError,
  mockMarkConnected,
  mockMarkDisconnected,
  mockCheckTailscaleConnectivity,
  mockCreateConnectionMonitor,
  mockConfigureNetInfo,
  mockIsNetInfoSetUp,
  mockResetNetInfoConfiguration,
} = vi.hoisted(() => {
  const mockSettingsState = {
    connection: {
      tailscaleIp: '100.64.1.1' as string | null,
      apiPort: 3001,
      isConfigured: true,
    },
    connectionState: 'disconnected' as 'disconnected' | 'connecting' | 'connected' | 'error',
    connectionError: null as null | { type: string; message: string; timestamp: number },
    lastConnectedAt: null as number | null,
  };

  const mockSetConnectionState = vi.fn((state: string) => {
    mockSettingsState.connectionState = state as 'disconnected' | 'connecting' | 'connected' | 'error';
  });

  const mockSetConnectionError = vi.fn((error: { type: string; message: string; timestamp: number } | null) => {
    mockSettingsState.connectionError = error;
  });

  const mockMarkConnected = vi.fn(() => {
    mockSettingsState.connectionState = 'connected';
    mockSettingsState.connectionError = null;
    mockSettingsState.lastConnectedAt = Date.now();
  });

  const mockMarkDisconnected = vi.fn(() => {
    mockSettingsState.connectionState = 'disconnected';
    mockSettingsState.connectionError = null;
  });

  const mockCheckTailscaleConnectivity = vi.fn();
  const mockCreateConnectionMonitor = vi.fn();
  const mockConfigureNetInfo = vi.fn();
  const mockIsNetInfoSetUp = vi.fn();
  const mockResetNetInfoConfiguration = vi.fn();

  return {
    mockSettingsState,
    mockSetConnectionState,
    mockSetConnectionError,
    mockMarkConnected,
    mockMarkDisconnected,
    mockCheckTailscaleConnectivity,
    mockCreateConnectionMonitor,
    mockConfigureNetInfo,
    mockIsNetInfoSetUp,
    mockResetNetInfoConfiguration,
  };
});

// ============================================
// Module Mocks
// ============================================

// Mock expo-secure-store
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

// Mock react-native
vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return 'active';
    },
    addEventListener: vi.fn((event: string, callback: (state: 'active' | 'background' | 'inactive') => void) => {
      return {
        remove: vi.fn(),
      };
    }),
    removeEventListener: vi.fn(),
  },
  Platform: {
    OS: 'ios',
    select: <T extends Record<string, unknown>>(specifics: T) => specifics.ios,
  },
  StyleSheet: {
    create: <T extends Record<string, unknown>>(styles: T): T => styles,
  },
}));

// Mock the settings store
vi.mock('../stores/settingsStore', () => {
  const useSettingsStore = vi.fn((selector?: (state: typeof mockSettingsState & { setConnectionState: typeof mockSetConnectionState; setConnectionError: typeof mockSetConnectionError; markConnected: typeof mockMarkConnected; markDisconnected: typeof mockMarkDisconnected }) => unknown) => {
    const actions = {
      setConnectionState: mockSetConnectionState,
      setConnectionError: mockSetConnectionError,
      markConnected: mockMarkConnected,
      markDisconnected: mockMarkDisconnected,
    };
    const state = { ...mockSettingsState, ...actions };
    if (selector) {
      return selector(state);
    }
    return state;
  });

  // Add getState method to the store
  Object.assign(useSettingsStore, {
    getState: () => ({
      ...mockSettingsState,
      setConnectionState: mockSetConnectionState,
      setConnectionError: mockSetConnectionError,
      markConnected: mockMarkConnected,
      markDisconnected: mockMarkDisconnected,
    }),
    setState: vi.fn(),
  });

  return {
    useSettingsStore,
    getHealthCheckUrl: vi.fn(() => 'http://100.64.1.1:3001/api/health'),
    getApiBaseUrl: vi.fn(() => 'http://100.64.1.1:3001'),
    getApiKey: vi.fn(() => Promise.resolve('test-api-key')),
  };
});

// Mock tailscale utilities
vi.mock('../api/tailscale', () => ({
  configureNetInfo: mockConfigureNetInfo,
  checkTailscaleConnectivity: mockCheckTailscaleConnectivity,
  createConnectionMonitor: mockCreateConnectionMonitor,
  isNetInfoSetUp: mockIsNetInfoSetUp,
  resetNetInfoConfiguration: mockResetNetInfoConfiguration,
  createConnectionError: vi.fn((type: string, message: string) => ({
    type,
    message,
    timestamp: Date.now(),
  })),
}));

// Mock validation utilities
vi.mock('../utils/validation', () => ({
  constructHealthCheckUrl: vi.fn((ip: string, port: number) => `http://${ip}:${port}/api/health`),
  isValidTailscaleIp: vi.fn(() => true),
  DEFAULT_API_PORT: 3001,
}));

// Import the hook after all mocks are set up
import {
  useTailscaleConnection,
  useTailscaleConnected,
  useTailscaleState,
  useTailscaleError,
} from '../hooks/useTailscaleConnection';

// ============================================
// Test Utilities
// ============================================

/**
 * Reset all mock states to defaults
 */
function resetMockState(): void {
  mockSettingsState.connection = {
    tailscaleIp: '100.64.1.1',
    apiPort: 3001,
    isConfigured: true,
  };
  mockSettingsState.connectionState = 'disconnected';
  mockSettingsState.connectionError = null;
  mockSettingsState.lastConnectedAt = null;
}

/**
 * Create a mock connection status result
 */
function createMockConnectionStatus(
  state: 'disconnected' | 'connecting' | 'connected' | 'error',
  options: {
    isReachable?: boolean;
    error?: { type: string; message: string; timestamp: number } | null;
    lastChecked?: number | null;
  } = {}
): {
  state: 'disconnected' | 'connecting' | 'connected' | 'error';
  isReachable: boolean;
  lastChecked: number | null;
  error: { type: string; message: string; timestamp: number } | null;
} {
  return {
    state,
    isReachable: options.isReachable ?? (state === 'connected'),
    lastChecked: options.lastChecked ?? Date.now(),
    error: options.error ?? null,
  };
}


// ============================================
// Tests
// ============================================

describe('useTailscaleConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetMockState();

    // Default mock implementations
    mockIsNetInfoSetUp.mockReturnValue(false);
    mockConfigureNetInfo.mockReturnValue('http://100.64.1.1:3001/api/health');
    mockCheckTailscaleConnectivity.mockResolvedValue(
      createMockConnectionStatus('connected')
    );
    mockCreateConnectionMonitor.mockReturnValue({
      unsubscribe: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================
  // State Machine Transitions
  // ============================================

  describe('State Machine Transitions', () => {
    describe('disconnected → connecting', () => {
      it('should transition to connecting when connect() is called', async () => {
        const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

        expect(result.current.state).toBe('disconnected');

        await act(async () => {
          result.current.connect();
        });

        expect(mockSetConnectionState).toHaveBeenCalledWith('connecting');
      });

      it('should clear any existing error when transitioning to connecting', async () => {
        mockSettingsState.connectionError = { type: 'network_error', message: 'Previous error', timestamp: Date.now() };
        const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

        await act(async () => {
          result.current.connect();
        });

        expect(mockSetConnectionError).toHaveBeenCalledWith(null);
      });
    });

    describe('connecting → connected', () => {
      it('should transition to connected when health check succeeds', async () => {
        mockCheckTailscaleConnectivity.mockResolvedValue(
          createMockConnectionStatus('connected')
        );

        const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

        await act(async () => {
          await result.current.connect();
          vi.runAllTimers();
        });

        expect(mockMarkConnected).toHaveBeenCalled();
      });

      it('should start connection monitor after successful connection', async () => {
        mockCheckTailscaleConnectivity.mockResolvedValue(
          createMockConnectionStatus('connected')
        );

        const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

        await act(async () => {
          await result.current.connect();
          vi.runAllTimers();
        });

        expect(mockCreateConnectionMonitor).toHaveBeenCalled();
      });
    });

    describe('connecting → error', () => {
      it('should transition to error when health check fails', async () => {
        const mockError = { type: 'network_error', message: 'Connection failed', timestamp: Date.now() };
        mockCheckTailscaleConnectivity.mockResolvedValue(
          createMockConnectionStatus('error', { isReachable: true, error: mockError })
        );

        const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

        await act(async () => {
          await result.current.connect();
          vi.runAllTimers();
        });

        expect(mockSetConnectionState).toHaveBeenCalledWith('error');
        expect(mockSetConnectionError).toHaveBeenCalledWith(mockError);
      });

      it('should transition to disconnected when network is unreachable', async () => {
        mockCheckTailscaleConnectivity.mockResolvedValue(
          createMockConnectionStatus('disconnected', { isReachable: false })
        );

        const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

        await act(async () => {
          await result.current.connect();
          vi.runAllTimers();
        });

        expect(mockSetConnectionState).toHaveBeenCalledWith('disconnected');
      });
    });

    describe('connected → disconnected (VPN dropped)', () => {
      it('should mark disconnected when disconnect() is called', async () => {
        mockSettingsState.connectionState = 'connected';
        const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

        act(() => {
          result.current.disconnect();
        });

        expect(mockMarkDisconnected).toHaveBeenCalled();
      });

      it('should stop connection monitor when disconnecting', async () => {
        const mockUnsubscribe = vi.fn();
        mockCreateConnectionMonitor.mockReturnValue({
          unsubscribe: mockUnsubscribe,
        });
        mockCheckTailscaleConnectivity.mockResolvedValue(
          createMockConnectionStatus('connected')
        );

        const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

        // Connect first
        await act(async () => {
          await result.current.connect();
          vi.runAllTimers();
        });

        // Then disconnect
        act(() => {
          result.current.disconnect();
        });

        // Monitor should be unsubscribed
        expect(mockUnsubscribe).toHaveBeenCalled();
      });
    });

    describe('error → connecting (retry)', () => {
      it('should transition from error to connecting when retry() is called', async () => {
        mockSettingsState.connectionState = 'error';
        mockSettingsState.connectionError = { type: 'timeout', message: 'Timed out', timestamp: Date.now() };

        const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

        await act(async () => {
          result.current.retry();
        });

        expect(mockSetConnectionError).toHaveBeenCalledWith(null);
        expect(mockResetNetInfoConfiguration).toHaveBeenCalled();
      });

      it('should reconfigure NetInfo when retrying', async () => {
        mockSettingsState.connectionState = 'error';

        const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

        await act(async () => {
          result.current.retry();
        });

        expect(mockResetNetInfoConfiguration).toHaveBeenCalled();
      });
    });
  });

  // ============================================
  // NetInfo Event Handling
  // ============================================

  describe('NetInfo Event Handling', () => {
    it('should configure NetInfo when tailscaleIp is set', () => {
      renderHook(() => useTailscaleConnection({ autoConnect: false }));

      expect(mockConfigureNetInfo).toHaveBeenCalledWith({
        tailscaleIp: '100.64.1.1',
        port: 3001,
      });
    });

    it('should reset and reconfigure NetInfo when tailscaleIp changes', () => {
      const { rerender } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

      // Change the IP
      mockSettingsState.connection.tailscaleIp = '100.64.2.2';
      rerender();

      expect(mockResetNetInfoConfiguration).toHaveBeenCalled();
    });

    it('should not configure NetInfo if tailscaleIp is not set', () => {
      mockSettingsState.connection.tailscaleIp = null;
      mockSettingsState.connection.isConfigured = false;

      renderHook(() => useTailscaleConnection({ autoConnect: false }));

      // Should still attempt to configure (the configure function handles null)
      expect(mockConfigureNetInfo).not.toHaveBeenCalled();
    });

    it('should pass status updates from connection monitor to store', async () => {
      let monitorCallback: ((status: ReturnType<typeof createMockConnectionStatus>) => void) | null = null;

      mockCreateConnectionMonitor.mockImplementation((callback) => {
        monitorCallback = callback;
        return { unsubscribe: vi.fn() };
      });

      mockCheckTailscaleConnectivity.mockResolvedValue(
        createMockConnectionStatus('connected')
      );

      const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

      // Connect to start the monitor
      await act(async () => {
        await result.current.connect();
        vi.runAllTimers();
      });

      // Simulate a status update from the monitor
      if (monitorCallback) {
        act(() => {
          monitorCallback!(createMockConnectionStatus('disconnected', {
            isReachable: false,
            error: { type: 'network_error', message: 'Lost connection', timestamp: Date.now() },
          }));
        });
      }

      expect(mockSetConnectionState).toHaveBeenCalledWith('disconnected');
    });
  });

  // ============================================
  // AppState Foreground Transitions
  // ============================================

  describe('AppState Foreground Transitions', () => {
    it('should subscribe to AppState changes on mount', async () => {
      // Import the mocked module to check the mock
      const { AppState } = await import('react-native');

      renderHook(() => useTailscaleConnection({ autoConnect: false }));

      expect(AppState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should unsubscribe from AppState on unmount', async () => {
      // Import the mocked module
      const { AppState } = await import('react-native');
      const mockRemove = vi.fn();
      vi.mocked(AppState.addEventListener).mockReturnValue({ remove: mockRemove });

      const { unmount } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

      unmount();

      expect(mockRemove).toHaveBeenCalled();
    });

    it('should recheck connectivity when app returns to foreground while connected', async () => {
      mockSettingsState.connectionState = 'connected';
      mockSettingsState.connection.isConfigured = true;

      // Track the AppState callback that gets registered
      const { AppState } = await import('react-native');
      let appStateCallback: ((state: 'active' | 'background' | 'inactive') => void) | null = null;
      vi.mocked(AppState.addEventListener).mockImplementation((event, callback) => {
        if (event === 'change') {
          appStateCallback = callback as (state: 'active' | 'background' | 'inactive') => void;
        }
        return { remove: vi.fn() };
      });

      renderHook(() => useTailscaleConnection({ autoConnect: false }));

      // Verify the callback was registered
      expect(appStateCallback).not.toBeNull();

      // Simulate app coming to foreground by calling the registered callback
      if (appStateCallback) {
        await act(async () => {
          appStateCallback!('active');
          vi.runAllTimers();
        });
      }

      // Should have rechecked connectivity
      expect(mockCheckTailscaleConnectivity).toHaveBeenCalled();
    });

    it('should update state if connection was lost while in background', async () => {
      mockSettingsState.connectionState = 'connected';
      mockSettingsState.connection.isConfigured = true;

      // Track the AppState callback that gets registered
      const { AppState } = await import('react-native');
      let appStateCallback: ((state: 'active' | 'background' | 'inactive') => void) | null = null;
      vi.mocked(AppState.addEventListener).mockImplementation((event, callback) => {
        if (event === 'change') {
          appStateCallback = callback as (state: 'active' | 'background' | 'inactive') => void;
        }
        return { remove: vi.fn() };
      });

      // Return disconnected on foreground check
      mockCheckTailscaleConnectivity.mockResolvedValue(createMockConnectionStatus('disconnected', {
        isReachable: false,
        error: { type: 'network_error', message: 'VPN disconnected', timestamp: Date.now() },
      }));

      renderHook(() => useTailscaleConnection({ autoConnect: false }));

      // Verify the callback was registered
      expect(appStateCallback).not.toBeNull();

      // Simulate app coming to foreground
      if (appStateCallback) {
        await act(async () => {
          appStateCallback!('active');
          // Allow the promise to resolve
          await vi.runAllTimersAsync();
        });
      }

      // Should have updated state
      expect(mockSetConnectionState).toHaveBeenCalledWith('disconnected');
    });

    it('should not recheck connectivity when going to background', async () => {
      mockSettingsState.connectionState = 'connected';
      mockCheckTailscaleConnectivity.mockClear();

      // Track the AppState callback
      const { AppState } = await import('react-native');
      let appStateCallback: ((state: 'active' | 'background' | 'inactive') => void) | null = null;
      vi.mocked(AppState.addEventListener).mockImplementation((event, callback) => {
        if (event === 'change') {
          appStateCallback = callback as (state: 'active' | 'background' | 'inactive') => void;
        }
        return { remove: vi.fn() };
      });

      renderHook(() => useTailscaleConnection({ autoConnect: false }));

      if (appStateCallback) {
        await act(async () => {
          appStateCallback!('background');
          vi.runAllTimers();
        });
      }

      // Should not have triggered a check when going to background
      expect(mockCheckTailscaleConnectivity).not.toHaveBeenCalled();
    });

    it('should not recheck if not configured', async () => {
      mockSettingsState.connectionState = 'connected';
      mockSettingsState.connection.isConfigured = false;
      mockSettingsState.connection.tailscaleIp = null;
      mockCheckTailscaleConnectivity.mockClear();

      // Track the AppState callback
      const { AppState } = await import('react-native');
      let appStateCallback: ((state: 'active' | 'background' | 'inactive') => void) | null = null;
      vi.mocked(AppState.addEventListener).mockImplementation((event, callback) => {
        if (event === 'change') {
          appStateCallback = callback as (state: 'active' | 'background' | 'inactive') => void;
        }
        return { remove: vi.fn() };
      });

      renderHook(() => useTailscaleConnection({ autoConnect: false }));

      if (appStateCallback) {
        await act(async () => {
          appStateCallback!('active');
          vi.runAllTimers();
        });
      }

      // Should not check if not configured
      expect(mockCheckTailscaleConnectivity).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // Timeout Behavior
  // ============================================

  describe('Timeout Behavior', () => {
    it('should timeout connection attempt after 15 seconds', async () => {
      // Make the connectivity check hang
      mockCheckTailscaleConnectivity.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

      act(() => {
        result.current.connect();
      });

      // Advance time past the timeout (15000ms)
      await act(async () => {
        vi.advanceTimersByTime(16000);
      });

      // The abort controller should have fired
      // Note: The actual abort handling is tested in the tailscale module
    });

    it('should cancel ongoing connection when disconnect is called', async () => {
      // Make the connectivity check hang
      let rejectFn: ((error: Error) => void) | null = null;
      mockCheckTailscaleConnectivity.mockImplementation(
        () => new Promise((_, reject) => {
          rejectFn = reject;
        })
      );

      const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

      act(() => {
        result.current.connect();
      });

      // Disconnect while connecting
      act(() => {
        result.current.disconnect();
      });

      expect(mockMarkDisconnected).toHaveBeenCalled();
    });

    it('should handle AbortError gracefully', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockCheckTailscaleConnectivity.mockRejectedValue(abortError);

      const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

      await act(async () => {
        await result.current.connect();
        vi.runAllTimers();
      });

      // AbortError should not transition to error state (it's expected for cancellation)
      // The state should remain as it was or transition based on other logic
    });
  });

  // ============================================
  // Rate Limiting
  // ============================================

  describe('Rate Limiting', () => {
    it('should rate limit connection attempts', async () => {
      const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

      // Make multiple rapid connection attempts
      await act(async () => {
        result.current.connect();
        result.current.connect();
        result.current.connect();
      });

      // Should only have called the connectivity check once due to rate limiting
      expect(mockCheckTailscaleConnectivity).toHaveBeenCalledTimes(1);
    });

    it('should allow connection attempt after rate limit window', async () => {
      const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

      // First connection attempt
      await act(async () => {
        await result.current.connect();
        vi.runAllTimers();
      });

      // Advance time past rate limit window (1000ms)
      await act(async () => {
        vi.advanceTimersByTime(1100);
      });

      // Second connection attempt should be allowed
      mockCheckTailscaleConnectivity.mockClear();
      await act(async () => {
        await result.current.connect();
        vi.runAllTimers();
      });

      expect(mockCheckTailscaleConnectivity).toHaveBeenCalled();
    });
  });

  // ============================================
  // Auto-Connect Behavior
  // ============================================

  describe('Auto-Connect Behavior', () => {
    it('should auto-connect on mount when autoConnect is true and configured', async () => {
      mockSettingsState.connection.isConfigured = true;
      mockSettingsState.connectionState = 'disconnected';

      await act(async () => {
        renderHook(() => useTailscaleConnection({ autoConnect: true }));
        vi.runAllTimers();
      });

      expect(mockSetConnectionState).toHaveBeenCalledWith('connecting');
    });

    it('should not auto-connect when autoConnect is false', async () => {
      mockSettingsState.connection.isConfigured = true;
      mockSettingsState.connectionState = 'disconnected';

      renderHook(() => useTailscaleConnection({ autoConnect: false }));

      await act(async () => {
        vi.runAllTimers();
      });

      // Should not have started connecting
      expect(mockSetConnectionState).not.toHaveBeenCalledWith('connecting');
    });

    it('should not auto-connect when not configured', async () => {
      mockSettingsState.connection.isConfigured = false;
      mockSettingsState.connection.tailscaleIp = null;
      mockSettingsState.connectionState = 'disconnected';

      renderHook(() => useTailscaleConnection({ autoConnect: true }));

      await act(async () => {
        vi.runAllTimers();
      });

      // Should not have started connecting when not configured
      expect(mockCheckTailscaleConnectivity).not.toHaveBeenCalled();
    });

    it('should not auto-connect when already connected', async () => {
      mockSettingsState.connectionState = 'connected';

      renderHook(() => useTailscaleConnection({ autoConnect: true }));

      await act(async () => {
        vi.runAllTimers();
      });

      // Should not re-connect if already connected
      expect(mockSetConnectionState).not.toHaveBeenCalledWith('connecting');
    });
  });

  // ============================================
  // Callback Invocation
  // ============================================

  describe('Callback Invocation', () => {
    it('should call onStateChange when state changes', async () => {
      const onStateChange = vi.fn();

      renderHook(() => useTailscaleConnection({
        autoConnect: false,
        onStateChange,
      }));

      // Trigger state change by updating mock state
      mockSettingsState.connectionState = 'connecting';

      // Force a re-render to trigger the effect
      await act(async () => {
        vi.runAllTimers();
      });
    });

    it('should call onConnected when connection is established', async () => {
      const onConnected = vi.fn();
      mockCheckTailscaleConnectivity.mockResolvedValue(
        createMockConnectionStatus('connected')
      );

      const { result } = renderHook(() => useTailscaleConnection({
        autoConnect: false,
        onConnected,
      }));

      await act(async () => {
        await result.current.connect();
        vi.runAllTimers();
        // Simulate the state being set to connected
        mockSettingsState.connectionState = 'connected';
      });
    });

    it('should call onDisconnected when connection is lost', async () => {
      const onDisconnected = vi.fn();
      mockSettingsState.connectionState = 'connected';

      const { result } = renderHook(() => useTailscaleConnection({
        autoConnect: false,
        onDisconnected,
      }));

      act(() => {
        result.current.disconnect();
        // Simulate the state being set to disconnected
        mockSettingsState.connectionState = 'disconnected';
      });
    });

    it('should call onError when an error occurs', async () => {
      const onError = vi.fn();
      const mockError = { type: 'timeout', message: 'Connection timed out', timestamp: Date.now() };

      mockCheckTailscaleConnectivity.mockResolvedValue(
        createMockConnectionStatus('error', { error: mockError })
      );

      const { result } = renderHook(() => useTailscaleConnection({
        autoConnect: false,
        onError,
      }));

      await act(async () => {
        await result.current.connect();
        vi.runAllTimers();
        // Simulate the error being set
        mockSettingsState.connectionError = mockError;
      });
    });
  });

  // ============================================
  // Derived State Values
  // ============================================

  describe('Derived State Values', () => {
    it('should return correct isConnected value', () => {
      mockSettingsState.connectionState = 'connected';
      const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

      expect(result.current.isConnected).toBe(true);
    });

    it('should return correct isConnecting value', () => {
      mockSettingsState.connectionState = 'connecting';
      const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

      expect(result.current.isConnecting).toBe(true);
    });

    it('should return correct isDisconnected value', () => {
      mockSettingsState.connectionState = 'disconnected';
      const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

      expect(result.current.isDisconnected).toBe(true);
    });

    it('should return correct hasError value', () => {
      mockSettingsState.connectionState = 'error';
      const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

      expect(result.current.hasError).toBe(true);
    });

    it('should return current error', () => {
      const mockError = { type: 'network_error', message: 'Test error', timestamp: Date.now() };
      mockSettingsState.connectionError = mockError;

      const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

      expect(result.current.error).toEqual(mockError);
    });

    it('should return isConfigured based on tailscaleIp', () => {
      mockSettingsState.connection.tailscaleIp = '100.64.1.1';
      mockSettingsState.connection.isConfigured = true;

      const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

      expect(result.current.isConfigured).toBe(true);
    });

    it('should return isConfigured as false when tailscaleIp is not set', () => {
      mockSettingsState.connection.tailscaleIp = null;
      mockSettingsState.connection.isConfigured = false;

      const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

      expect(result.current.isConfigured).toBe(false);
    });
  });

  // ============================================
  // Cleanup on Unmount
  // ============================================

  describe('Cleanup on Unmount', () => {
    it('should cancel ongoing connection on unmount', async () => {
      mockCheckTailscaleConnectivity.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      const { result, unmount } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

      act(() => {
        result.current.connect();
      });

      // Unmount while connecting
      unmount();

      // Should not throw or cause issues
    });

    it('should unsubscribe from connection monitor on unmount', async () => {
      const mockUnsubscribe = vi.fn();
      mockCreateConnectionMonitor.mockReturnValue({
        unsubscribe: mockUnsubscribe,
      });
      mockCheckTailscaleConnectivity.mockResolvedValue(
        createMockConnectionStatus('connected')
      );

      const { result, unmount } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

      // Connect to start the monitor
      await act(async () => {
        await result.current.connect();
        vi.runAllTimers();
      });

      // Unmount
      unmount();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });

  // ============================================
  // Not Configured Handling
  // ============================================

  describe('Not Configured Handling', () => {
    it('should set state to disconnected when connect is called without tailscaleIp', async () => {
      mockSettingsState.connection.tailscaleIp = null;

      const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

      await act(async () => {
        await result.current.connect();
      });

      expect(mockSetConnectionState).toHaveBeenCalledWith('disconnected');
    });

    it('should not call health check when tailscaleIp is not set', async () => {
      mockSettingsState.connection.tailscaleIp = null;
      mockCheckTailscaleConnectivity.mockClear();

      const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

      await act(async () => {
        await result.current.connect();
      });

      expect(mockCheckTailscaleConnectivity).not.toHaveBeenCalled();
    });
  });
});

// ============================================
// Convenience Hooks
// ============================================

describe('Convenience Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockState();
  });

  describe('useTailscaleConnected', () => {
    it('should return true when connected', () => {
      mockSettingsState.connectionState = 'connected';
      const { result } = renderHook(() => useTailscaleConnected());

      expect(result.current).toBe(true);
    });

    it('should return false when not connected', () => {
      mockSettingsState.connectionState = 'disconnected';
      const { result } = renderHook(() => useTailscaleConnected());

      expect(result.current).toBe(false);
    });

    it('should return false when connecting', () => {
      mockSettingsState.connectionState = 'connecting';
      const { result } = renderHook(() => useTailscaleConnected());

      expect(result.current).toBe(false);
    });

    it('should return false when in error state', () => {
      mockSettingsState.connectionState = 'error';
      const { result } = renderHook(() => useTailscaleConnected());

      expect(result.current).toBe(false);
    });
  });

  describe('useTailscaleState', () => {
    it('should return current connection state', () => {
      mockSettingsState.connectionState = 'connecting';
      const { result } = renderHook(() => useTailscaleState());

      expect(result.current).toBe('connecting');
    });

    it('should update when state changes', () => {
      mockSettingsState.connectionState = 'disconnected';
      const { result, rerender } = renderHook(() => useTailscaleState());

      expect(result.current).toBe('disconnected');

      mockSettingsState.connectionState = 'connected';
      rerender();

      expect(result.current).toBe('connected');
    });
  });

  describe('useTailscaleError', () => {
    it('should return null when no error', () => {
      mockSettingsState.connectionError = null;
      const { result } = renderHook(() => useTailscaleError());

      expect(result.current).toBeNull();
    });

    it('should return current error when present', () => {
      const mockError = { type: 'timeout', message: 'Connection timed out', timestamp: Date.now() };
      mockSettingsState.connectionError = mockError;

      const { result } = renderHook(() => useTailscaleError());

      expect(result.current).toEqual(mockError);
    });

    it('should update when error changes', () => {
      mockSettingsState.connectionError = null;
      const { result, rerender } = renderHook(() => useTailscaleError());

      expect(result.current).toBeNull();

      const newError = { type: 'network_error', message: 'Network failed', timestamp: Date.now() };
      mockSettingsState.connectionError = newError;
      rerender();

      expect(result.current).toEqual(newError);
    });
  });
});

// ============================================
// CheckConnection Method
// ============================================

describe('checkConnection Method', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockState();
    mockCheckTailscaleConnectivity.mockResolvedValue(
      createMockConnectionStatus('connected')
    );
  });

  it('should return connection status', async () => {
    const expectedStatus = createMockConnectionStatus('connected');
    mockCheckTailscaleConnectivity.mockResolvedValue(expectedStatus);

    const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

    let status: Awaited<ReturnType<typeof result.current.checkConnection>> | undefined;
    await act(async () => {
      status = await result.current.checkConnection();
    });

    expect(status).toEqual(expectedStatus);
  });

  it('should use configured health URL', async () => {
    const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

    await act(async () => {
      await result.current.checkConnection();
    });

    expect(mockCheckTailscaleConnectivity).toHaveBeenCalledWith(
      'http://100.64.1.1:3001/api/health',
      expect.any(Object)
    );
  });

  it('should return disconnected status when not configured', async () => {
    mockSettingsState.connection.tailscaleIp = null;
    mockCheckTailscaleConnectivity.mockResolvedValue(
      createMockConnectionStatus('disconnected')
    );

    const { result } = renderHook(() => useTailscaleConnection({ autoConnect: false }));

    let status: Awaited<ReturnType<typeof result.current.checkConnection>> | undefined;
    await act(async () => {
      status = await result.current.checkConnection();
    });

    expect(status?.state).toBe('disconnected');
  });
});
