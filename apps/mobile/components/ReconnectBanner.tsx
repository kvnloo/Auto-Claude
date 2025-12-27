/**
 * ReconnectBanner Component
 *
 * A non-blocking banner that displays at the top of the screen when
 * the Tailscale connection is lost. Shows retry option and connection
 * status. Auto-dismisses when connection is restored.
 *
 * Unlike ConnectionGuard which blocks the entire UI, this component
 * allows continued interaction while showing connection status.
 *
 * @see spec.md - Connection State UI requirement
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
  type ViewStyle,
  type TextStyle,
} from 'react-native';

import {
  useTailscaleConnection,
  type UseTailscaleConnectionOptions,
} from '../hooks/useTailscaleConnection';
import type { ConnectionState, ConnectionError } from '../types/settings';

// ============================================
// Types
// ============================================

/**
 * Props for the ReconnectBanner component
 */
export interface ReconnectBannerProps {
  /**
   * Whether to show the banner even when connected (for testing)
   * @default false
   */
  forceShow?: boolean;

  /**
   * Custom message to display when disconnected
   */
  disconnectedMessage?: string;

  /**
   * Custom message to display when connecting
   */
  connectingMessage?: string;

  /**
   * Custom message to display on error
   */
  errorMessage?: string;

  /**
   * Options to pass to the useTailscaleConnection hook
   */
  connectionOptions?: UseTailscaleConnectionOptions;

  /**
   * Whether to show the retry button
   * @default true
   */
  showRetryButton?: boolean;

  /**
   * Callback when retry button is pressed
   */
  onRetry?: () => void;

  /**
   * Callback when banner visibility changes
   */
  onVisibilityChange?: (visible: boolean) => void;

  /**
   * Style to apply to the container
   */
  style?: ViewStyle;

  /**
   * Whether to animate the banner appearance
   * @default true
   */
  animated?: boolean;

  /**
   * Animation duration in milliseconds
   * @default 300
   */
  animationDuration?: number;
}

/**
 * Props passed to custom content render function
 */
export interface BannerRenderProps {
  /**
   * Current connection state
   */
  state: ConnectionState;

  /**
   * Whether configured (has Tailscale IP set)
   */
  isConfigured: boolean;

  /**
   * Current connection error, if any
   */
  error: ConnectionError | null;

  /**
   * Function to retry connection
   */
  onRetry: () => Promise<void>;
}

// ============================================
// Constants
// ============================================

const DEFAULT_DISCONNECTED_MESSAGE = 'Connection lost';
const DEFAULT_CONNECTING_MESSAGE = 'Reconnecting...';
const DEFAULT_ERROR_MESSAGE = 'Connection failed';
const DEFAULT_NOT_CONFIGURED_MESSAGE = 'Not configured';

const ANIMATION_DURATION = 300;
const BANNER_HEIGHT = 56;

// ============================================
// Helper Functions
// ============================================

/**
 * Get the appropriate message for the current state
 */
function getStateMessage(
  state: ConnectionState,
  isConfigured: boolean,
  error: ConnectionError | null,
  messages: {
    disconnected?: string;
    connecting?: string;
    error?: string;
  }
): string {
  if (!isConfigured) {
    return DEFAULT_NOT_CONFIGURED_MESSAGE;
  }

  switch (state) {
    case 'connecting':
      return messages.connecting ?? DEFAULT_CONNECTING_MESSAGE;
    case 'error':
      return error?.message ?? messages.error ?? DEFAULT_ERROR_MESSAGE;
    case 'disconnected':
      return messages.disconnected ?? DEFAULT_DISCONNECTED_MESSAGE;
    case 'connected':
    default:
      return '';
  }
}

/**
 * Get the appropriate icon for the current state
 */
function getStateIcon(state: ConnectionState): string {
  switch (state) {
    case 'connecting':
      return ''; // Will show ActivityIndicator instead
    case 'error':
      return '!';
    case 'disconnected':
      return '○'; // Empty circle for disconnected
    case 'connected':
      return '●'; // Filled circle for connected
    default:
      return '?';
  }
}

/**
 * Get the appropriate colors for the current state
 */
function getStateColors(state: ConnectionState): {
  background: string;
  text: string;
  icon: string;
} {
  switch (state) {
    case 'connecting':
      return {
        background: COLORS.warningBackground,
        text: COLORS.warningText,
        icon: COLORS.warning,
      };
    case 'error':
      return {
        background: COLORS.errorBackground,
        text: COLORS.errorText,
        icon: COLORS.error,
      };
    case 'disconnected':
      return {
        background: COLORS.warningBackground,
        text: COLORS.warningText,
        icon: COLORS.warning,
      };
    case 'connected':
    default:
      return {
        background: COLORS.successBackground,
        text: COLORS.successText,
        icon: COLORS.success,
      };
  }
}

// ============================================
// Main Component
// ============================================

/**
 * ReconnectBanner displays a non-blocking notification banner at the top
 * of the screen when the Tailscale VPN connection is lost or experiencing issues.
 *
 * The banner automatically appears when connection is lost and disappears
 * when connection is restored. It provides a retry button for manual reconnection.
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <View style={{ flex: 1 }}>
 *       <ReconnectBanner />
 *       <MainContent />
 *     </View>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With custom messages and callbacks
 * function App() {
 *   return (
 *     <View style={{ flex: 1 }}>
 *       <ReconnectBanner
 *         disconnectedMessage="VPN disconnected"
 *         errorMessage="Cannot reach server"
 *         onRetry={() => console.log('Retrying...')}
 *         onVisibilityChange={(visible) => {
 *           console.log('Banner visible:', visible);
 *         }}
 *       />
 *       <MainContent />
 *     </View>
 *   );
 * }
 * ```
 */
export function ReconnectBanner({
  forceShow = false,
  disconnectedMessage,
  connectingMessage,
  errorMessage,
  connectionOptions,
  showRetryButton = true,
  onRetry: customOnRetry,
  onVisibilityChange,
  style,
  animated = true,
  animationDuration = ANIMATION_DURATION,
}: ReconnectBannerProps): JSX.Element | null {
  // Animation value for slide in/out
  const slideAnim = useRef(new Animated.Value(-BANNER_HEIGHT)).current;
  const isVisibleRef = useRef(false);

  // Get connection state from hook
  const {
    state,
    isConfigured,
    error,
    retry,
  } = useTailscaleConnection(connectionOptions);

  // Determine if banner should be visible
  const shouldBeVisible = forceShow || (state !== 'connected' && isConfigured);

  // Handle retry action
  const handleRetry = async (): Promise<void> => {
    if (customOnRetry) {
      customOnRetry();
    }
    await retry();
  };

  // Handle animation and visibility changes
  useEffect(() => {
    const wasVisible = isVisibleRef.current;
    isVisibleRef.current = shouldBeVisible;

    if (shouldBeVisible !== wasVisible) {
      // Notify visibility change
      onVisibilityChange?.(shouldBeVisible);

      // Animate banner
      if (animated) {
        Animated.timing(slideAnim, {
          toValue: shouldBeVisible ? 0 : -BANNER_HEIGHT,
          duration: animationDuration,
          useNativeDriver: true,
        }).start();
      } else {
        slideAnim.setValue(shouldBeVisible ? 0 : -BANNER_HEIGHT);
      }
    }
  }, [shouldBeVisible, animated, animationDuration, slideAnim, onVisibilityChange]);

  // Don't render if not visible and not animating
  if (!shouldBeVisible && !isVisibleRef.current) {
    return null;
  }

  // Get content based on state
  const message = getStateMessage(
    state,
    isConfigured,
    error,
    {
      disconnected: disconnectedMessage,
      connecting: connectingMessage,
      error: errorMessage,
    }
  );
  const icon = getStateIcon(state);
  const colors = getStateColors(state);

  const isConnecting = state === 'connecting';
  const canRetry = (state === 'error' || state === 'disconnected') && showRetryButton;

  return (
    <Animated.View
      style={[
        styles.container,
        { backgroundColor: colors.background },
        { transform: [{ translateY: slideAnim }] },
        style,
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.content}>
        {/* Status Icon / Spinner */}
        <View style={styles.iconContainer}>
          {isConnecting ? (
            <ActivityIndicator
              size="small"
              color={colors.icon}
              accessibilityLabel="Connecting"
            />
          ) : (
            <Text style={[styles.icon, { color: colors.icon }]}>
              {icon}
            </Text>
          )}
        </View>

        {/* Message */}
        <Text
          style={[styles.message, { color: colors.text }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {message}
        </Text>

        {/* Retry Button */}
        {canRetry && (
          <TouchableOpacity
            style={[styles.retryButton, { borderColor: colors.text }]}
            onPress={handleRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry connection"
            accessibilityHint="Double tap to retry connecting to the server"
          >
            <Text style={[styles.retryButtonText, { color: colors.text }]}>
              Retry
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

// ============================================
// Compact Banner Variant
// ============================================

/**
 * Props for the CompactReconnectBanner component
 */
export interface CompactReconnectBannerProps {
  /**
   * Whether to show the banner
   */
  visible?: boolean;

  /**
   * Current connection state (if controlling externally)
   */
  state?: ConnectionState;

  /**
   * Callback when retry button is pressed
   */
  onRetry?: () => void;

  /**
   * Style to apply to the container
   */
  style?: ViewStyle;
}

/**
 * A minimal version of the reconnect banner that just shows a dot and text.
 * Useful for embedding in headers or toolbars.
 *
 * @example
 * ```tsx
 * function Header() {
 *   const { state, retry } = useTailscaleConnection();
 *
 *   return (
 *     <View style={styles.header}>
 *       <Text style={styles.title}>My App</Text>
 *       {state !== 'connected' && (
 *         <CompactReconnectBanner
 *           state={state}
 *           onRetry={retry}
 *         />
 *       )}
 *     </View>
 *   );
 * }
 * ```
 */
export function CompactReconnectBanner({
  visible = true,
  state = 'disconnected',
  onRetry,
  style,
}: CompactReconnectBannerProps): JSX.Element | null {
  if (!visible) {
    return null;
  }

  const colors = getStateColors(state);
  const isConnecting = state === 'connecting';

  return (
    <TouchableOpacity
      style={[styles.compactContainer, style]}
      onPress={onRetry}
      disabled={isConnecting || !onRetry}
      accessibilityRole="button"
      accessibilityLabel={isConnecting ? 'Connecting' : 'Tap to retry connection'}
    >
      {isConnecting ? (
        <ActivityIndicator
          size="small"
          color={colors.icon}
        />
      ) : (
        <View style={[styles.statusDot, { backgroundColor: colors.icon }]} />
      )}
      <Text style={[styles.compactText, { color: colors.text }]}>
        {isConnecting ? 'Connecting' : 'Disconnected'}
      </Text>
    </TouchableOpacity>
  );
}

// ============================================
// Colors
// ============================================

const COLORS = {
  // Warning state (disconnected, connecting)
  warning: '#F59E0B',          // Amber
  warningBackground: '#FFFBEB',
  warningText: '#92400E',

  // Error state
  error: '#EF4444',            // Red
  errorBackground: '#FEF2F2',
  errorText: '#991B1B',

  // Success state (connected)
  success: '#10B981',          // Emerald
  successBackground: '#ECFDF5',
  successText: '#065F46',

  // Neutral
  buttonText: '#FFFFFF',
};

// ============================================
// Styles
// ============================================

interface Styles {
  container: ViewStyle;
  content: ViewStyle;
  iconContainer: ViewStyle;
  icon: TextStyle;
  message: TextStyle;
  retryButton: ViewStyle;
  retryButtonText: TextStyle;
  compactContainer: ViewStyle;
  statusDot: ViewStyle;
  compactText: TextStyle;
}

const styles = StyleSheet.create<Styles>({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: BANNER_HEIGHT,
    zIndex: 1000,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8, // Account for potential safe area
  },
  iconContainer: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  icon: {
    fontSize: 16,
    fontWeight: '600',
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  retryButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
    marginLeft: 12,
  },
  retryButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  compactText: {
    fontSize: 12,
    fontWeight: '500',
  },
});

// ============================================
// Export default
// ============================================

export default ReconnectBanner;
