/**
 * ConnectionStatus Component
 *
 * A visual indicator component that displays the current Tailscale
 * connection state with appropriate icons and colors.
 *
 * Supports multiple display variants:
 * - dot: Simple colored dot indicator
 * - badge: Pill-shaped badge with text
 * - icon: Icon with optional label
 *
 * @see spec.md - Requirement 5: Connection State UI
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  type ViewStyle,
  type TextStyle,
} from 'react-native';

import {
  useTailscaleConnection,
  type UseTailscaleConnectionOptions,
} from '../hooks/useTailscaleConnection';
import type { ConnectionState } from '../types/settings';

// ============================================
// Types
// ============================================

/**
 * Display variant for the connection status indicator
 */
export type ConnectionStatusVariant = 'dot' | 'badge' | 'icon';

/**
 * Size options for the connection status indicator
 */
export type ConnectionStatusSize = 'small' | 'medium' | 'large';

/**
 * Props for the ConnectionStatus component
 */
export interface ConnectionStatusProps {
  /**
   * Display variant
   * @default 'dot'
   */
  variant?: ConnectionStatusVariant;

  /**
   * Size of the indicator
   * @default 'medium'
   */
  size?: ConnectionStatusSize;

  /**
   * Whether to show the status label text
   * Only applies to 'badge' and 'icon' variants
   * @default true for badge/icon, false for dot
   */
  showLabel?: boolean;

  /**
   * Whether to show a pulsing animation when connecting
   * @default true
   */
  showPulse?: boolean;

  /**
   * Override connection state (for testing or external control)
   * If not provided, uses useTailscaleConnection hook
   */
  state?: ConnectionState;

  /**
   * Options to pass to useTailscaleConnection hook
   * Only used if state prop is not provided
   */
  connectionOptions?: UseTailscaleConnectionOptions;

  /**
   * Style to apply to the container
   */
  style?: ViewStyle;

  /**
   * Style to apply to the label text
   */
  labelStyle?: TextStyle;

  /**
   * Custom labels for each state
   */
  labels?: Partial<Record<ConnectionState, string>>;

  /**
   * Whether this component manages its own connection (auto-connect)
   * When false, only displays status without triggering connection
   * @default false
   */
  manageConnection?: boolean;
}

// ============================================
// Constants
// ============================================

/**
 * Default labels for each connection state
 */
const DEFAULT_LABELS: Record<ConnectionState, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  disconnected: 'Disconnected',
  error: 'Error',
};

/**
 * Size configuration for each size option
 */
const SIZE_CONFIG: Record<ConnectionStatusSize, {
  dot: number;
  icon: number;
  fontSize: number;
  padding: { horizontal: number; vertical: number };
  spinnerSize: 'small' | 'large';
}> = {
  small: {
    dot: 8,
    icon: 14,
    fontSize: 11,
    padding: { horizontal: 6, vertical: 2 },
    spinnerSize: 'small',
  },
  medium: {
    dot: 12,
    icon: 18,
    fontSize: 13,
    padding: { horizontal: 10, vertical: 4 },
    spinnerSize: 'small',
  },
  large: {
    dot: 16,
    icon: 24,
    fontSize: 15,
    padding: { horizontal: 14, vertical: 6 },
    spinnerSize: 'small',
  },
};

// ============================================
// Color Configuration
// ============================================

/**
 * Color configuration for each connection state
 */
interface StateColors {
  primary: string;      // Main indicator color
  background: string;   // Background (for badge)
  text: string;         // Text color
  border: string;       // Border color (for badge)
}

const STATE_COLORS: Record<ConnectionState, StateColors> = {
  connected: {
    primary: '#10B981',     // Emerald-500
    background: '#ECFDF5',  // Emerald-50
    text: '#065F46',        // Emerald-800
    border: '#A7F3D0',      // Emerald-200
  },
  connecting: {
    primary: '#F59E0B',     // Amber-500
    background: '#FFFBEB',  // Amber-50
    text: '#92400E',        // Amber-800
    border: '#FDE68A',      // Amber-200
  },
  disconnected: {
    primary: '#6B7280',     // Gray-500
    background: '#F9FAFB',  // Gray-50
    text: '#374151',        // Gray-700
    border: '#E5E7EB',      // Gray-200
  },
  error: {
    primary: '#EF4444',     // Red-500
    background: '#FEF2F2',  // Red-50
    text: '#991B1B',        // Red-800
    border: '#FECACA',      // Red-200
  },
};

// ============================================
// Icon Representations
// ============================================

/**
 * Get text icon for each state
 */
function getStateIcon(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return '●';  // Filled circle
    case 'connecting':
      return '◐';  // Half-filled circle (spinning will be shown instead)
    case 'disconnected':
      return '○';  // Empty circle
    case 'error':
      return '!';  // Exclamation
    default:
      return '?';
  }
}

// ============================================
// Sub-Components
// ============================================

/**
 * Dot variant - simple colored dot indicator
 */
interface DotIndicatorProps {
  state: ConnectionState;
  size: ConnectionStatusSize;
  showPulse: boolean;
}

function DotIndicator({ state, size, showPulse }: DotIndicatorProps): JSX.Element {
  const sizeConfig = SIZE_CONFIG[size];
  const colors = STATE_COLORS[state];
  const isConnecting = state === 'connecting';

  return (
    <View style={styles.dotContainer}>
      {isConnecting ? (
        <ActivityIndicator
          size={sizeConfig.spinnerSize}
          color={colors.primary}
          accessibilityLabel="Connecting"
        />
      ) : (
        <View
          style={[
            styles.dot,
            {
              width: sizeConfig.dot,
              height: sizeConfig.dot,
              borderRadius: sizeConfig.dot / 2,
              backgroundColor: colors.primary,
            },
            showPulse && state === 'error' && styles.errorPulse,
          ]}
        />
      )}
    </View>
  );
}

/**
 * Badge variant - pill-shaped badge with text
 */
interface BadgeIndicatorProps {
  state: ConnectionState;
  size: ConnectionStatusSize;
  label: string;
  showPulse: boolean;
}

function BadgeIndicator({ state, size, label, showPulse }: BadgeIndicatorProps): JSX.Element {
  const sizeConfig = SIZE_CONFIG[size];
  const colors = STATE_COLORS[state];
  const isConnecting = state === 'connecting';

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: colors.background,
          borderColor: colors.border,
          paddingHorizontal: sizeConfig.padding.horizontal,
          paddingVertical: sizeConfig.padding.vertical,
        },
      ]}
    >
      {/* Indicator dot or spinner */}
      {isConnecting ? (
        <ActivityIndicator
          size={sizeConfig.spinnerSize}
          color={colors.primary}
          style={styles.badgeSpinner}
        />
      ) : (
        <View
          style={[
            styles.badgeDot,
            {
              width: sizeConfig.dot * 0.6,
              height: sizeConfig.dot * 0.6,
              borderRadius: (sizeConfig.dot * 0.6) / 2,
              backgroundColor: colors.primary,
            },
          ]}
        />
      )}

      {/* Label */}
      <Text
        style={[
          styles.badgeLabel,
          {
            color: colors.text,
            fontSize: sizeConfig.fontSize,
          },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * Icon variant - icon with optional label
 */
interface IconIndicatorProps {
  state: ConnectionState;
  size: ConnectionStatusSize;
  label?: string;
  showPulse: boolean;
}

function IconIndicator({ state, size, label, showPulse }: IconIndicatorProps): JSX.Element {
  const sizeConfig = SIZE_CONFIG[size];
  const colors = STATE_COLORS[state];
  const isConnecting = state === 'connecting';
  const icon = getStateIcon(state);

  return (
    <View style={styles.iconContainer}>
      {/* Icon or spinner */}
      <View style={styles.iconWrapper}>
        {isConnecting ? (
          <ActivityIndicator
            size={sizeConfig.spinnerSize}
            color={colors.primary}
          />
        ) : (
          <Text
            style={[
              styles.iconText,
              {
                color: colors.primary,
                fontSize: sizeConfig.icon,
              },
            ]}
          >
            {icon}
          </Text>
        )}
      </View>

      {/* Optional label */}
      {label !== undefined && (
        <Text
          style={[
            styles.iconLabel,
            {
              color: colors.text,
              fontSize: sizeConfig.fontSize,
            },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </View>
  );
}

// ============================================
// Main Component
// ============================================

/**
 * ConnectionStatus displays a visual indicator of the current
 * Tailscale connection state with appropriate colors and icons.
 *
 * @example
 * ```tsx
 * // Simple dot indicator
 * <ConnectionStatus />
 *
 * // Badge with label
 * <ConnectionStatus variant="badge" />
 *
 * // Icon variant, large size
 * <ConnectionStatus variant="icon" size="large" />
 *
 * // With custom labels
 * <ConnectionStatus
 *   variant="badge"
 *   labels={{
 *     connected: 'Online',
 *     disconnected: 'Offline',
 *   }}
 * />
 *
 * // Externally controlled state
 * <ConnectionStatus state="connected" variant="dot" />
 * ```
 */
export function ConnectionStatus({
  variant = 'dot',
  size = 'medium',
  showLabel,
  showPulse = true,
  state: externalState,
  connectionOptions,
  style,
  labelStyle,
  labels = {},
  manageConnection = false,
}: ConnectionStatusProps): JSX.Element {
  // Get connection state from hook if not provided externally
  const hookResult = useTailscaleConnection({
    ...connectionOptions,
    autoConnect: manageConnection && connectionOptions?.autoConnect,
  });

  // Use external state if provided, otherwise use hook state
  const connectionState = externalState ?? hookResult.state;

  // Merge custom labels with defaults
  const mergedLabels = { ...DEFAULT_LABELS, ...labels };
  const label = mergedLabels[connectionState];

  // Determine if label should be shown based on variant
  const shouldShowLabel = showLabel ?? (variant !== 'dot');

  // Get accessibility label
  const accessibilityLabel = `Connection status: ${label}`;

  // Render based on variant
  const renderIndicator = (): JSX.Element => {
    switch (variant) {
      case 'badge':
        return (
          <BadgeIndicator
            state={connectionState}
            size={size}
            label={label}
            showPulse={showPulse}
          />
        );
      case 'icon':
        return (
          <IconIndicator
            state={connectionState}
            size={size}
            label={shouldShowLabel ? label : undefined}
            showPulse={showPulse}
          />
        );
      case 'dot':
      default:
        return (
          <>
            <DotIndicator
              state={connectionState}
              size={size}
              showPulse={showPulse}
            />
            {shouldShowLabel && (
              <Text
                style={[
                  styles.dotLabel,
                  {
                    color: STATE_COLORS[connectionState].text,
                    fontSize: SIZE_CONFIG[size].fontSize,
                  },
                  labelStyle,
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
            )}
          </>
        );
    }
  };

  return (
    <View
      style={[
        styles.container,
        variant === 'dot' && shouldShowLabel && styles.dotWithLabel,
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
    >
      {renderIndicator()}
    </View>
  );
}

// ============================================
// Convenience Components
// ============================================

/**
 * Simple dot status indicator (connected/disconnected)
 */
export function StatusDot({
  state,
  size = 'small',
  style,
}: {
  state?: ConnectionState;
  size?: ConnectionStatusSize;
  style?: ViewStyle;
}): JSX.Element {
  return (
    <ConnectionStatus
      variant="dot"
      size={size}
      showLabel={false}
      state={state}
      style={style}
    />
  );
}

/**
 * Status badge with label
 */
export function StatusBadge({
  state,
  size = 'medium',
  style,
  labels,
}: {
  state?: ConnectionState;
  size?: ConnectionStatusSize;
  style?: ViewStyle;
  labels?: Partial<Record<ConnectionState, string>>;
}): JSX.Element {
  return (
    <ConnectionStatus
      variant="badge"
      size={size}
      state={state}
      style={style}
      labels={labels}
    />
  );
}

// ============================================
// Styles
// ============================================

interface Styles {
  container: ViewStyle;
  dotContainer: ViewStyle;
  dotWithLabel: ViewStyle;
  dot: ViewStyle;
  dotLabel: TextStyle;
  errorPulse: ViewStyle;
  badge: ViewStyle;
  badgeDot: ViewStyle;
  badgeSpinner: ViewStyle;
  badgeLabel: TextStyle;
  iconContainer: ViewStyle;
  iconWrapper: ViewStyle;
  iconText: TextStyle;
  iconLabel: TextStyle;
}

const styles = StyleSheet.create<Styles>({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dotContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  dotWithLabel: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    // Size and color set dynamically
  },
  dotLabel: {
    marginLeft: 6,
    fontWeight: '500',
  },
  errorPulse: {
    // Future: Add animated pulse for error state
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999, // Pill shape
    borderWidth: 1,
  },
  badgeDot: {
    marginRight: 6,
  },
  badgeSpinner: {
    marginRight: 6,
  },
  badgeLabel: {
    fontWeight: '500',
  },
  iconContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 24,
    minHeight: 24,
  },
  iconText: {
    fontWeight: '600',
    textAlign: 'center',
  },
  iconLabel: {
    marginLeft: 6,
    fontWeight: '500',
  },
});

// ============================================
// Export default
// ============================================

export default ConnectionStatus;
