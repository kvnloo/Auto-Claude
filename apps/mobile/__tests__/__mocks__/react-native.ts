/**
 * Mock for react-native module
 *
 * This mock provides stubs for React Native APIs used in the mobile app
 * to allow testing with Vitest without requiring the full React Native runtime.
 */

import { vi } from 'vitest';

// AppState mock
export const AppState = {
  currentState: 'active' as const,
  addEventListener: vi.fn(() => ({
    remove: vi.fn(),
  })),
  removeEventListener: vi.fn(),
};

// AppStateStatus type
export type AppStateStatus = 'active' | 'background' | 'inactive';

// Platform mock
export const Platform = {
  OS: 'ios' as const,
  select: <T extends Record<string, unknown>>(specifics: T) => specifics.ios || specifics.default,
  Version: 14,
};

// Dimensions mock
export const Dimensions = {
  get: vi.fn(() => ({
    width: 375,
    height: 812,
    scale: 2,
    fontScale: 1,
  })),
  addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  removeEventListener: vi.fn(),
};

// StyleSheet mock
export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  flatten: <T>(style: T): T => style,
  hairlineWidth: 1,
  absoluteFill: {},
  absoluteFillObject: {},
};

// Animated mock
export const Animated = {
  View: 'Animated.View',
  Text: 'Animated.Text',
  Image: 'Animated.Image',
  Value: class AnimatedValue {
    _value: number;
    constructor(value: number) {
      this._value = value;
    }
    setValue(value: number) {
      this._value = value;
    }
    interpolate() {
      return this;
    }
  },
  timing: () => ({
    start: (callback?: () => void) => callback?.(),
    stop: () => {},
  }),
  spring: () => ({
    start: (callback?: () => void) => callback?.(),
    stop: () => {},
  }),
  parallel: () => ({
    start: (callback?: () => void) => callback?.(),
    stop: () => {},
  }),
  sequence: () => ({
    start: (callback?: () => void) => callback?.(),
    stop: () => {},
  }),
  createAnimatedComponent: (component: unknown) => component,
};

// Text Input mock
export const TextInput = 'TextInput';

// View mock
export const View = 'View';

// Text mock
export const Text = 'Text';

// TouchableOpacity mock
export const TouchableOpacity = 'TouchableOpacity';

// ActivityIndicator mock
export const ActivityIndicator = 'ActivityIndicator';

// Alert mock
export const Alert = {
  alert: vi.fn(),
};

// NativeModules mock
export const NativeModules = {
  SettingsManager: {
    settings: {},
  },
  StatusBarManager: {
    HEIGHT: 44,
  },
  UIManager: {
    getViewManagerConfig: vi.fn(() => ({})),
  },
};

// Linking mock
export const Linking = {
  openURL: vi.fn(),
  canOpenURL: vi.fn(() => Promise.resolve(true)),
  getInitialURL: vi.fn(() => Promise.resolve(null)),
  addEventListener: vi.fn(() => ({ remove: vi.fn() })),
};

// PixelRatio mock
export const PixelRatio = {
  get: vi.fn(() => 2),
  getFontScale: vi.fn(() => 1),
  getPixelSizeForLayoutSize: vi.fn((size: number) => size * 2),
  roundToNearestPixel: vi.fn((size: number) => size),
};

// Default export
export default {
  AppState,
  Platform,
  Dimensions,
  StyleSheet,
  Animated,
  TextInput,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  NativeModules,
  Linking,
  PixelRatio,
};
