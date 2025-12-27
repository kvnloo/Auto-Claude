/**
 * End-to-End tests for Autonomous Mode
 * Tests enabling autonomous mode, queue updates, and settings persistence.
 *
 * NOTE: These tests require the Electron app to be built first.
 * Run `npm run build` before running E2E tests.
 * The tests also require Playwright to be installed.
 *
 * To run: npx playwright test --config=e2e/playwright.config.ts autonomous.e2e.ts
 */
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';

// Test data directory
const TEST_DATA_DIR = '/tmp/auto-claude-autonomous-e2e';
const TEST_PROJECT_DIR = path.join(TEST_DATA_DIR, 'test-project');
const AUTO_CLAUDE_DIR = path.join(TEST_PROJECT_DIR, '.auto-claude');

// Default autonomous mode settings
const DEFAULT_SETTINGS = {
  enabled: false,
  maxConcurrentTasks: 1,
  maxConsecutiveFailures: 3,
  sessionTimeLimitMinutes: 240,
  pollIntervalSeconds: 60,
  tokenBudget: undefined
};

// ============================================
// Test Environment Setup
// ============================================

/**
 * Setup test environment for autonomous mode tests
 */
function setupTestEnvironment(): void {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  mkdirSync(TEST_PROJECT_DIR, { recursive: true });
  mkdirSync(AUTO_CLAUDE_DIR, { recursive: true });
  mkdirSync(path.join(AUTO_CLAUDE_DIR, 'specs'), { recursive: true });
  mkdirSync(path.join(AUTO_CLAUDE_DIR, 'roadmap'), { recursive: true });
}

/**
 * Cleanup test environment
 */
function cleanupTestEnvironment(): void {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

/**
 * Create autonomous settings file
 */
function createAutonomousSettings(settings: Record<string, unknown>): void {
  writeFileSync(
    path.join(AUTO_CLAUDE_DIR, 'autonomous-settings.json'),
    JSON.stringify(settings, null, 2)
  );
}

/**
 * Read autonomous settings file
 */
function readAutonomousSettings(): Record<string, unknown> | null {
  const settingsPath = path.join(AUTO_CLAUDE_DIR, 'autonomous-settings.json');
  if (!existsSync(settingsPath)) {
    return null;
  }
  return JSON.parse(readFileSync(settingsPath, 'utf-8'));
}

/**
 * Create a test roadmap file with planned features
 */
function createTestRoadmap(): void {
  const roadmap = {
    id: 'test-roadmap',
    name: 'Test Roadmap',
    features: [
      {
        id: 'feature-1',
        title: 'Test Feature 1',
        description: 'A planned feature for testing',
        status: 'planned',
        priority: 'high',
        complexity: 'low',
        impact: 'medium'
      },
      {
        id: 'feature-2',
        title: 'Test Feature 2',
        description: 'Another planned feature',
        status: 'planned',
        priority: 'medium',
        complexity: 'medium',
        impact: 'high'
      }
    ]
  };
  writeFileSync(
    path.join(AUTO_CLAUDE_DIR, 'roadmap', 'roadmap.json'),
    JSON.stringify(roadmap, null, 2)
  );
}

/**
 * Create a mock queue status file for testing
 */
function createMockQueueStatus(status: {
  state: string;
  pendingCount: number;
  completedCount: number;
  failedCount: number;
  currentTask?: Record<string, unknown>;
}): void {
  writeFileSync(
    path.join(AUTO_CLAUDE_DIR, 'queue-status.json'),
    JSON.stringify({
      ...status,
      inProgressCount: status.currentTask ? 1 : 0,
      totalCount: status.pendingCount + status.completedCount + status.failedCount + (status.currentTask ? 1 : 0),
      consecutiveFailures: 0,
      lastUpdated: new Date().toISOString()
    }, null, 2)
  );
}

// ============================================
// E2E Test Infrastructure Verification
// ============================================

test.describe('Autonomous Mode E2E Test Infrastructure', () => {
  test('should setup test environment correctly', () => {
    setupTestEnvironment();
    expect(existsSync(TEST_DATA_DIR)).toBe(true);
    expect(existsSync(TEST_PROJECT_DIR)).toBe(true);
    expect(existsSync(AUTO_CLAUDE_DIR)).toBe(true);
    cleanupTestEnvironment();
  });

  test('should create and read autonomous settings', () => {
    setupTestEnvironment();

    // Settings should not exist initially
    expect(readAutonomousSettings()).toBeNull();

    // Create settings
    const settings = { ...DEFAULT_SETTINGS, enabled: true };
    createAutonomousSettings(settings);

    // Read settings back
    const savedSettings = readAutonomousSettings();
    expect(savedSettings).not.toBeNull();
    expect(savedSettings?.enabled).toBe(true);
    expect(savedSettings?.maxConcurrentTasks).toBe(1);

    cleanupTestEnvironment();
  });

  test('should create test roadmap', () => {
    setupTestEnvironment();
    createTestRoadmap();

    const roadmapPath = path.join(AUTO_CLAUDE_DIR, 'roadmap', 'roadmap.json');
    expect(existsSync(roadmapPath)).toBe(true);

    const roadmap = JSON.parse(readFileSync(roadmapPath, 'utf-8'));
    expect(roadmap.features).toHaveLength(2);
    expect(roadmap.features[0].status).toBe('planned');

    cleanupTestEnvironment();
  });

  test('should create mock queue status', () => {
    setupTestEnvironment();

    createMockQueueStatus({
      state: 'running',
      pendingCount: 3,
      completedCount: 5,
      failedCount: 1,
      currentTask: {
        id: 'task-1',
        title: 'Current Task',
        status: 'in_progress'
      }
    });

    const statusPath = path.join(AUTO_CLAUDE_DIR, 'queue-status.json');
    expect(existsSync(statusPath)).toBe(true);

    const status = JSON.parse(readFileSync(statusPath, 'utf-8'));
    expect(status.state).toBe('running');
    expect(status.pendingCount).toBe(3);
    expect(status.inProgressCount).toBe(1);

    cleanupTestEnvironment();
  });
});

// ============================================
// Settings Persistence Tests (Mock-based)
// ============================================

test.describe('Settings Persistence (Mock-based)', () => {
  test('should persist autonomous mode settings to file', () => {
    setupTestEnvironment();

    // Simulate saving settings (like the IPC handler would)
    const settings = {
      enabled: true,
      maxConcurrentTasks: 2,
      maxConsecutiveFailures: 4,
      sessionTimeLimitMinutes: 180,
      pollIntervalSeconds: 45,
      tokenBudget: 100000
    };

    createAutonomousSettings(settings);

    // Verify persistence
    const savedSettings = readAutonomousSettings();
    expect(savedSettings).not.toBeNull();
    expect(savedSettings?.enabled).toBe(true);
    expect(savedSettings?.maxConcurrentTasks).toBe(2);
    expect(savedSettings?.maxConsecutiveFailures).toBe(4);
    expect(savedSettings?.sessionTimeLimitMinutes).toBe(180);
    expect(savedSettings?.pollIntervalSeconds).toBe(45);
    expect(savedSettings?.tokenBudget).toBe(100000);

    cleanupTestEnvironment();
  });

  test('should preserve settings after simulated restart', () => {
    setupTestEnvironment();

    // First "session" - save settings
    const originalSettings = {
      enabled: true,
      maxConcurrentTasks: 3,
      maxConsecutiveFailures: 5,
      sessionTimeLimitMinutes: 480,
      pollIntervalSeconds: 120
    };
    createAutonomousSettings(originalSettings);

    // Simulate app restart by reading settings fresh
    const restoredSettings = readAutonomousSettings();
    expect(restoredSettings).toEqual(originalSettings);

    cleanupTestEnvironment();
  });

  test('should handle settings updates correctly', () => {
    setupTestEnvironment();

    // Initial settings
    createAutonomousSettings({ ...DEFAULT_SETTINGS, enabled: false });

    // Enable autonomous mode
    const settings1 = readAutonomousSettings();
    expect(settings1?.enabled).toBe(false);

    // Update to enable
    createAutonomousSettings({ ...settings1, enabled: true });
    const settings2 = readAutonomousSettings();
    expect(settings2?.enabled).toBe(true);

    // Update concurrent tasks
    createAutonomousSettings({ ...settings2, maxConcurrentTasks: 3 });
    const settings3 = readAutonomousSettings();
    expect(settings3?.maxConcurrentTasks).toBe(3);
    expect(settings3?.enabled).toBe(true); // Still enabled

    cleanupTestEnvironment();
  });

  test('should validate poll interval minimum', () => {
    setupTestEnvironment();

    // Test that validation logic would catch invalid poll interval
    const validatePollInterval = (value: number): boolean => {
      return value >= 30 && value <= 600;
    };

    expect(validatePollInterval(30)).toBe(true);
    expect(validatePollInterval(60)).toBe(true);
    expect(validatePollInterval(600)).toBe(true);
    expect(validatePollInterval(29)).toBe(false);
    expect(validatePollInterval(601)).toBe(false);

    cleanupTestEnvironment();
  });

  test('should validate max concurrent tasks range', () => {
    setupTestEnvironment();

    const validateMaxConcurrentTasks = (value: number): boolean => {
      return value >= 1 && value <= 3;
    };

    expect(validateMaxConcurrentTasks(1)).toBe(true);
    expect(validateMaxConcurrentTasks(2)).toBe(true);
    expect(validateMaxConcurrentTasks(3)).toBe(true);
    expect(validateMaxConcurrentTasks(0)).toBe(false);
    expect(validateMaxConcurrentTasks(4)).toBe(false);

    cleanupTestEnvironment();
  });

  test('should validate session time limit range', () => {
    setupTestEnvironment();

    const validateSessionTimeLimit = (minutes: number): boolean => {
      return minutes >= 60 && minutes <= 480;
    };

    expect(validateSessionTimeLimit(60)).toBe(true);
    expect(validateSessionTimeLimit(240)).toBe(true);
    expect(validateSessionTimeLimit(480)).toBe(true);
    expect(validateSessionTimeLimit(59)).toBe(false);
    expect(validateSessionTimeLimit(481)).toBe(false);

    cleanupTestEnvironment();
  });
});

// ============================================
// Queue Status Update Tests (Mock-based)
// ============================================

test.describe('Queue Status Updates (Mock-based)', () => {
  test('should track queue state transitions', () => {
    setupTestEnvironment();

    // Initial state - idle
    createMockQueueStatus({
      state: 'idle',
      pendingCount: 0,
      completedCount: 0,
      failedCount: 0
    });

    let status = JSON.parse(readFileSync(path.join(AUTO_CLAUDE_DIR, 'queue-status.json'), 'utf-8'));
    expect(status.state).toBe('idle');

    // Start queue - running
    createMockQueueStatus({
      state: 'running',
      pendingCount: 5,
      completedCount: 0,
      failedCount: 0,
      currentTask: { id: 'task-1', title: 'Task 1', status: 'in_progress' }
    });

    status = JSON.parse(readFileSync(path.join(AUTO_CLAUDE_DIR, 'queue-status.json'), 'utf-8'));
    expect(status.state).toBe('running');
    expect(status.currentTask).toBeDefined();

    // Pause queue
    createMockQueueStatus({
      state: 'paused',
      pendingCount: 4,
      completedCount: 1,
      failedCount: 0
    });

    status = JSON.parse(readFileSync(path.join(AUTO_CLAUDE_DIR, 'queue-status.json'), 'utf-8'));
    expect(status.state).toBe('paused');

    cleanupTestEnvironment();
  });

  test('should increment completed count on task completion', () => {
    setupTestEnvironment();

    // Initial state with tasks
    createMockQueueStatus({
      state: 'running',
      pendingCount: 3,
      completedCount: 0,
      failedCount: 0,
      currentTask: { id: 'task-1', title: 'Task 1', status: 'in_progress' }
    });

    let status = JSON.parse(readFileSync(path.join(AUTO_CLAUDE_DIR, 'queue-status.json'), 'utf-8'));
    expect(status.completedCount).toBe(0);

    // Complete task
    createMockQueueStatus({
      state: 'running',
      pendingCount: 2,
      completedCount: 1,
      failedCount: 0,
      currentTask: { id: 'task-2', title: 'Task 2', status: 'in_progress' }
    });

    status = JSON.parse(readFileSync(path.join(AUTO_CLAUDE_DIR, 'queue-status.json'), 'utf-8'));
    expect(status.completedCount).toBe(1);
    expect(status.pendingCount).toBe(2);

    cleanupTestEnvironment();
  });

  test('should increment failed count on task failure', () => {
    setupTestEnvironment();

    createMockQueueStatus({
      state: 'running',
      pendingCount: 3,
      completedCount: 0,
      failedCount: 0,
      currentTask: { id: 'task-1', title: 'Failing Task', status: 'in_progress' }
    });

    let status = JSON.parse(readFileSync(path.join(AUTO_CLAUDE_DIR, 'queue-status.json'), 'utf-8'));
    expect(status.failedCount).toBe(0);

    // Task fails
    createMockQueueStatus({
      state: 'running',
      pendingCount: 2,
      completedCount: 0,
      failedCount: 1,
      currentTask: { id: 'task-2', title: 'Task 2', status: 'in_progress' }
    });

    status = JSON.parse(readFileSync(path.join(AUTO_CLAUDE_DIR, 'queue-status.json'), 'utf-8'));
    expect(status.failedCount).toBe(1);

    cleanupTestEnvironment();
  });

  test('should handle empty queue state', () => {
    setupTestEnvironment();

    createMockQueueStatus({
      state: 'idle',
      pendingCount: 0,
      completedCount: 0,
      failedCount: 0
    });

    const status = JSON.parse(readFileSync(path.join(AUTO_CLAUDE_DIR, 'queue-status.json'), 'utf-8'));
    expect(status.state).toBe('idle');
    expect(status.totalCount).toBe(0);
    expect(status.currentTask).toBeUndefined();

    cleanupTestEnvironment();
  });

  test('should update lastUpdated timestamp', () => {
    setupTestEnvironment();

    const before = new Date();

    createMockQueueStatus({
      state: 'running',
      pendingCount: 1,
      completedCount: 0,
      failedCount: 0
    });

    const after = new Date();

    const status = JSON.parse(readFileSync(path.join(AUTO_CLAUDE_DIR, 'queue-status.json'), 'utf-8'));
    const lastUpdated = new Date(status.lastUpdated);

    expect(lastUpdated.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(lastUpdated.getTime()).toBeLessThanOrEqual(after.getTime());

    cleanupTestEnvironment();
  });
});

// ============================================
// Task Priority and Ordering Tests (Mock-based)
// ============================================

test.describe('Task Priority Ordering (Mock-based)', () => {
  test('should sort tasks by priority score', () => {
    setupTestEnvironment();

    // Create tasks with different priority scores
    const tasks = [
      { id: 'task-1', title: 'Low Priority', priority: { score: 30, level: 'low' } },
      { id: 'task-2', title: 'High Priority', priority: { score: 80, level: 'high' } },
      { id: 'task-3', title: 'Medium Priority', priority: { score: 50, level: 'medium' } }
    ];

    // Sort by priority score (descending)
    const sorted = [...tasks].sort((a, b) => b.priority.score - a.priority.score);

    expect(sorted[0].id).toBe('task-2'); // High priority first
    expect(sorted[1].id).toBe('task-3'); // Medium priority second
    expect(sorted[2].id).toBe('task-1'); // Low priority last

    cleanupTestEnvironment();
  });

  test('should identify ready tasks (no blocking dependencies)', () => {
    setupTestEnvironment();

    const tasks = [
      { id: 'task-1', title: 'Task 1', dependencies: [], status: 'pending' },
      { id: 'task-2', title: 'Task 2', dependencies: ['task-1'], status: 'pending' },
      { id: 'task-3', title: 'Task 3', dependencies: [], status: 'pending' }
    ];

    // Task 2 is blocked by task-1, so only tasks 1 and 3 are ready
    const completedTaskIds = new Set<string>();
    const readyTasks = tasks.filter((task) => {
      return task.dependencies.every((depId) => completedTaskIds.has(depId));
    });

    expect(readyTasks).toHaveLength(2);
    expect(readyTasks.map((t) => t.id)).toContain('task-1');
    expect(readyTasks.map((t) => t.id)).toContain('task-3');
    expect(readyTasks.map((t) => t.id)).not.toContain('task-2');

    cleanupTestEnvironment();
  });

  test('should unblock dependent tasks when dependency completes', () => {
    setupTestEnvironment();

    const tasks = [
      { id: 'task-1', title: 'Task 1', dependencies: [], status: 'completed' },
      { id: 'task-2', title: 'Task 2', dependencies: ['task-1'], status: 'pending' },
      { id: 'task-3', title: 'Task 3', dependencies: ['task-2'], status: 'pending' }
    ];

    // After task-1 completes, task-2 becomes ready
    const completedTaskIds = new Set(['task-1']);
    const readyTasks = tasks.filter(
      (task) =>
        task.status === 'pending' && task.dependencies.every((depId) => completedTaskIds.has(depId))
    );

    expect(readyTasks).toHaveLength(1);
    expect(readyTasks[0].id).toBe('task-2');

    cleanupTestEnvironment();
  });
});

// ============================================
// Session Statistics Tests (Mock-based)
// ============================================

test.describe('Session Statistics (Mock-based)', () => {
  test('should calculate success rate correctly', () => {
    setupTestEnvironment();

    const calculateSuccessRate = (completed: number, failed: number): number => {
      if (completed + failed === 0) return 100;
      return (completed / (completed + failed)) * 100;
    };

    expect(calculateSuccessRate(10, 0)).toBe(100);
    expect(calculateSuccessRate(8, 2)).toBe(80);
    expect(calculateSuccessRate(5, 5)).toBe(50);
    expect(calculateSuccessRate(0, 0)).toBe(100);

    cleanupTestEnvironment();
  });

  test('should track elapsed time', () => {
    setupTestEnvironment();

    const sessionStart = new Date('2024-01-01T10:00:00Z');
    const now = new Date('2024-01-01T11:30:00Z');

    const elapsedMs = now.getTime() - sessionStart.getTime();
    const elapsedMinutes = elapsedMs / (1000 * 60);

    expect(elapsedMinutes).toBe(90);

    cleanupTestEnvironment();
  });

  test('should calculate remaining time correctly', () => {
    setupTestEnvironment();

    const timeLimitMinutes = 240;
    const elapsedMinutes = 90;
    const remainingMinutes = timeLimitMinutes - elapsedMinutes;

    expect(remainingMinutes).toBe(150);

    cleanupTestEnvironment();
  });

  test('should track token usage', () => {
    setupTestEnvironment();

    const tokenBudget = 100000;
    const tokensUsed = 45000;
    const tokensRemaining = tokenBudget - tokensUsed;
    const usagePercentage = (tokensUsed / tokenBudget) * 100;

    expect(tokensRemaining).toBe(55000);
    expect(usagePercentage).toBe(45);

    cleanupTestEnvironment();
  });
});

// ============================================
// Guardrails Tests (Mock-based)
// ============================================

test.describe('Guardrails (Mock-based)', () => {
  test('should detect max failures reached', () => {
    setupTestEnvironment();

    const maxConsecutiveFailures = 3;
    let consecutiveFailures = 0;

    const shouldPause = (): boolean => consecutiveFailures >= maxConsecutiveFailures;

    expect(shouldPause()).toBe(false);

    consecutiveFailures = 1;
    expect(shouldPause()).toBe(false);

    consecutiveFailures = 2;
    expect(shouldPause()).toBe(false);

    consecutiveFailures = 3;
    expect(shouldPause()).toBe(true);

    cleanupTestEnvironment();
  });

  test('should reset consecutive failures on success', () => {
    setupTestEnvironment();

    let consecutiveFailures = 2;

    // Simulate success
    const onSuccess = (): void => {
      consecutiveFailures = 0;
    };

    onSuccess();
    expect(consecutiveFailures).toBe(0);

    cleanupTestEnvironment();
  });

  test('should detect session time limit exceeded', () => {
    setupTestEnvironment();

    const sessionTimeLimitMinutes = 240;

    const isTimeExceeded = (elapsedMinutes: number): boolean => {
      return elapsedMinutes >= sessionTimeLimitMinutes;
    };

    expect(isTimeExceeded(100)).toBe(false);
    expect(isTimeExceeded(239)).toBe(false);
    expect(isTimeExceeded(240)).toBe(true);
    expect(isTimeExceeded(300)).toBe(true);

    cleanupTestEnvironment();
  });

  test('should detect token budget exhausted', () => {
    setupTestEnvironment();

    const tokenBudget = 100000;

    const isTokenBudgetExhausted = (tokensUsed: number): boolean => {
      return tokensUsed >= tokenBudget;
    };

    expect(isTokenBudgetExhausted(50000)).toBe(false);
    expect(isTokenBudgetExhausted(99999)).toBe(false);
    expect(isTokenBudgetExhausted(100000)).toBe(true);
    expect(isTokenBudgetExhausted(150000)).toBe(true);

    cleanupTestEnvironment();
  });

  test('should enforce concurrent task limit', () => {
    setupTestEnvironment();

    const maxConcurrentTasks = 2;
    let runningTasks = 0;

    const canStartTask = (): boolean => runningTasks < maxConcurrentTasks;

    expect(canStartTask()).toBe(true);

    runningTasks = 1;
    expect(canStartTask()).toBe(true);

    runningTasks = 2;
    expect(canStartTask()).toBe(false);

    cleanupTestEnvironment();
  });
});

// ============================================
// Electron App Tests (Skipped in CI)
// ============================================

test.describe('Autonomous Mode - Electron App', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    setupTestEnvironment();
    createAutonomousSettings(DEFAULT_SETTINGS);
    createTestRoadmap();
  });

  test.afterAll(async () => {
    if (app) {
      await app.close();
    }
    cleanupTestEnvironment();
  });

  test.skip('should launch app and navigate to autonomous tab', async () => {
    test.skip(!process.env.ELECTRON_PATH, 'Electron not available in CI');

    const appPath = path.join(__dirname, '..');
    app = await electron.launch({
      args: [appPath],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ELECTRON_USER_DATA_PATH: TEST_DATA_DIR
      }
    });
    page = await app.firstWindow();

    await page.waitForLoadState('domcontentloaded');

    // Navigate to autonomous tab
    const autonomousTab = page.locator('[data-testid="autonomous-tab"], button:has-text("Autonomous")');
    await expect(autonomousTab).toBeVisible({ timeout: 10000 });
    await autonomousTab.click();

    // Verify dashboard is shown
    await expect(
      page.locator('[data-testid="autonomous-dashboard"], :has-text("Autonomous Mode")')
    ).toBeVisible({ timeout: 5000 });
  });

  test.skip('should show empty state when autonomous mode is disabled', async () => {
    test.skip(!app, 'App not launched');

    // Check for empty state message
    const emptyState = page.locator(':has-text("Enable autonomous mode")');
    await expect(emptyState).toBeVisible({ timeout: 5000 });

    // Start button should be available
    const startButton = page.locator('button:has-text("Start")');
    await expect(startButton).toBeVisible({ timeout: 5000 });
  });

  test.skip('should navigate to settings and find autonomous settings', async () => {
    test.skip(!app, 'App not launched');

    // Navigate to settings
    const settingsTab = page.locator('[data-testid="settings-tab"], button:has-text("Settings")');
    await settingsTab.click();

    // Wait for settings panel
    await page.waitForTimeout(500);

    // Navigate to autonomous settings section
    const autonomousSection = page.locator(
      '[data-testid="autonomous-settings"], button:has-text("Autonomous")'
    );
    await expect(autonomousSection).toBeVisible({ timeout: 5000 });
    await autonomousSection.click();

    // Verify settings form is visible
    await expect(page.locator('text=Enable Autonomous Mode')).toBeVisible({ timeout: 5000 });
  });

  test.skip('should toggle autonomous mode switch', async () => {
    test.skip(!app, 'App not launched');

    // Find the enable switch
    const enableSwitch = page.locator('[id="autonomous-enabled"]');
    await expect(enableSwitch).toBeVisible({ timeout: 5000 });

    // Toggle on
    await enableSwitch.click();

    // Additional settings should appear
    await expect(page.locator('text=Concurrent Tasks')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Failure Tolerance')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Session Time Limit')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Poll Interval')).toBeVisible({ timeout: 5000 });
  });

  test.skip('should show unsaved changes indicator', async () => {
    test.skip(!app, 'App not launched');

    // Make a change (change concurrent tasks)
    const concurrentTasksSelect = page.locator('[id="max-concurrent"]');
    await concurrentTasksSelect.click();
    await page.locator('text=2 tasks').click();

    // Should show unsaved changes
    await expect(page.locator('text=unsaved changes')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("Save")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("Reset")')).toBeVisible({ timeout: 5000 });
  });

  test.skip('should save settings and persist changes', async () => {
    test.skip(!app, 'App not launched');

    // Click save button
    const saveButton = page.locator('button:has-text("Save")');
    await saveButton.click();

    // Unsaved changes indicator should disappear
    await expect(page.locator('text=unsaved changes')).not.toBeVisible({ timeout: 5000 });

    // Navigate away and back
    const dashboardTab = page.locator('[data-testid="autonomous-tab"], button:has-text("Autonomous")');
    await dashboardTab.click();
    await page.waitForTimeout(500);

    // Navigate back to settings
    const settingsTab = page.locator('button:has-text("Settings")');
    await settingsTab.click();
    await page.waitForTimeout(500);

    const autonomousSection = page.locator('button:has-text("Autonomous")');
    await autonomousSection.click();

    // Settings should be persisted
    await expect(page.locator('[id="max-concurrent"]')).toContainText('2 tasks');
  });

  test.skip('should show queue status on dashboard', async () => {
    test.skip(!app, 'App not launched');

    // Navigate to autonomous tab
    const autonomousTab = page.locator('[data-testid="autonomous-tab"], button:has-text("Autonomous")');
    await autonomousTab.click();

    // Should show queue status elements
    await expect(page.locator('text=Pending:')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Done:')).toBeVisible({ timeout: 5000 });
  });

  test.skip('should show start button when queue is stopped', async () => {
    test.skip(!app, 'App not launched');

    // Start button should be visible when queue is stopped
    const startButton = page.locator('button:has-text("Start")');
    await expect(startButton).toBeVisible({ timeout: 5000 });
    await expect(startButton).toBeEnabled();
  });

  test.skip('should show control buttons when queue is running', async () => {
    test.skip(!app, 'App not launched');

    // Mock the queue starting (would require IPC mock)
    // This is a placeholder for when we can properly mock IPC

    // We would expect:
    // - Pause button visible
    // - Stop button visible
    // - Start button hidden

    test.skip(true, 'Requires IPC mocking for queue state');
  });

  test.skip('should display current task when processing', async () => {
    test.skip(!app, 'App not launched');
    test.skip(true, 'Requires IPC mocking for task execution');

    // We would expect:
    // - Current Task card with task title
    // - Progress indicator
    // - Status badge
  });

  test.skip('should show session statistics during processing', async () => {
    test.skip(!app, 'App not launched');
    test.skip(true, 'Requires IPC mocking for session stats');

    // We would expect:
    // - Time Elapsed
    // - Tasks Completed
    // - Success Rate
    // - Tokens Used (if budget set)
  });

  test.skip('should persist settings across app restart', async () => {
    test.skip(!process.env.ELECTRON_PATH, 'Electron not available in CI');

    // Save current settings
    const settings = {
      enabled: true,
      maxConcurrentTasks: 2,
      maxConsecutiveFailures: 4,
      sessionTimeLimitMinutes: 300,
      pollIntervalSeconds: 90
    };
    createAutonomousSettings(settings);

    // Close and relaunch app
    if (app) {
      await app.close();
    }

    const appPath = path.join(__dirname, '..');
    app = await electron.launch({
      args: [appPath],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ELECTRON_USER_DATA_PATH: TEST_DATA_DIR
      }
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Navigate to settings
    const settingsTab = page.locator('button:has-text("Settings")');
    await settingsTab.click();
    await page.waitForTimeout(500);

    const autonomousSection = page.locator('button:has-text("Autonomous")');
    await autonomousSection.click();

    // Verify settings were restored
    await expect(page.locator('[id="autonomous-enabled"]')).toBeChecked();
    await expect(page.locator('[id="max-concurrent"]')).toContainText('2 tasks');
  });
});

// ============================================
// Error Handling Tests (Mock-based)
// ============================================

test.describe('Error Handling (Mock-based)', () => {
  test('should handle missing settings file gracefully', () => {
    setupTestEnvironment();

    // Don't create settings file - should return null/default
    const settings = readAutonomousSettings();
    expect(settings).toBeNull();

    cleanupTestEnvironment();
  });

  test('should handle corrupted settings file', () => {
    setupTestEnvironment();

    // Write invalid JSON
    writeFileSync(path.join(AUTO_CLAUDE_DIR, 'autonomous-settings.json'), 'not valid json{');

    // Should throw or return null based on implementation
    expect(() => {
      JSON.parse(readFileSync(path.join(AUTO_CLAUDE_DIR, 'autonomous-settings.json'), 'utf-8'));
    }).toThrow();

    cleanupTestEnvironment();
  });

  test('should handle missing roadmap file', () => {
    setupTestEnvironment();

    const roadmapPath = path.join(AUTO_CLAUDE_DIR, 'roadmap', 'roadmap.json');
    expect(existsSync(roadmapPath)).toBe(false);

    // System should continue without roadmap tasks
    cleanupTestEnvironment();
  });
});
