/**
 * Settings Store for the mobile companion app
 *
 * Uses Zustand with persist middleware for connection settings (AsyncStorage)
 * and expo-secure-store for API key storage (sensitive data).
 *
 * @see spec.md - Zustand Store Update Pattern
 */

import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import type {
  ConnectionSettings,
  ConnectionState,
  ConnectionError,
  SettingsState,
} from '../types/settings';
import {
  DEFAULT_CONNECTION_SETTINGS,
  DEFAULT_SETTINGS_STATE,
} from '../types/settings';

// ============================================
// Constants
// ============================================

/**
 * Storage key for persisted settings in AsyncStorage
 */
const SETTINGS_STORAGE_KEY = 'autoclaude-mobile-settings';

/**
 * SecureStore key for API key (sensitive data)
 */
const API_KEY_STORAGE_KEY = 'autoclaude-api-key';

// ============================================
// Custom Storage Adapter for React Native
// ============================================

/**
 * AsyncStorage adapter for Zustand persist middleware
 * Implements the StateStorage interface for React Native compatibility
 */
const asyncStorageAdapter: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return AsyncStorage.getItem(name);
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await AsyncStorage.setItem(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    await AsyncStorage.removeItem(name);
  },
};

// ============================================
// Store Actions Interface
// ============================================

/**
 * Actions available on the settings store
 */
interface SettingsActions {
  /**
   * Update connection settings with partial updates
   * @param updates - Partial connection settings to merge
   */
  updateConnectionSettings: (updates: Partial<ConnectionSettings>) => void;

  /**
   * Set the connection state
   * @param state - New connection state
   */
  setConnectionState: (state: ConnectionState) => void;

  /**
   * Set connection error
   * @param error - Connection error or null to clear
   */
  setConnectionError: (error: ConnectionError | null) => void;

  /**
   * Mark connection as established
   * Updates state to 'connected' and records timestamp
   */
  markConnected: () => void;

  /**
   * Mark connection as disconnected
   * Updates state to 'disconnected' and clears error
   */
  markDisconnected: () => void;

  /**
   * Reset settings to defaults
   * Clears connection settings but preserves API key in SecureStore
   */
  resetSettings: () => void;

  /**
   * Check if connection is fully configured
   * Returns true if tailscaleIp is set and valid
   */
  isConfigured: () => boolean;
}

/**
 * Complete settings store type
 */
type SettingsStore = SettingsState & SettingsActions;

// ============================================
// Settings Store
// ============================================

/**
 * Zustand store for mobile app settings
 *
 * Persists connection settings to AsyncStorage.
 * API key is stored separately in SecureStore for security.
 *
 * @example
 * ```typescript
 * const { connection, connectionState } = useSettingsStore();
 * const updateSettings = useSettingsStore((state) => state.updateConnectionSettings);
 *
 * // Update Tailscale IP
 * updateSettings({ tailscaleIp: '100.64.1.1' });
 * ```
 */
export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      // Initial state
      ...DEFAULT_SETTINGS_STATE,

      // Actions
      updateConnectionSettings: (updates: Partial<ConnectionSettings>): void => {
        set((state) => {
          const newConnection = { ...state.connection, ...updates };

          // Auto-update isConfigured based on tailscaleIp
          if (updates.tailscaleIp !== undefined) {
            newConnection.isConfigured = Boolean(
              newConnection.tailscaleIp &&
                newConnection.tailscaleIp.trim().length > 0
            );
          }

          return {
            connection: newConnection,
          };
        });
      },

      setConnectionState: (connectionState: ConnectionState): void => {
        set({ connectionState });
      },

      setConnectionError: (connectionError: ConnectionError | null): void => {
        set({ connectionError });
      },

      markConnected: (): void => {
        set({
          connectionState: 'connected',
          connectionError: null,
          lastConnectedAt: Date.now(),
        });
      },

      markDisconnected: (): void => {
        set({
          connectionState: 'disconnected',
          connectionError: null,
        });
      },

      resetSettings: (): void => {
        set({
          ...DEFAULT_SETTINGS_STATE,
        });
      },

      isConfigured: (): boolean => {
        const { connection } = get();
        return (
          connection.isConfigured &&
          Boolean(connection.tailscaleIp) &&
          connection.tailscaleIp!.trim().length > 0
        );
      },
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorageAdapter),
      // Only persist connection settings, not runtime state
      partialize: (state) => ({
        connection: state.connection,
        lastConnectedAt: state.lastConnectedAt,
      }),
      // Version for future migrations
      version: 1,
    }
  )
);

// ============================================
// API Key Management (SecureStore)
// ============================================

/**
 * Store API key securely using expo-secure-store
 *
 * @param apiKey - The API key to store
 * @throws Error if SecureStore operation fails
 *
 * @example
 * ```typescript
 * await saveApiKey('my-secret-api-key');
 * ```
 */
export async function saveApiKey(apiKey: string): Promise<void> {
  await SecureStore.setItemAsync(API_KEY_STORAGE_KEY, apiKey);
}

/**
 * Retrieve API key from secure storage
 *
 * @returns The stored API key or null if not set
 * @throws Error if SecureStore operation fails
 *
 * @example
 * ```typescript
 * const apiKey = await getApiKey();
 * if (apiKey) {
 *   // Use API key for requests
 * }
 * ```
 */
export async function getApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(API_KEY_STORAGE_KEY);
}

/**
 * Delete API key from secure storage
 *
 * @throws Error if SecureStore operation fails
 *
 * @example
 * ```typescript
 * await deleteApiKey();
 * ```
 */
export async function deleteApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(API_KEY_STORAGE_KEY);
}

/**
 * Check if an API key is stored
 *
 * @returns True if an API key exists in secure storage
 *
 * @example
 * ```typescript
 * const hasKey = await hasApiKey();
 * if (!hasKey) {
 *   // Prompt user to enter API key
 * }
 * ```
 */
export async function hasApiKey(): Promise<boolean> {
  const key = await getApiKey();
  return Boolean(key && key.trim().length > 0);
}

// ============================================
// Utility Functions
// ============================================

/**
 * Get the full API base URL from current settings
 *
 * @returns The base URL for API requests (e.g., "http://100.64.1.1:3001")
 * @returns null if tailscaleIp is not configured
 *
 * @example
 * ```typescript
 * const baseUrl = getApiBaseUrl();
 * if (baseUrl) {
 *   const response = await fetch(`${baseUrl}/api/health`);
 * }
 * ```
 */
export function getApiBaseUrl(): string | null {
  const { connection } = useSettingsStore.getState();

  if (!connection.tailscaleIp) {
    return null;
  }

  return `http://${connection.tailscaleIp}:${connection.apiPort}`;
}

/**
 * Get the health check URL for Tailscale connectivity testing
 *
 * @returns The health check endpoint URL or null if not configured
 *
 * @example
 * ```typescript
 * const healthUrl = getHealthCheckUrl();
 * if (healthUrl) {
 *   NetInfo.configure({ reachabilityUrl: healthUrl });
 * }
 * ```
 */
export function getHealthCheckUrl(): string | null {
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}/api/health` : null;
}

/**
 * Check if the app is fully configured for API access
 *
 * Checks both:
 * - Tailscale IP is configured in settings
 * - API key is stored in SecureStore
 *
 * @returns Promise resolving to true if fully configured
 *
 * @example
 * ```typescript
 * const ready = await isFullyConfigured();
 * if (!ready) {
 *   // Show onboarding/configuration screen
 * }
 * ```
 */
export async function isFullyConfigured(): Promise<boolean> {
  const store = useSettingsStore.getState();
  const hasKey = await hasApiKey();

  return store.isConfigured() && hasKey;
}
