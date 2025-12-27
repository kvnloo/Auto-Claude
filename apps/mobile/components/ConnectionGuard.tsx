/**
 * ConnectionGuard Component
 *
 * A wrapper component that blocks UI access when Tailscale is disconnected.
 * Shows a full-screen overlay requiring VPN connection before allowing
 * interaction with child components.
 *
 * @see spec.md - Connection State UI requirement
 */

import React, { type ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
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
 * Props for the ConnectionGuard component
 */
export interface ConnectionGuardProps {
  /**
   * Child components to render when connected
   */
  children: ReactNode;

  /**
   * Whether to allow rendering children in 'connecting' state
   * @default false
   */
  allowWhileConnecting?: boolean;

  /**
   * Custom overlay component to render when disconnected
   * If not provided, uses the default DisconnectedOverlay
   */
  renderOverlay?: (props: OverlayRenderProps) => ReactNode;

  /**
   * Custom message to display in the overlay
   */
  message?: string;

  /**
   * Custom title to display in the overlay
   */
  title?: string;

  /**
   * Options to pass to the useTailscaleConnection hook
   */
  connectionOptions?: UseTailscaleConnectionOptions;

  /**
   * Style to apply to the container
   */
  style?: ViewStyle;

  /**
   * Whether to show the retry button on error
   * @default true
   */
  showRetryButton?: boolean;

  /**
   * Callback when retry button is pressed
   */
  onRetry?: () => void;
}

/**
 * Props passed to custom overlay render function
 */
export interface OverlayRenderProps {
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

  /**
   * Function to initiate connection
   */
  onConnect: () => Promise<void>;
}

// ============================================
// Constants
// ============================================

const DEFAULT_TITLE = 'Connection Required';
const DEFAULT_MESSAGE =
  'Please connect to Tailscale VPN to access AutoClaude.';
const CONNECTING_MESSAGE = 'Connecting to server...';
const ERROR_TITLE = 'Connection Error';
const NOT_CONFIGURED_TITLE = 'Setup Required';
const NOT_CONFIGURED_MESSAGE =
  'Please configure your Tailscale IP address in Settings.';

// ============================================
// Default Overlay Component
// ============================================

/**
 * Props for the DisconnectedOverlay component
 */
interface DisconnectedOverlayProps {
  state: ConnectionState;
  isConfigured: boolean;
  error: ConnectionError | null;
  title?: string;
  message?: string;
  showRetryButton: boolean;
  onRetry: () => void;
  onConnect: () => void;
}

/**
 * Default overlay shown when Tailscale is disconnected
 */
function DisconnectedOverlay({
  state,
  isConfigured,
  error,
  title,
  message,
  showRetryButton,
  onRetry,
  onConnect,
}: DisconnectedOverlayProps): JSX.Element {
  // Determine content based on state
  const getContent = (): { title: string; message: string; showSpinner: boolean } => {
    if (!isConfigured) {
      return {
        title: NOT_CONFIGURED_TITLE,
        message: NOT_CONFIGURED_MESSAGE,
        showSpinner: false,
      };
    }

    switch (state) {
      case 'connecting':
        return {
          title: title ?? DEFAULT_TITLE,
          message: CONNECTING_MESSAGE,
          showSpinner: true,
        };
      case 'error':
        return {
          title: ERROR_TITLE,
          message: error?.message ?? 'An unknown error occurred.',
          showSpinner: false,
        };
      case 'disconnected':
      default:
        return {
          title: title ?? DEFAULT_TITLE,
          message: message ?? DEFAULT_MESSAGE,
          showSpinner: false,
        };
    }
  };

  const content = getContent();

  return (
    <View style={styles.overlay}>
      <View style={styles.overlayContent}>
        {/* Icon placeholder - using text for now */}
        <View style={styles.iconContainer}>
          {content.showSpinner ? (
            <ActivityIndicator size="large" color={COLORS.primary} />
          ) : (
            <Text style={styles.iconText}>
              {state === 'error' ? '!' : '?'}
            </Text>
          )}
        </View>

        {/* Title */}
        <Text style={styles.title}>{content.title}</Text>

        {/* Message */}
        <Text style={styles.message}>{content.message}</Text>

        {/* Error details */}
        {state === 'error' && error && (
          <View style={styles.errorDetails}>
            <Text style={styles.errorType}>
              Error type: {error.type}
            </Text>
          </View>
        )}

        {/* Action buttons */}
        <View style={styles.buttonContainer}>
          {state === 'error' && showRetryButton && (
            <TouchableOpacity
              style={styles.retryButton}
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel="Retry connection"
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          )}

          {state === 'disconnected' && isConfigured && (
            <TouchableOpacity
              style={styles.connectButton}
              onPress={onConnect}
              accessibilityRole="button"
              accessibilityLabel="Connect to server"
            >
              <Text style={styles.connectButtonText}>Connect</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Help text */}
        <Text style={styles.helpText}>
          Ensure Tailscale is running and connected on your device.
        </Text>
      </View>
    </View>
  );
}

// ============================================
// Main Component
// ============================================

/**
 * ConnectionGuard wraps child components and blocks access when
 * the Tailscale VPN connection is not active.
 *
 * Uses the useTailscaleConnection hook to monitor connection state
 * and displays a full-screen overlay when disconnected.
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <ConnectionGuard>
 *       <MainContent />
 *     </ConnectionGuard>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With custom options
 * function App() {
 *   return (
 *     <ConnectionGuard
 *       title="VPN Required"
 *       message="Connect to the company VPN to continue."
 *       allowWhileConnecting={true}
 *       connectionOptions={{
 *         autoConnect: true,
 *         onError: (err) => console.error(err),
 *       }}
 *     >
 *       <MainContent />
 *     </ConnectionGuard>
 *   );
 * }
 * ```
 */
export function ConnectionGuard({
  children,
  allowWhileConnecting = false,
  renderOverlay,
  message,
  title,
  connectionOptions,
  style,
  showRetryButton = true,
  onRetry: customOnRetry,
}: ConnectionGuardProps): JSX.Element {
  const {
    state,
    isConfigured,
    error,
    connect,
    retry,
  } = useTailscaleConnection(connectionOptions);

  // Handle retry action
  const handleRetry = async (): Promise<void> => {
    if (customOnRetry) {
      customOnRetry();
    }
    await retry();
  };

  // Handle connect action
  const handleConnect = async (): Promise<void> => {
    await connect();
  };

  // Determine if we should show the overlay
  const shouldShowOverlay = (): boolean => {
    switch (state) {
      case 'connected':
        return false;
      case 'connecting':
        return !allowWhileConnecting;
      case 'disconnected':
      case 'error':
        return true;
      default:
        return true;
    }
  };

  // Render custom overlay if provided
  if (shouldShowOverlay() && renderOverlay) {
    return (
      <View style={[styles.container, style]}>
        {renderOverlay({
          state,
          isConfigured,
          error,
          onRetry: handleRetry,
          onConnect: handleConnect,
        })}
      </View>
    );
  }

  // Render default overlay or children
  return (
    <View style={[styles.container, style]}>
      {shouldShowOverlay() ? (
        <DisconnectedOverlay
          state={state}
          isConfigured={isConfigured}
          error={error}
          title={title}
          message={message}
          showRetryButton={showRetryButton}
          onRetry={handleRetry}
          onConnect={handleConnect}
        />
      ) : (
        children
      )}
    </View>
  );
}

// ============================================
// Colors
// ============================================

const COLORS = {
  primary: '#3B82F6', // Blue
  error: '#EF4444',   // Red
  background: '#F9FAFB',
  overlayBackground: '#FFFFFF',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',
  border: '#E5E7EB',
  buttonText: '#FFFFFF',
};

// ============================================
// Styles
// ============================================

interface Styles {
  container: ViewStyle;
  overlay: ViewStyle;
  overlayContent: ViewStyle;
  iconContainer: ViewStyle;
  iconText: TextStyle;
  title: TextStyle;
  message: TextStyle;
  errorDetails: ViewStyle;
  errorType: TextStyle;
  buttonContainer: ViewStyle;
  retryButton: ViewStyle;
  retryButtonText: TextStyle;
  connectButton: ViewStyle;
  connectButtonText: TextStyle;
  helpText: TextStyle;
}

const styles = StyleSheet.create<Styles>({
  container: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  overlayContent: {
    backgroundColor: COLORS.overlayBackground,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    maxWidth: 400,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  iconText: {
    fontSize: 36,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: 12,
  },
  message: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },
  errorDetails: {
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    padding: 12,
    marginBottom: 24,
    width: '100%',
  },
  errorType: {
    fontSize: 13,
    color: COLORS.error,
    textAlign: 'center',
    fontWeight: '500',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: COLORS.error,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
    minWidth: 120,
  },
  retryButtonText: {
    color: COLORS.buttonText,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  connectButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
    minWidth: 120,
  },
  connectButtonText: {
    color: COLORS.buttonText,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  helpText: {
    fontSize: 13,
    color: COLORS.textTertiary,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});

// ============================================
// Export default
// ============================================

export default ConnectionGuard;
