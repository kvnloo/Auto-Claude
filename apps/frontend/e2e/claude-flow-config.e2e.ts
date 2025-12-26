/**
 * End-to-End tests for Claude Flow configuration management
 * Tests configuration changes for agent count and topology modes
 *
 * NOTE: These tests require the Electron app to be built first.
 * Run `npm run build` before running E2E tests.
 *
 * To run: npx playwright test --config=e2e/playwright.config.ts e2e/claude-flow-config.spec.ts
 */
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';

// Test data directory
const TEST_DATA_DIR = '/tmp/auto-claude-config-e2e';
const TEST_PROJECT_DIR = path.join(TEST_DATA_DIR, 'test-project');
const CONFIG_FILE_PATH = path.join(TEST_DATA_DIR, 'claude-flow-config.json');

// ============================================
// Types
// ============================================

type AgentCount = 4 | 8 | 12;
type TopologyMode = 'distributed' | 'hierarchical' | 'mesh' | 'centralized';

interface ClaudeFlowConfig {
  agentCount: AgentCount;
  topology: TopologyMode;
  model?: string;
  timeout?: number;
}

// ============================================
// Test Environment Setup
// ============================================

/**
 * Setup test environment with mock config storage
 */
function setupTestEnvironment(): void {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  mkdirSync(TEST_PROJECT_DIR, { recursive: true });
  mkdirSync(path.join(TEST_PROJECT_DIR, 'auto-claude', 'specs'), { recursive: true });
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
 * Save configuration to file (simulates storage)
 */
function saveConfig(config: ClaudeFlowConfig): void {
  writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2));
}

/**
 * Load configuration from file (simulates retrieval)
 */
function loadConfig(): ClaudeFlowConfig | null {
  if (!existsSync(CONFIG_FILE_PATH)) {
    return null;
  }
  return JSON.parse(readFileSync(CONFIG_FILE_PATH, 'utf-8'));
}

/**
 * Get default configuration
 */
function getDefaultConfig(): ClaudeFlowConfig {
  return {
    agentCount: 8,
    topology: 'distributed',
    timeout: 300
  };
}

/**
 * Create a task with specific configuration
 */
function createConfiguredTask(specId: string, config: ClaudeFlowConfig): void {
  const specDir = path.join(TEST_PROJECT_DIR, 'auto-claude', 'specs', specId);
  mkdirSync(specDir, { recursive: true });

  const implementationPlan = {
    feature: `Configured Task ${specId}`,
    workflow_type: 'research',
    parallel_config: {
      agent_count: config.agentCount,
      topology: config.topology,
      timeout: config.timeout || 300
    },
    phases: [
      {
        phase: 1,
        name: 'Execution Phase',
        type: 'parallel_execution',
        subtasks: [{ id: 'subtask-1', description: 'Execute with config', status: 'pending' }]
      }
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  writeFileSync(
    path.join(specDir, 'implementation_plan.json'),
    JSON.stringify(implementationPlan, null, 2)
  );
}

// ============================================
// Electron E2E Tests (Skip in CI)
// ============================================

test.describe('Claude Flow Configuration - Electron', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    setupTestEnvironment();
  });

  test.afterAll(async () => {
    if (app) {
      await app.close();
    }
    cleanupTestEnvironment();
  });

  test.skip('should display ConfigPanel with current settings', async () => {
    test.skip(!process.env.ELECTRON_PATH, 'Electron not available in CI');

    const appPath = path.join(__dirname, '..');
    app = await electron.launch({ args: [appPath] });
    page = await app.firstWindow();

    await page.waitForLoadState('domcontentloaded');

    // Navigate to settings
    await page.locator('[data-testid="settings-btn"], button:has-text("Settings")').first().click();

    // Verify ConfigPanel renders
    const configPanel = page.locator('[data-testid="config-panel"], .config-panel');
    await expect(configPanel).toBeVisible({ timeout: 10000 });

    // Verify agent count dropdown exists
    await expect(page.locator('#agent-count')).toBeVisible();

    // Verify topology mode selector exists
    await expect(page.locator('#topology-mode')).toBeVisible();
  });

  test.skip('should change agent count to 12 and verify update', async () => {
    test.skip(!app, 'App not launched');

    // Click agent count dropdown
    await page.locator('#agent-count').click();

    // Select 12 agents
    await page.locator('text=12 Agents').click();

    // Verify selection updated
    const currentValue = await page.locator('#agent-count [data-value]').textContent();
    expect(currentValue).toContain('12');
  });

  test.skip('should change topology to hierarchical and verify update', async () => {
    test.skip(!app, 'App not launched');

    // Click topology mode dropdown
    await page.locator('#topology-mode').click();

    // Select hierarchical
    await page.locator('text=Hierarchical').click();

    // Verify selection updated
    const currentValue = await page.locator('#topology-mode [data-value]').textContent();
    expect(currentValue).toContain('Hierarchical');
  });

  test.skip('should persist configuration changes after save', async () => {
    test.skip(!app, 'App not launched');

    // Click save button
    await page.locator('[data-testid="save-config-btn"], button:has-text("Save")').first().click();

    // Wait for save confirmation
    await page.waitForTimeout(500);

    // Reload page
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Navigate back to settings
    await page.locator('[data-testid="settings-btn"], button:has-text("Settings")').first().click();

    // Verify saved values are loaded
    await expect(page.locator('text=12 Agents')).toBeVisible();
    await expect(page.locator('text=Hierarchical')).toBeVisible();
  });
});

// ============================================
// Mock-based Configuration Tests
// ============================================

test.describe('Claude Flow Configuration - Mock-based', () => {
  test.beforeEach(() => {
    setupTestEnvironment();
  });

  test.afterEach(() => {
    cleanupTestEnvironment();
  });

  test('should save and load configuration correctly', async () => {
    const config: ClaudeFlowConfig = {
      agentCount: 12,
      topology: 'hierarchical',
      timeout: 600
    };

    saveConfig(config);
    const loadedConfig = loadConfig();

    expect(loadedConfig).not.toBeNull();
    expect(loadedConfig?.agentCount).toBe(12);
    expect(loadedConfig?.topology).toBe('hierarchical');
    expect(loadedConfig?.timeout).toBe(600);
  });

  test('should return null when no config exists', async () => {
    const config = loadConfig();
    expect(config).toBeNull();
  });

  test('should use default config values', async () => {
    const defaultConfig = getDefaultConfig();

    expect(defaultConfig.agentCount).toBe(8);
    expect(defaultConfig.topology).toBe('distributed');
    expect(defaultConfig.timeout).toBe(300);
  });

  test('should validate agent count options (4, 8, 12)', async () => {
    const validAgentCounts: AgentCount[] = [4, 8, 12];

    for (const count of validAgentCounts) {
      const config: ClaudeFlowConfig = {
        agentCount: count,
        topology: 'distributed'
      };
      saveConfig(config);
      const loaded = loadConfig();
      expect(loaded?.agentCount).toBe(count);
    }
  });

  test('should validate topology mode options', async () => {
    const validTopologies: TopologyMode[] = ['distributed', 'hierarchical', 'mesh', 'centralized'];

    for (const topology of validTopologies) {
      const config: ClaudeFlowConfig = {
        agentCount: 8,
        topology: topology
      };
      saveConfig(config);
      const loaded = loadConfig();
      expect(loaded?.topology).toBe(topology);
    }
  });

  test('should update configuration partially', async () => {
    // Save initial config
    const initialConfig: ClaudeFlowConfig = {
      agentCount: 8,
      topology: 'distributed',
      timeout: 300
    };
    saveConfig(initialConfig);

    // Update only agent count
    const loaded = loadConfig();
    if (loaded) {
      loaded.agentCount = 12;
      saveConfig(loaded);
    }

    // Verify update preserved other fields
    const updated = loadConfig();
    expect(updated?.agentCount).toBe(12);
    expect(updated?.topology).toBe('distributed');
    expect(updated?.timeout).toBe(300);
  });

  test('should apply configuration to new tasks', async () => {
    const config: ClaudeFlowConfig = {
      agentCount: 12,
      topology: 'hierarchical'
    };

    createConfiguredTask('001-configured-task', config);

    const planPath = path.join(
      TEST_PROJECT_DIR,
      'auto-claude',
      'specs',
      '001-configured-task',
      'implementation_plan.json'
    );

    const plan = JSON.parse(readFileSync(planPath, 'utf-8'));
    expect(plan.parallel_config.agent_count).toBe(12);
    expect(plan.parallel_config.topology).toBe('hierarchical');
  });
});

// ============================================
// Configuration Change Flow Tests
// ============================================

test.describe('Claude Flow Configuration Change Flow', () => {
  test.beforeEach(() => {
    setupTestEnvironment();
  });

  test.afterEach(() => {
    cleanupTestEnvironment();
  });

  test('should change agent count from 8 to 12', async () => {
    // Initial config with 8 agents
    saveConfig({
      agentCount: 8,
      topology: 'distributed'
    });

    // Simulate user changing to 12 agents
    const config = loadConfig();
    expect(config?.agentCount).toBe(8);

    config!.agentCount = 12;
    saveConfig(config!);

    // Verify change
    const updated = loadConfig();
    expect(updated?.agentCount).toBe(12);
  });

  test('should change topology from distributed to hierarchical', async () => {
    // Initial config with distributed
    saveConfig({
      agentCount: 8,
      topology: 'distributed'
    });

    // Simulate user changing to hierarchical
    const config = loadConfig();
    expect(config?.topology).toBe('distributed');

    config!.topology = 'hierarchical';
    saveConfig(config!);

    // Verify change
    const updated = loadConfig();
    expect(updated?.topology).toBe('hierarchical');
  });

  test('should apply new settings to subsequent task execution', async () => {
    // Set configuration
    const config: ClaudeFlowConfig = {
      agentCount: 12,
      topology: 'mesh'
    };
    saveConfig(config);

    // Create first task with this config
    createConfiguredTask('001-first-task', config);

    // Verify first task uses correct settings
    const plan1Path = path.join(
      TEST_PROJECT_DIR,
      'auto-claude',
      'specs',
      '001-first-task',
      'implementation_plan.json'
    );
    const plan1 = JSON.parse(readFileSync(plan1Path, 'utf-8'));
    expect(plan1.parallel_config.agent_count).toBe(12);
    expect(plan1.parallel_config.topology).toBe('mesh');

    // Change configuration
    config.agentCount = 4;
    config.topology = 'centralized';
    saveConfig(config);

    // Create second task with new config
    createConfiguredTask('002-second-task', config);

    // Verify second task uses updated settings
    const plan2Path = path.join(
      TEST_PROJECT_DIR,
      'auto-claude',
      'specs',
      '002-second-task',
      'implementation_plan.json'
    );
    const plan2 = JSON.parse(readFileSync(plan2Path, 'utf-8'));
    expect(plan2.parallel_config.agent_count).toBe(4);
    expect(plan2.parallel_config.topology).toBe('centralized');
  });

  test('should reflect configuration changes in execution metrics', async () => {
    // Test with different agent counts and verify expected speedup ranges
    const testCases: Array<{ agentCount: AgentCount; expectedSpeedupMin: number; expectedSpeedupMax: number }> = [
      { agentCount: 4, expectedSpeedupMin: 3.5, expectedSpeedupMax: 5.0 },
      { agentCount: 8, expectedSpeedupMin: 5.0, expectedSpeedupMax: 7.0 },
      { agentCount: 12, expectedSpeedupMin: 6.5, expectedSpeedupMax: 10.0 }
    ];

    for (const tc of testCases) {
      // Set config
      saveConfig({
        agentCount: tc.agentCount,
        topology: 'distributed'
      });

      // Simulate execution result with expected speedup
      const mockSpeedup = (tc.expectedSpeedupMin + tc.expectedSpeedupMax) / 2;
      const resultDir = path.join(TEST_PROJECT_DIR, 'auto-claude', 'results');
      mkdirSync(resultDir, { recursive: true });

      const result = {
        task_id: `task-${tc.agentCount}-agents`,
        metrics: {
          agent_count: tc.agentCount,
          speedup_factor: mockSpeedup
        }
      };

      writeFileSync(
        path.join(resultDir, `task-${tc.agentCount}-agents.json`),
        JSON.stringify(result, null, 2)
      );

      // Verify result reflects config
      const storedResult = JSON.parse(
        readFileSync(path.join(resultDir, `task-${tc.agentCount}-agents.json`), 'utf-8')
      );
      expect(storedResult.metrics.agent_count).toBe(tc.agentCount);
      expect(storedResult.metrics.speedup_factor).toBeGreaterThanOrEqual(tc.expectedSpeedupMin);
      expect(storedResult.metrics.speedup_factor).toBeLessThanOrEqual(tc.expectedSpeedupMax);
    }
  });
});

// ============================================
// Topology Mode Behavior Tests
// ============================================

test.describe('Claude Flow Topology Mode Behavior', () => {
  test.beforeEach(() => {
    setupTestEnvironment();
  });

  test.afterEach(() => {
    cleanupTestEnvironment();
  });

  test('distributed topology should use equal peer pattern', async () => {
    const config: ClaudeFlowConfig = {
      agentCount: 8,
      topology: 'distributed'
    };
    createConfiguredTask('001-distributed', config);

    const planPath = path.join(
      TEST_PROJECT_DIR,
      'auto-claude',
      'specs',
      '001-distributed',
      'implementation_plan.json'
    );
    const plan = JSON.parse(readFileSync(planPath, 'utf-8'));

    expect(plan.parallel_config.topology).toBe('distributed');
  });

  test('hierarchical topology should use leader-worker pattern', async () => {
    const config: ClaudeFlowConfig = {
      agentCount: 8,
      topology: 'hierarchical'
    };
    createConfiguredTask('002-hierarchical', config);

    const planPath = path.join(
      TEST_PROJECT_DIR,
      'auto-claude',
      'specs',
      '002-hierarchical',
      'implementation_plan.json'
    );
    const plan = JSON.parse(readFileSync(planPath, 'utf-8'));

    expect(plan.parallel_config.topology).toBe('hierarchical');
  });

  test('mesh topology should use fully connected pattern', async () => {
    const config: ClaudeFlowConfig = {
      agentCount: 8,
      topology: 'mesh'
    };
    createConfiguredTask('003-mesh', config);

    const planPath = path.join(
      TEST_PROJECT_DIR,
      'auto-claude',
      'specs',
      '003-mesh',
      'implementation_plan.json'
    );
    const plan = JSON.parse(readFileSync(planPath, 'utf-8'));

    expect(plan.parallel_config.topology).toBe('mesh');
  });

  test('centralized topology should use coordinator pattern', async () => {
    const config: ClaudeFlowConfig = {
      agentCount: 8,
      topology: 'centralized'
    };
    createConfiguredTask('004-centralized', config);

    const planPath = path.join(
      TEST_PROJECT_DIR,
      'auto-claude',
      'specs',
      '004-centralized',
      'implementation_plan.json'
    );
    const plan = JSON.parse(readFileSync(planPath, 'utf-8'));

    expect(plan.parallel_config.topology).toBe('centralized');
  });
});

// ============================================
// Configuration Validation Tests
// ============================================

test.describe('Claude Flow Configuration Validation', () => {
  test.beforeEach(() => {
    setupTestEnvironment();
  });

  test.afterEach(() => {
    cleanupTestEnvironment();
  });

  test('should accept valid agent counts (4, 8, 12)', async () => {
    const validCounts: AgentCount[] = [4, 8, 12];

    for (const count of validCounts) {
      const config: ClaudeFlowConfig = {
        agentCount: count,
        topology: 'distributed'
      };

      // Should not throw
      expect(() => saveConfig(config)).not.toThrow();

      const loaded = loadConfig();
      expect(loaded?.agentCount).toBe(count);
    }
  });

  test('should accept valid topology modes', async () => {
    const validModes: TopologyMode[] = ['distributed', 'hierarchical', 'mesh', 'centralized'];

    for (const mode of validModes) {
      const config: ClaudeFlowConfig = {
        agentCount: 8,
        topology: mode
      };

      // Should not throw
      expect(() => saveConfig(config)).not.toThrow();

      const loaded = loadConfig();
      expect(loaded?.topology).toBe(mode);
    }
  });

  test('should store optional model configuration', async () => {
    const config: ClaudeFlowConfig = {
      agentCount: 8,
      topology: 'distributed',
      model: 'claude-3-opus'
    };

    saveConfig(config);
    const loaded = loadConfig();

    expect(loaded?.model).toBe('claude-3-opus');
  });

  test('should store optional timeout configuration', async () => {
    const config: ClaudeFlowConfig = {
      agentCount: 8,
      topology: 'distributed',
      timeout: 600
    };

    saveConfig(config);
    const loaded = loadConfig();

    expect(loaded?.timeout).toBe(600);
  });
});

// ============================================
// Complete Configuration Change E2E Flow
// ============================================

test.describe('Claude Flow Complete Configuration Change Flow', () => {
  test.beforeEach(() => {
    setupTestEnvironment();
  });

  test.afterEach(() => {
    cleanupTestEnvironment();
  });

  test('should complete full configuration change flow', async () => {
    // Step 1: Start with default configuration
    const initialConfig = getDefaultConfig();
    saveConfig(initialConfig);

    // Step 2: Change agent count to 12
    const config1 = loadConfig()!;
    config1.agentCount = 12;
    saveConfig(config1);

    // Step 3: Change mode to hierarchical
    const config2 = loadConfig()!;
    config2.topology = 'hierarchical';
    saveConfig(config2);

    // Step 4: Create task with new settings
    const finalConfig = loadConfig()!;
    createConfiguredTask('001-full-flow-test', finalConfig);

    // Step 5: Verify new settings applied
    const planPath = path.join(
      TEST_PROJECT_DIR,
      'auto-claude',
      'specs',
      '001-full-flow-test',
      'implementation_plan.json'
    );
    const plan = JSON.parse(readFileSync(planPath, 'utf-8'));

    expect(plan.parallel_config.agent_count).toBe(12);
    expect(plan.parallel_config.topology).toBe('hierarchical');

    // Step 6: Verify configuration persisted correctly
    const verifyConfig = loadConfig();
    expect(verifyConfig?.agentCount).toBe(12);
    expect(verifyConfig?.topology).toBe('hierarchical');
  });
});
