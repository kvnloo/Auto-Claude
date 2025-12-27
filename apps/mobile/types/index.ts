/**
 * Type exports for the mobile companion app
 */

// Settings types
export type {
  ConnectionState,
  ConnectionErrorType,
  ConnectionError,
  ConnectionSettings,
  AppSettings,
  SettingsState,
} from './settings';

export {
  DEFAULT_CONNECTION_SETTINGS,
  DEFAULT_APP_SETTINGS,
  DEFAULT_SETTINGS_STATE,
  TAILSCALE_CGNAT,
  TAILSCALE_IP_PATTERN,
} from './settings';
