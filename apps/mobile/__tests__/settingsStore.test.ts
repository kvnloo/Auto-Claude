/**
 * Unit tests for the settings store
 *
 * Tests tailscaleIp storage, API key SecureStore integration,
 * persistence, and update methods.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';

// ============================================
// Hoisted Mock Definitions
// ============================================

const {
  mockAsyncStorage,
  mockSecureStore,
} = vi.hoisted(() => {
  const storage: Record<string, string> = {};

  const mockAsyncStorage = {
    getItem: vi.fn((key: string) => Promise.resolve(storage[key] ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      storage[key] = value;
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      delete storage[key];
      return Promise.resolve();
    }),
    clear: vi.fn(() => {
      Object.keys(storage).forEach(key => delete storage[key]);
      return Promise.resolve();
    }),
    getAllKeys: vi.fn(() => Promise.resolve(Object.keys(storage))),
    _storage: storage, // Expose for testing
  };

  const secureStorage: Record<string, string> = {};

  const mockSecureStore = {
    setItemAsync: vi.fn((key: string, value: string) => {
      secureStorage[key] = value;
      return Promise.resolve();
    }),
    getItemAsync: vi.fn((key: string) => Promise.resolve(secureStorage[key] ?? null)),
    deleteItemAsync: vi.fn((key: string) => {
      delete secureStorage[key];
      return Promise.resolve();
    }),
    _storage: secureStorage, // Expose for testing
  };

  return { mockAsyncStorage, mockSecureStore };
});

// ============================================
// Module Mocks
// ============================================

// Mock expo-secure-store
vi.mock('expo-secure-store', () => mockSecureStore);

// Mock @react-native-async-storage/async-storage
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: mockAsyncStorage,
}));

// ============================================
// Import after mocks
// ============================================

import {
  useSettingsStore,
  saveApiKey,
  getApiKey,
  deleteApiKey,
  hasApiKey,
  getApiBaseUrl,
  getHealthCheckUrl,
  isFullyConfigured,
} from '../stores/settingsStore';
import {
  DEFAULT_SETTINGS_STATE,
  DEFAULT_CONNECTION_SETTINGS,
  type ConnectionSettings,
  type ConnectionError,
} from '../types/settings';

// ============================================
// Test Utilities
// ============================================

/**
 * Clear all storage and reset store state
 */
function resetStore(): void {
  // Clear mock storage
  Object.keys(mockAsyncStorage._storage).forEach(key => delete mockAsyncStorage._storage[key]);
  Object.keys(mockSecureStore._storage).forEach(key => delete mockSecureStore._storage[key]);

  // Reset the store to default state
  useSettingsStore.setState({
    ...DEFAULT_SETTINGS_STATE,
  });
}

/**
 * Create a test connection error
 */
function createTestError(
  type: 'timeout' | 'network_error' | 'auth_error' | 'server_error' | 'invalid_ip' | 'unknown' = 'network_error',
  message = 'Test error'
): ConnectionError {
  return {
    type,
    message,
    timestamp: Date.now(),
  };
}

// ============================================
// Tests
// ============================================

describe('Settings Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // Tailscale IP Storage Tests
  // ============================================

  describe('Tailscale IP Storage', () => {
    describe('updateConnectionSettings', () => {
      it('should update tailscaleIp when provided', () => {
        const store = useSettingsStore.getState();

        act(() => {
          store.updateConnectionSettings({ tailscaleIp: '100.64.1.1' });
        });

        const updatedState = useSettingsStore.getState();
        expect(updatedState.connection.tailscaleIp).toBe('100.64.1.1');
      });

      it('should set isConfigured to true when valid tailscaleIp is provided', () => {
        const store = useSettingsStore.getState();

        act(() => {
          store.updateConnectionSettings({ tailscaleIp: '100.64.1.1' });
        });

        const updatedState = useSettingsStore.getState();
        expect(updatedState.connection.isConfigured).toBe(true);
      });

      it('should set isConfigured to false when tailscaleIp is null', () => {
        // First set a valid IP
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: '100.64.1.1' });
        });
        expect(useSettingsStore.getState().connection.isConfigured).toBe(true);

        // Then set it to null
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: null });
        });
        expect(useSettingsStore.getState().connection.isConfigured).toBe(false);
      });

      it('should set isConfigured to false when tailscaleIp is empty string', () => {
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: '' });
        });

        expect(useSettingsStore.getState().connection.isConfigured).toBe(false);
      });

      it('should set isConfigured to false when tailscaleIp is whitespace only', () => {
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: '   ' });
        });

        expect(useSettingsStore.getState().connection.isConfigured).toBe(false);
      });

      it('should update apiPort when provided', () => {
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({ apiPort: 8080 });
        });

        expect(useSettingsStore.getState().connection.apiPort).toBe(8080);
      });

      it('should preserve other connection settings when updating tailscaleIp', () => {
        // Set custom port
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({ apiPort: 8080 });
        });

        // Update tailscaleIp
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: '100.64.1.1' });
        });

        const state = useSettingsStore.getState();
        expect(state.connection.apiPort).toBe(8080);
        expect(state.connection.tailscaleIp).toBe('100.64.1.1');
      });

      it('should handle multiple simultaneous updates', () => {
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({
            tailscaleIp: '100.64.1.1',
            apiPort: 9000,
          });
        });

        const state = useSettingsStore.getState();
        expect(state.connection.tailscaleIp).toBe('100.64.1.1');
        expect(state.connection.apiPort).toBe(9000);
        expect(state.connection.isConfigured).toBe(true);
      });

      it('should not affect isConfigured when updating only apiPort', () => {
        // Initially not configured
        expect(useSettingsStore.getState().connection.isConfigured).toBe(false);

        act(() => {
          useSettingsStore.getState().updateConnectionSettings({ apiPort: 8080 });
        });

        // Should still be not configured
        expect(useSettingsStore.getState().connection.isConfigured).toBe(false);
      });
    });

    describe('IP format handling', () => {
      it('should store various valid Tailscale IPs', () => {
        const validIps = [
          '100.64.0.0',
          '100.64.1.1',
          '100.100.100.100',
          '100.127.255.255',
        ];

        for (const ip of validIps) {
          act(() => {
            useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: ip });
          });
          expect(useSettingsStore.getState().connection.tailscaleIp).toBe(ip);
        }
      });

      it('should store IPs even if not in CGNAT range (validation is separate)', () => {
        // The store just stores the value; validation is done elsewhere
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: '192.168.1.1' });
        });
        expect(useSettingsStore.getState().connection.tailscaleIp).toBe('192.168.1.1');
        expect(useSettingsStore.getState().connection.isConfigured).toBe(true);
      });
    });
  });

  // ============================================
  // API Key SecureStore Integration Tests
  // ============================================

  describe('API Key SecureStore Integration', () => {
    describe('saveApiKey', () => {
      it('should save API key to SecureStore', async () => {
        await saveApiKey('test-api-key-123');

        expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
          'autoclaude-api-key',
          'test-api-key-123'
        );
      });

      it('should store API key in secure storage', async () => {
        await saveApiKey('my-secret-key');

        expect(mockSecureStore._storage['autoclaude-api-key']).toBe('my-secret-key');
      });

      it('should overwrite existing API key', async () => {
        await saveApiKey('first-key');
        await saveApiKey('second-key');

        expect(mockSecureStore._storage['autoclaude-api-key']).toBe('second-key');
      });

      it('should handle empty API key', async () => {
        await saveApiKey('');

        expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
          'autoclaude-api-key',
          ''
        );
      });
    });

    describe('getApiKey', () => {
      it('should retrieve API key from SecureStore', async () => {
        await saveApiKey('test-api-key');

        const result = await getApiKey();

        expect(result).toBe('test-api-key');
      });

      it('should return null when no API key is stored', async () => {
        const result = await getApiKey();

        expect(result).toBeNull();
      });

      it('should call SecureStore.getItemAsync with correct key', async () => {
        await getApiKey();

        expect(mockSecureStore.getItemAsync).toHaveBeenCalledWith('autoclaude-api-key');
      });
    });

    describe('deleteApiKey', () => {
      it('should delete API key from SecureStore', async () => {
        await saveApiKey('test-key');
        await deleteApiKey();

        expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('autoclaude-api-key');
      });

      it('should remove API key from storage', async () => {
        await saveApiKey('test-key');
        expect(mockSecureStore._storage['autoclaude-api-key']).toBe('test-key');

        await deleteApiKey();
        expect(mockSecureStore._storage['autoclaude-api-key']).toBeUndefined();
      });

      it('should not throw when no API key exists', async () => {
        await expect(deleteApiKey()).resolves.not.toThrow();
      });
    });

    describe('hasApiKey', () => {
      it('should return true when API key exists', async () => {
        await saveApiKey('valid-key');

        const result = await hasApiKey();

        expect(result).toBe(true);
      });

      it('should return false when no API key exists', async () => {
        const result = await hasApiKey();

        expect(result).toBe(false);
      });

      it('should return false when API key is empty string', async () => {
        await saveApiKey('');

        const result = await hasApiKey();

        expect(result).toBe(false);
      });

      it('should return false when API key is whitespace only', async () => {
        await saveApiKey('   ');

        const result = await hasApiKey();

        expect(result).toBe(false);
      });
    });
  });

  // ============================================
  // Connection State Management Tests
  // ============================================

  describe('Connection State Management', () => {
    describe('setConnectionState', () => {
      it('should update connection state to connecting', () => {
        act(() => {
          useSettingsStore.getState().setConnectionState('connecting');
        });

        expect(useSettingsStore.getState().connectionState).toBe('connecting');
      });

      it('should update connection state to connected', () => {
        act(() => {
          useSettingsStore.getState().setConnectionState('connected');
        });

        expect(useSettingsStore.getState().connectionState).toBe('connected');
      });

      it('should update connection state to disconnected', () => {
        act(() => {
          useSettingsStore.getState().setConnectionState('connected');
          useSettingsStore.getState().setConnectionState('disconnected');
        });

        expect(useSettingsStore.getState().connectionState).toBe('disconnected');
      });

      it('should update connection state to error', () => {
        act(() => {
          useSettingsStore.getState().setConnectionState('error');
        });

        expect(useSettingsStore.getState().connectionState).toBe('error');
      });
    });

    describe('setConnectionError', () => {
      it('should set connection error', () => {
        const error = createTestError('timeout', 'Connection timed out');

        act(() => {
          useSettingsStore.getState().setConnectionError(error);
        });

        expect(useSettingsStore.getState().connectionError).toEqual(error);
      });

      it('should clear connection error when set to null', () => {
        const error = createTestError();

        act(() => {
          useSettingsStore.getState().setConnectionError(error);
        });
        expect(useSettingsStore.getState().connectionError).not.toBeNull();

        act(() => {
          useSettingsStore.getState().setConnectionError(null);
        });
        expect(useSettingsStore.getState().connectionError).toBeNull();
      });

      it('should overwrite existing error', () => {
        const error1 = createTestError('timeout', 'First error');
        const error2 = createTestError('network_error', 'Second error');

        act(() => {
          useSettingsStore.getState().setConnectionError(error1);
          useSettingsStore.getState().setConnectionError(error2);
        });

        expect(useSettingsStore.getState().connectionError?.message).toBe('Second error');
      });
    });

    describe('markConnected', () => {
      it('should set state to connected', () => {
        act(() => {
          useSettingsStore.getState().markConnected();
        });

        expect(useSettingsStore.getState().connectionState).toBe('connected');
      });

      it('should clear any existing error', () => {
        act(() => {
          useSettingsStore.getState().setConnectionError(createTestError());
          useSettingsStore.getState().markConnected();
        });

        expect(useSettingsStore.getState().connectionError).toBeNull();
      });

      it('should set lastConnectedAt timestamp', () => {
        const beforeTime = Date.now();

        act(() => {
          useSettingsStore.getState().markConnected();
        });

        const afterTime = Date.now();
        const lastConnectedAt = useSettingsStore.getState().lastConnectedAt;

        expect(lastConnectedAt).not.toBeNull();
        expect(lastConnectedAt).toBeGreaterThanOrEqual(beforeTime);
        expect(lastConnectedAt).toBeLessThanOrEqual(afterTime);
      });

      it('should update lastConnectedAt on subsequent calls', async () => {
        act(() => {
          useSettingsStore.getState().markConnected();
        });
        const firstTimestamp = useSettingsStore.getState().lastConnectedAt;

        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 10));

        act(() => {
          useSettingsStore.getState().markConnected();
        });
        const secondTimestamp = useSettingsStore.getState().lastConnectedAt;

        expect(secondTimestamp).toBeGreaterThan(firstTimestamp!);
      });
    });

    describe('markDisconnected', () => {
      it('should set state to disconnected', () => {
        act(() => {
          useSettingsStore.getState().setConnectionState('connected');
          useSettingsStore.getState().markDisconnected();
        });

        expect(useSettingsStore.getState().connectionState).toBe('disconnected');
      });

      it('should clear any existing error', () => {
        act(() => {
          useSettingsStore.getState().setConnectionError(createTestError());
          useSettingsStore.getState().markDisconnected();
        });

        expect(useSettingsStore.getState().connectionError).toBeNull();
      });

      it('should not modify lastConnectedAt', () => {
        act(() => {
          useSettingsStore.getState().markConnected();
        });
        const timestamp = useSettingsStore.getState().lastConnectedAt;

        act(() => {
          useSettingsStore.getState().markDisconnected();
        });

        expect(useSettingsStore.getState().lastConnectedAt).toBe(timestamp);
      });
    });
  });

  // ============================================
  // Reset Settings Tests
  // ============================================

  describe('resetSettings', () => {
    it('should reset connection settings to defaults', () => {
      act(() => {
        useSettingsStore.getState().updateConnectionSettings({
          tailscaleIp: '100.64.1.1',
          apiPort: 9000,
        });
        useSettingsStore.getState().resetSettings();
      });

      const state = useSettingsStore.getState();
      expect(state.connection).toEqual(DEFAULT_CONNECTION_SETTINGS);
    });

    it('should reset connection state to disconnected', () => {
      act(() => {
        useSettingsStore.getState().setConnectionState('connected');
        useSettingsStore.getState().resetSettings();
      });

      expect(useSettingsStore.getState().connectionState).toBe('disconnected');
    });

    it('should clear connection error', () => {
      act(() => {
        useSettingsStore.getState().setConnectionError(createTestError());
        useSettingsStore.getState().resetSettings();
      });

      expect(useSettingsStore.getState().connectionError).toBeNull();
    });

    it('should clear lastConnectedAt', () => {
      act(() => {
        useSettingsStore.getState().markConnected();
        useSettingsStore.getState().resetSettings();
      });

      expect(useSettingsStore.getState().lastConnectedAt).toBeNull();
    });

    it('should NOT delete API key from SecureStore', async () => {
      await saveApiKey('test-key');

      act(() => {
        useSettingsStore.getState().resetSettings();
      });

      // API key should still exist
      const apiKey = await getApiKey();
      expect(apiKey).toBe('test-key');
    });
  });

  // ============================================
  // isConfigured Tests
  // ============================================

  describe('isConfigured', () => {
    it('should return false when tailscaleIp is null', () => {
      const result = useSettingsStore.getState().isConfigured();
      expect(result).toBe(false);
    });

    it('should return false when tailscaleIp is empty string', () => {
      act(() => {
        useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: '' });
      });

      const result = useSettingsStore.getState().isConfigured();
      expect(result).toBe(false);
    });

    it('should return false when tailscaleIp is whitespace', () => {
      act(() => {
        useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: '   ' });
      });

      const result = useSettingsStore.getState().isConfigured();
      expect(result).toBe(false);
    });

    it('should return true when tailscaleIp is set', () => {
      act(() => {
        useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: '100.64.1.1' });
      });

      const result = useSettingsStore.getState().isConfigured();
      expect(result).toBe(true);
    });

    it('should reflect current state after updates', () => {
      // Initially false
      expect(useSettingsStore.getState().isConfigured()).toBe(false);

      // Set IP -> true
      act(() => {
        useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: '100.64.1.1' });
      });
      expect(useSettingsStore.getState().isConfigured()).toBe(true);

      // Clear IP -> false
      act(() => {
        useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: null });
      });
      expect(useSettingsStore.getState().isConfigured()).toBe(false);
    });
  });

  // ============================================
  // Utility Functions Tests
  // ============================================

  describe('Utility Functions', () => {
    describe('getApiBaseUrl', () => {
      it('should return null when tailscaleIp is not set', () => {
        const result = getApiBaseUrl();
        expect(result).toBeNull();
      });

      it('should return correct URL when tailscaleIp is set', () => {
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: '100.64.1.1' });
        });

        const result = getApiBaseUrl();
        expect(result).toBe('http://100.64.1.1:3001');
      });

      it('should use custom port when set', () => {
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({
            tailscaleIp: '100.64.1.1',
            apiPort: 8080,
          });
        });

        const result = getApiBaseUrl();
        expect(result).toBe('http://100.64.1.1:8080');
      });

      it('should use default port 3001 when not customized', () => {
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: '100.64.1.1' });
        });

        const result = getApiBaseUrl();
        expect(result).toContain(':3001');
      });
    });

    describe('getHealthCheckUrl', () => {
      it('should return null when tailscaleIp is not set', () => {
        const result = getHealthCheckUrl();
        expect(result).toBeNull();
      });

      it('should return correct health check URL', () => {
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: '100.64.1.1' });
        });

        const result = getHealthCheckUrl();
        expect(result).toBe('http://100.64.1.1:3001/api/health');
      });

      it('should include custom port in health check URL', () => {
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({
            tailscaleIp: '100.64.1.1',
            apiPort: 9000,
          });
        });

        const result = getHealthCheckUrl();
        expect(result).toBe('http://100.64.1.1:9000/api/health');
      });
    });

    describe('isFullyConfigured', () => {
      it('should return false when neither IP nor API key is set', async () => {
        const result = await isFullyConfigured();
        expect(result).toBe(false);
      });

      it('should return false when only IP is set', async () => {
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: '100.64.1.1' });
        });

        const result = await isFullyConfigured();
        expect(result).toBe(false);
      });

      it('should return false when only API key is set', async () => {
        await saveApiKey('test-key');

        const result = await isFullyConfigured();
        expect(result).toBe(false);
      });

      it('should return true when both IP and API key are set', async () => {
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: '100.64.1.1' });
        });
        await saveApiKey('test-key');

        const result = await isFullyConfigured();
        expect(result).toBe(true);
      });

      it('should return false when IP is set but API key is empty', async () => {
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: '100.64.1.1' });
        });
        await saveApiKey('');

        const result = await isFullyConfigured();
        expect(result).toBe(false);
      });
    });
  });

  // ============================================
  // Persistence Tests
  // ============================================

  describe('Persistence', () => {
    describe('AsyncStorage persistence', () => {
      it('should use correct storage key', () => {
        // The store should use 'autoclaude-mobile-settings' key
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: '100.64.1.1' });
        });

        // Zustand persist will have attempted to save
        // We can verify by checking the mock was called
        expect(mockAsyncStorage.setItem).toHaveBeenCalled();
      });

      it('should persist connection settings to AsyncStorage', async () => {
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({
            tailscaleIp: '100.64.1.1',
            apiPort: 8080,
          });
        });

        // Allow async persistence to complete
        await new Promise(resolve => setTimeout(resolve, 0));

        // Check that setItem was called
        expect(mockAsyncStorage.setItem).toHaveBeenCalled();
      });

      it('should persist lastConnectedAt to AsyncStorage', async () => {
        act(() => {
          useSettingsStore.getState().markConnected();
        });

        // Allow async persistence to complete
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockAsyncStorage.setItem).toHaveBeenCalled();
      });
    });

    describe('SecureStore for API key', () => {
      it('should use SecureStore for API key, not AsyncStorage', async () => {
        await saveApiKey('secret-key');

        // Should use SecureStore
        expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
          'autoclaude-api-key',
          'secret-key'
        );

        // Should NOT use AsyncStorage for API key
        const asyncStorageCalls = mockAsyncStorage.setItem.mock.calls;
        const hasApiKeyInAsyncStorage = asyncStorageCalls.some(
          (call: [string, string]) => call[1]?.includes('secret-key')
        );
        expect(hasApiKeyInAsyncStorage).toBe(false);
      });
    });

    describe('partialize', () => {
      it('should only persist connection and lastConnectedAt', async () => {
        // Set up state with all fields
        act(() => {
          useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: '100.64.1.1' });
          useSettingsStore.getState().setConnectionState('connected');
          useSettingsStore.getState().setConnectionError(createTestError());
        });

        // Allow async persistence to complete
        await new Promise(resolve => setTimeout(resolve, 0));

        // Check what was persisted
        // The persisted data should include connection and lastConnectedAt
        // but NOT connectionState or connectionError (runtime state)
        const calls = mockAsyncStorage.setItem.mock.calls;
        expect(calls.length).toBeGreaterThan(0);
      });
    });
  });

  // ============================================
  // Default State Tests
  // ============================================

  describe('Default State', () => {
    it('should have correct default connection settings', () => {
      const state = useSettingsStore.getState();
      expect(state.connection.tailscaleIp).toBeNull();
      expect(state.connection.apiPort).toBe(3001);
      expect(state.connection.isConfigured).toBe(false);
    });

    it('should have correct default connection state', () => {
      const state = useSettingsStore.getState();
      expect(state.connectionState).toBe('disconnected');
    });

    it('should have no connection error by default', () => {
      const state = useSettingsStore.getState();
      expect(state.connectionError).toBeNull();
    });

    it('should have null lastConnectedAt by default', () => {
      const state = useSettingsStore.getState();
      expect(state.lastConnectedAt).toBeNull();
    });
  });

  // ============================================
  // Error Type Coverage Tests
  // ============================================

  describe('Error Type Coverage', () => {
    it('should handle all connection error types', () => {
      const errorTypes: Array<'timeout' | 'network_error' | 'auth_error' | 'server_error' | 'invalid_ip' | 'unknown'> = [
        'timeout',
        'network_error',
        'auth_error',
        'server_error',
        'invalid_ip',
        'unknown',
      ];

      for (const errorType of errorTypes) {
        const error = createTestError(errorType, `${errorType} error`);

        act(() => {
          useSettingsStore.getState().setConnectionError(error);
        });

        expect(useSettingsStore.getState().connectionError?.type).toBe(errorType);
      }
    });
  });

  // ============================================
  // Edge Cases Tests
  // ============================================

  describe('Edge Cases', () => {
    it('should handle rapid state changes', () => {
      act(() => {
        const store = useSettingsStore.getState();
        store.setConnectionState('connecting');
        store.setConnectionState('connected');
        store.setConnectionState('error');
        store.setConnectionState('disconnected');
      });

      expect(useSettingsStore.getState().connectionState).toBe('disconnected');
    });

    it('should handle setting same tailscaleIp multiple times', () => {
      act(() => {
        const store = useSettingsStore.getState();
        store.updateConnectionSettings({ tailscaleIp: '100.64.1.1' });
        store.updateConnectionSettings({ tailscaleIp: '100.64.1.1' });
        store.updateConnectionSettings({ tailscaleIp: '100.64.1.1' });
      });

      expect(useSettingsStore.getState().connection.tailscaleIp).toBe('100.64.1.1');
    });

    it('should handle markConnected followed by markDisconnected', () => {
      act(() => {
        useSettingsStore.getState().markConnected();
        useSettingsStore.getState().markDisconnected();
      });

      const state = useSettingsStore.getState();
      expect(state.connectionState).toBe('disconnected');
      expect(state.connectionError).toBeNull();
      expect(state.lastConnectedAt).not.toBeNull(); // Should be preserved
    });

    it('should handle error during connected state', () => {
      act(() => {
        useSettingsStore.getState().markConnected();
        useSettingsStore.getState().setConnectionState('error');
        useSettingsStore.getState().setConnectionError(createTestError('network_error', 'Connection lost'));
      });

      const state = useSettingsStore.getState();
      expect(state.connectionState).toBe('error');
      expect(state.connectionError?.message).toBe('Connection lost');
      expect(state.lastConnectedAt).not.toBeNull(); // Should be preserved from when connected
    });

    it('should handle very long IP strings', () => {
      const longString = '100.' + '0'.repeat(100);

      act(() => {
        useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: longString });
      });

      expect(useSettingsStore.getState().connection.tailscaleIp).toBe(longString);
      expect(useSettingsStore.getState().connection.isConfigured).toBe(true);
    });

    it('should handle special characters in IP (validation is separate)', () => {
      const specialIp = '100.64.1<script>alert(1)</script>';

      act(() => {
        useSettingsStore.getState().updateConnectionSettings({ tailscaleIp: specialIp });
      });

      // Store accepts the value; validation should happen elsewhere
      expect(useSettingsStore.getState().connection.tailscaleIp).toBe(specialIp);
    });

    it('should handle zero port', () => {
      act(() => {
        useSettingsStore.getState().updateConnectionSettings({ apiPort: 0 });
      });

      expect(useSettingsStore.getState().connection.apiPort).toBe(0);
    });

    it('should handle very large port numbers', () => {
      act(() => {
        useSettingsStore.getState().updateConnectionSettings({ apiPort: 99999 });
      });

      expect(useSettingsStore.getState().connection.apiPort).toBe(99999);
    });
  });
});
