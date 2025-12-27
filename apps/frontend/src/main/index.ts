import { app, BrowserWindow, shell, nativeImage } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { setupIpcHandlers } from './ipc-setup';
import { AgentManager } from './agent';
import { TerminalManager } from './terminal-manager';
import { pythonEnvManager } from './python-env-manager';
import { fileWatcher } from './file-watcher';
import { getUsageMonitor } from './claude-profile/usage-monitor';
import { initializeUsageMonitorForwarding } from './ipc-handlers/terminal-handlers';
import { initializeAppUpdater } from './app-updater';
import { initializeApiServer, shutdownApiServer, isApiServerEnabled } from './api/startup';
import { discoverExistingBackend, cleanupPortFile } from './api/backend-discovery';
import { initializeClientMode, shutdownClientMode, isClientModeActive } from './api/client-mode';
import { DEFAULT_APP_SETTINGS } from '../shared/constants';
import { readSettingsFile } from './settings-utils';
import type { AppSettings } from '../shared/types';

/**
 * Track whether this instance is running in client mode (secondary instance)
 */
let isSecondaryInstance = false;

/**
 * Load app settings synchronously (for use during startup).
 * This is a simple merge with defaults - no migrations or auto-detection.
 */
function loadSettingsSync(): AppSettings {
  const savedSettings = readSettingsFile();
  return { ...DEFAULT_APP_SETTINGS, ...savedSettings } as AppSettings;
}

// Get icon path based on platform
function getIconPath(): string {
  // In dev mode, __dirname is out/main, so we go up to project root then into resources
  // In production, resources are in the app's resources folder
  const resourcesPath = is.dev
    ? join(__dirname, '../../resources')
    : join(process.resourcesPath);

  let iconName: string;
  if (process.platform === 'darwin') {
    // Use PNG in dev mode (works better), ICNS in production
    iconName = is.dev ? 'icon-256.png' : 'icon.icns';
  } else if (process.platform === 'win32') {
    iconName = 'icon.ico';
  } else {
    iconName = 'icon.png';
  }

  const iconPath = join(resourcesPath, iconName);
  return iconPath;
}

// Keep a global reference of the window object to prevent garbage collection
let mainWindow: BrowserWindow | null = null;
let agentManager: AgentManager | null = null;
let terminalManager: TerminalManager | null = null;

/**
 * Track whether shutdown cleanup has already run to prevent duplicate cleanup
 */
let shutdownCleanupComplete = false;

function createWindow(): void {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 10 },
    icon: getIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false // Prevent terminal lag when window loses focus
    }
  });

  // Show window when ready to avoid visual flash
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // Load the renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Open DevTools in development
  if (is.dev) {
    mainWindow.webContents.openDevTools({ mode: 'right' });
  }

  // Clean up on close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Set app name before ready (for dock tooltip on macOS in dev mode)
app.setName('Auto Claude');
if (process.platform === 'darwin') {
  // Force the name to appear in dock on macOS
  app.name = 'Auto Claude';
}

// Request single instance lock for multi-instance coordination
// The first instance will get the lock and act as the "primary" instance
// Subsequent instances will connect to the primary's backend instead of starting their own
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running with the lock
  // This instance will run in client mode and connect to the existing backend
  isSecondaryInstance = true;
  console.warn('[main] Secondary instance detected - will connect to existing backend');
} else {
  // We are the primary instance - handle second-instance events
  app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
    // Focus our window when another instance tries to start
    // This provides a better UX when the user tries to open a second window
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

/**
 * Initialize the primary instance (runs the backend)
 */
async function initializePrimaryInstance(): Promise<void> {
  console.warn('[main] Initializing as PRIMARY instance');

  // Initialize agent manager
  agentManager = new AgentManager();

  // Load settings and configure agent manager with Python and auto-claude paths
  try {
    const settingsPath = join(app.getPath('userData'), 'settings.json');
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));

      // Validate autoBuildPath before using it - must contain runners/spec_runner.py
      let validAutoBuildPath = settings.autoBuildPath;
      if (validAutoBuildPath) {
        const specRunnerPath = join(validAutoBuildPath, 'runners', 'spec_runner.py');
        if (!existsSync(specRunnerPath)) {
          console.warn('[main] Configured autoBuildPath is invalid (missing runners/spec_runner.py), will use auto-detection:', validAutoBuildPath);
          validAutoBuildPath = undefined; // Let auto-detection find the correct path
        }
      }

      if (settings.pythonPath || validAutoBuildPath) {
        console.warn('[main] Configuring AgentManager with settings:', {
          pythonPath: settings.pythonPath,
          autoBuildPath: validAutoBuildPath
        });
        agentManager.configure(settings.pythonPath, validAutoBuildPath);
      }
    }
  } catch (error) {
    console.warn('[main] Failed to load settings for agent configuration:', error);
  }

  // Initialize terminal manager
  terminalManager = new TerminalManager(() => mainWindow);

  // Setup IPC handlers (pass pythonEnvManager for Python path management)
  setupIpcHandlers(agentManager, terminalManager, () => mainWindow, pythonEnvManager);

  // Create window
  createWindow();

  // Initialize usage monitoring after window is created
  if (mainWindow) {
    // Setup event forwarding from usage monitor to renderer
    initializeUsageMonitorForwarding(mainWindow);

    // Start the usage monitor
    const usageMonitor = getUsageMonitor();
    usageMonitor.start();
    console.warn('[main] Usage monitor initialized and started');

    // Initialize API server (optional - only starts if API_KEY is set)
    if (isApiServerEnabled()) {
      try {
        const result = await initializeApiServer(agentManager, fileWatcher, {
          debug: process.env.DEBUG === 'true',
        });
        if (result.success && !result.skipped) {
          console.warn(`[main] API server started at ${result.address}`);
        } else if (result.skipped) {
          console.warn(`[main] API server skipped: ${result.skipReason}`);
        } else if (!result.success) {
          console.warn(`[main] API server failed to start: ${result.error}`);
        }
      } catch (error) {
        console.warn('[main] API server initialization failed:', error);
      }
    } else {
      console.warn('[main] API server disabled (API_KEY not set)');
    }

    // Log debug mode status
    const isDebugMode = process.env.DEBUG === 'true';
    if (isDebugMode) {
      console.warn('[main] ========================================');
      console.warn('[main] DEBUG MODE ENABLED (DEBUG=true)');
      console.warn('[main] ========================================');
    }

    // Initialize app auto-updater (only in production, or when DEBUG_UPDATER is set)
    const forceUpdater = process.env.DEBUG_UPDATER === 'true';
    if (app.isPackaged || forceUpdater) {
      // Load settings to get beta updates preference
      const settings = loadSettingsSync();
      const betaUpdates = settings.betaUpdates ?? false;

      initializeAppUpdater(mainWindow, betaUpdates);
      console.warn('[main] App auto-updater initialized');
      console.warn(`[main] Beta updates: ${betaUpdates ? 'enabled' : 'disabled'}`);
      if (forceUpdater && !app.isPackaged) {
        console.warn('[main] Updater forced in dev mode via DEBUG_UPDATER=true');
        console.warn('[main] Note: Updates won\'t actually work in dev mode');
      }
    } else {
      console.warn('[main] ========================================');
      console.warn('[main] App auto-updater DISABLED (development mode)');
      console.warn('[main] To test updater logging, set DEBUG_UPDATER=true');
      console.warn('[main] Note: Actual updates only work in packaged builds');
      console.warn('[main] ========================================');
    }
  }
}

/**
 * Initialize the secondary instance (connects to existing backend)
 */
async function initializeSecondaryInstance(): Promise<void> {
  console.warn('[main] Initializing as SECONDARY instance (client mode)');

  // Try to discover the existing backend
  const backendInfo = await discoverExistingBackend();

  if (!backendInfo) {
    // No backend found - this shouldn't happen if lock is held, but handle gracefully
    console.warn('[main] Could not discover existing backend - starting in limited mode');
    console.warn('[main] Tasks from other instances will not be visible');

    // Still initialize terminal manager for local operations
    terminalManager = new TerminalManager(() => mainWindow);

    // Setup IPC handlers without AgentManager (limited functionality)
    setupIpcHandlers(null, terminalManager, () => mainWindow, pythonEnvManager);

    // Create window
    createWindow();
    return;
  }

  console.warn(`[main] Discovered existing backend at ${backendInfo.address}`);

  // Initialize terminal manager (still useful for local operations)
  terminalManager = new TerminalManager(() => mainWindow);

  // Setup IPC handlers without AgentManager (secondary instance doesn't run agents)
  // Pass null for agentManager - agent operations will be proxied through the API
  setupIpcHandlers(null, terminalManager, () => mainWindow, pythonEnvManager);

  // Create window
  createWindow();

  // Initialize client mode after window is created
  if (mainWindow) {
    const result = initializeClientMode(backendInfo, {
      debug: process.env.DEBUG === 'true',
      getMainWindow: () => mainWindow,
    });

    if (result.success) {
      console.warn('[main] Client mode initialized - connected to primary backend');
    } else {
      console.warn(`[main] Client mode initialization failed: ${result.error}`);
    }

    // Log debug mode status
    const isDebugMode = process.env.DEBUG === 'true';
    if (isDebugMode) {
      console.warn('[main] ========================================');
      console.warn('[main] DEBUG MODE ENABLED (DEBUG=true)');
      console.warn('[main] Running as SECONDARY instance');
      console.warn('[main] ========================================');
    }

    // Initialize app auto-updater (only in production, or when DEBUG_UPDATER is set)
    const forceUpdater = process.env.DEBUG_UPDATER === 'true';
    if (app.isPackaged || forceUpdater) {
      // Load settings to get beta updates preference
      const settings = loadSettingsSync();
      const betaUpdates = settings.betaUpdates ?? false;

      initializeAppUpdater(mainWindow, betaUpdates);
      console.warn('[main] App auto-updater initialized');
    } else if (is.dev) {
      console.warn('[main] App auto-updater DISABLED (development mode)');
    }
  }
}

// Initialize the application
app.whenReady().then(async () => {
  // Set app user model id for Windows
  electronApp.setAppUserModelId('com.autoclaude.ui');

  // Set dock icon on macOS
  if (process.platform === 'darwin') {
    const iconPath = getIconPath();
    try {
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        app.dock?.setIcon(icon);
      }
    } catch (e) {
      console.warn('Could not set dock icon:', e);
    }
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // Initialize based on whether this is primary or secondary instance
  if (isSecondaryInstance) {
    await initializeSecondaryInstance();
  } else {
    await initializePrimaryInstance();
  }

  // macOS: re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Cleanup before quit
app.on('before-quit', async () => {
  // Cleanup depends on whether we're primary or secondary instance
  if (isSecondaryInstance) {
    console.warn('[main] Shutting down secondary instance');

    // Shutdown client mode WebSocket connection
    if (isClientModeActive()) {
      try {
        const result = shutdownClientMode();
        if (result.success) {
          console.warn(`[main] Client mode stopped (events received: ${result.eventsReceived}, uptime: ${result.uptimeMs}ms)`);
        } else {
          console.warn(`[main] Client mode shutdown error: ${result.error}`);
        }
      } catch (error) {
        console.warn('[main] Client mode shutdown failed:', error);
      }
    }
  } else {
    console.warn('[main] Shutting down primary instance');

    // Clean up port file early (before other shutdown operations that might fail)
    // This is idempotent and works with the signal handlers
    if (!shutdownCleanupComplete && isApiServerEnabled()) {
      try {
        cleanupPortFile();
        console.warn('[main] Port file cleaned up');
        shutdownCleanupComplete = true;
      } catch (error) {
        console.warn('[main] Port file cleanup failed:', error);
      }
    }

    // Stop usage monitor (primary instance only)
    const usageMonitor = getUsageMonitor();
    usageMonitor.stop();
    console.warn('[main] Usage monitor stopped');

    // Shutdown API server (if running) - port file cleanup is already done above
    try {
      const result = await shutdownApiServer();
      if (result.success) {
        console.warn('[main] API server stopped');
      } else if (result.error) {
        console.warn('[main] API server shutdown error:', result.error);
      }
    } catch (error) {
      console.warn('[main] API server shutdown failed:', error);
    }

    // Kill all running agent processes
    if (agentManager) {
      await agentManager.killAll();
    }
  }

  // Kill all terminal processes (both primary and secondary)
  if (terminalManager) {
    await terminalManager.killAll();
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

// ============================================
// Graceful Shutdown Hooks
// ============================================

/**
 * Perform emergency cleanup of the port file
 *
 * This is called from signal handlers to ensure the port file is cleaned up
 * even during forceful process termination. Only runs once to prevent race conditions.
 */
function performPortFileCleanup(): void {
  if (shutdownCleanupComplete) {
    return;
  }

  // Only clean up port file if we are the primary instance (we wrote it)
  if (!isSecondaryInstance && isApiServerEnabled()) {
    try {
      cleanupPortFile();
      console.warn('[main] Port file cleaned up during shutdown');
    } catch (error) {
      // Log but don't throw - we're in shutdown
      console.error('[main] Failed to clean up port file:', error);
    }
  }

  shutdownCleanupComplete = true;
}

/**
 * Handle SIGINT (Ctrl+C) - perform cleanup and exit gracefully
 */
process.on('SIGINT', () => {
  console.warn('[main] Received SIGINT signal');
  performPortFileCleanup();
  app.quit();
});

/**
 * Handle SIGTERM (process termination) - perform cleanup and exit gracefully
 */
process.on('SIGTERM', () => {
  console.warn('[main] Received SIGTERM signal');
  performPortFileCleanup();
  app.quit();
});
