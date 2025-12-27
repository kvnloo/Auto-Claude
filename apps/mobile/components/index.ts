/**
 * Components module exports for the mobile companion app
 */

// Connection UI components
export {
  ConnectionGuard,
  type ConnectionGuardProps,
  type OverlayRenderProps,
} from './ConnectionGuard';

export {
  ReconnectBanner,
  CompactReconnectBanner,
  type ReconnectBannerProps,
  type CompactReconnectBannerProps,
  type BannerRenderProps,
} from './ReconnectBanner';

export {
  ConnectionStatus,
  StatusDot,
  StatusBadge,
  type ConnectionStatusProps,
  type ConnectionStatusVariant,
  type ConnectionStatusSize,
} from './ConnectionStatus';
