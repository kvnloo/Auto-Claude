/**
 * Browser mock for window.electronAPI
 * This allows the app to run in a regular browser for UI development/testing
 *
 * This module aggregates all mock implementations from separate modules
 * for better code organization and maintainability.
 */

import type { ElectronAPI } from '../../shared/types';
import {
  projectMock,
  taskMock,
  workspaceMock,
  terminalMock,
  claudeProfileMock,
  contextMock,
  integrationMock,
  changelogMock,
  insightsMock,
  infrastructureMock,
  settingsMock
} from './mocks';

// Check if we're in a browser (not Electron)
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

/**
 * Create mock electronAPI for browser
 * Aggregates all mock implementations from separate modules
 */
const browserMockAPI: ElectronAPI = {
  // Project Operations
  ...projectMock,

  // Task Operations
  ...taskMock,

  // Workspace Management
  ...workspaceMock,

  // Terminal Operations
  ...terminalMock,

  // Claude Profile Management
  ...claudeProfileMock,

  // Settings
  ...settingsMock,

  // Roadmap Operations
  getRoadmap: async () => ({
    success: true,
    data: null
  }),

  getRoadmapStatus: async () => ({
    success: true,
    data: { isRunning: false }
  }),

  saveRoadmap: async () => ({
    success: true
  }),

  generateRoadmap: (_projectId: string, _enableCompetitorAnalysis?: boolean, _refreshCompetitorAnalysis?: boolean) => {
    console.warn('[Browser Mock] generateRoadmap called');
  },

  refreshRoadmap: (_projectId: string, _enableCompetitorAnalysis?: boolean, _refreshCompetitorAnalysis?: boolean) => {
    console.warn('[Browser Mock] refreshRoadmap called');
  },

  updateFeatureStatus: async () => ({ success: true }),

  convertFeatureToSpec: async (projectId: string, _featureId: string) => ({
    success: true,
    data: {
      id: `task-${Date.now()}`,
      specId: '',
      projectId,
      title: 'Converted Feature',
      description: 'Feature converted from roadmap',
      status: 'backlog' as const,
      subtasks: [],
      logs: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }),

  stopRoadmap: async () => ({ success: true }),

  // Roadmap Event Listeners
  onRoadmapProgress: () => () => {},
  onRoadmapComplete: () => () => {},
  onRoadmapError: () => () => {},
  onRoadmapStopped: () => () => {},
  // Context Operations
  ...contextMock,

  // Environment Configuration & Integration Operations
  ...integrationMock,

  // Changelog & Release Operations
  ...changelogMock,

  // Insights Operations
  ...insightsMock,

  // Infrastructure & Docker Operations
  ...infrastructureMock,

  // API Profile Management (custom Anthropic-compatible endpoints)
  getAPIProfiles: async () => ({
    success: true,
    data: {
      profiles: [],
      activeProfileId: null,
      version: 1
    }
  }),

  saveAPIProfile: async (profile) => ({
    success: true,
    data: {
      id: `mock-profile-${Date.now()}`,
      ...profile,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  }),

  updateAPIProfile: async (profile) => ({
    success: true,
    data: {
      ...profile,
      updatedAt: Date.now()
    }
  }),

  deleteAPIProfile: async (_profileId: string) => ({
    success: true
  }),

  setActiveAPIProfile: async (_profileId: string | null) => ({
    success: true
  }),

  testConnection: async (_baseUrl: string, _apiKey: string, _signal?: AbortSignal) => ({
    success: true,
    data: {
      success: true,
      message: 'Connection successful (mock)'
    }
  }),

  discoverModels: async (_baseUrl: string, _apiKey: string, _signal?: AbortSignal) => ({
    success: true,
    data: {
      models: []
    }
  }),

  // GitHub API
  github: {
    getGitHubRepositories: async () => ({ success: true, data: [] }),
    getGitHubIssues: async () => ({ success: true, data: [] }),
    getGitHubIssue: async () => ({ success: true, data: null as any }),
    getIssueComments: async () => ({ success: true, data: [] }),
    checkGitHubConnection: async () => ({ success: true, data: { connected: false, repoFullName: undefined, error: undefined } }),
    investigateGitHubIssue: () => {},
    importGitHubIssues: async () => ({ success: true, data: { success: true, imported: 0, failed: 0, issues: [] } }),
    createGitHubRelease: async () => ({ success: true, data: { url: '' } }),
    suggestReleaseVersion: async () => ({ success: true, data: { suggestedVersion: '1.0.0', currentVersion: '0.0.0', bumpType: 'minor' as const, commitCount: 0, reason: 'Initial' } }),
    checkGitHubCli: async () => ({ success: true, data: { installed: false } }),
    checkGitHubAuth: async () => ({ success: true, data: { authenticated: false } }),
    startGitHubAuth: async () => ({ success: true, data: { success: false } }),
    getGitHubToken: async () => ({ success: true, data: { token: '' } }),
    getGitHubUser: async () => ({ success: true, data: { username: '' } }),
    listGitHubUserRepos: async () => ({ success: true, data: { repos: [] } }),
    detectGitHubRepo: async () => ({ success: true, data: '' }),
    getGitHubBranches: async () => ({ success: true, data: [] }),
    createGitHubRepo: async () => ({ success: true, data: { fullName: '', url: '' } }),
    addGitRemote: async () => ({ success: true, data: { remoteUrl: '' } }),
    listGitHubOrgs: async () => ({ success: true, data: { orgs: [] } }),
    onGitHubAuthDeviceCode: () => () => {},
    onGitHubInvestigationProgress: () => () => {},
    onGitHubInvestigationComplete: () => () => {},
    onGitHubInvestigationError: () => () => {},
    getAutoFixConfig: async () => null,
    saveAutoFixConfig: async () => true,
    getAutoFixQueue: async () => [],
    checkAutoFixLabels: async () => [],
    checkNewIssues: async () => [],
    startAutoFix: () => {},
    onAutoFixProgress: () => () => {},
    onAutoFixComplete: () => () => {},
    onAutoFixError: () => () => {},
    listPRs: async () => [],
    getPR: async () => null,
    runPRReview: () => {},
    cancelPRReview: async () => true,
    postPRReview: async () => true,
    postPRComment: async () => true,
    mergePR: async () => true,
    assignPR: async () => true,
    getPRReview: async () => null,
    getPRReviewsBatch: async () => ({}),
    deletePRReview: async () => true,
    checkNewCommits: async () => ({ hasNewCommits: false, newCommitCount: 0 }),
    checkMergeReadiness: async () => ({ isDraft: false, mergeable: 'UNKNOWN' as const, isBehind: false, ciStatus: 'none' as const, blockers: [] }),
    runFollowupReview: () => {},
    getPRLogs: async () => null,
    getWorkflowsAwaitingApproval: async () => ({ awaiting_approval: 0, workflow_runs: [], can_approve: false }),
    approveWorkflow: async () => true,
    onPRReviewProgress: () => () => {},
    onPRReviewComplete: () => () => {},
    onPRReviewError: () => () => {},
    batchAutoFix: () => {},
    getBatches: async () => [],
    onBatchProgress: () => () => {},
    onBatchComplete: () => () => {},
    onBatchError: () => () => {},
    // Analyze & Group Issues (proactive workflow)
    analyzeIssuesPreview: () => {},
    approveBatches: async () => ({ success: true, batches: [] }),
    onAnalyzePreviewProgress: () => () => {},
    onAnalyzePreviewComplete: () => () => {},
    onAnalyzePreviewError: () => () => {}
  },

  // Claude Code Operations
  checkClaudeCodeVersion: async () => ({
    success: true,
    data: {
      installed: '1.0.0',
      latest: '1.0.0',
      isOutdated: false,
      path: '/usr/local/bin/claude',
      detectionResult: {
        found: true,
        version: '1.0.0',
        path: '/usr/local/bin/claude',
        source: 'system-path' as const,
        message: 'Claude Code CLI found'
      }
    }
  }),
  installClaudeCode: async () => ({
    success: true,
    data: { command: 'npm install -g @anthropic-ai/claude-code' }
  }),

  // Terminal Worktree Operations
  createTerminalWorktree: async () => ({
    success: false,
    error: 'Not available in browser mode'
  }),
  listTerminalWorktrees: async () => ({
    success: true,
    data: []
  }),
  removeTerminalWorktree: async () => ({
    success: false,
    error: 'Not available in browser mode'
  }),

  // MCP Server Health Check Operations
  checkMcpHealth: async (server) => ({
    success: true,
    data: {
      serverId: server.id,
      status: 'unknown' as const,
      message: 'Health check not available in browser mode',
      checkedAt: new Date().toISOString()
    }
  }),
  testMcpConnection: async (server) => ({
    success: true,
    data: {
      serverId: server.id,
      success: false,
      message: 'Connection test not available in browser mode'
    }
  }),

  // Debug Operations
  getDebugInfo: async () => ({
    systemInfo: {
      appVersion: '0.0.0-browser-mock',
      platform: 'browser',
      isPackaged: 'false'
    },
    recentErrors: [],
    logsPath: '/mock/logs',
    debugReport: '[Browser Mock] Debug report not available in browser mode'
  }),
  openLogsFolder: async () => ({ success: false, error: 'Not available in browser mode' }),
  copyDebugInfo: async () => ({ success: false, error: 'Not available in browser mode' }),
  getRecentErrors: async () => [],
  listLogFiles: async () => [],

  // Token Usage & Cost Dashboard Operations
  getUsageSummary: async () => ({
    success: true,
    data: {
      summary: {
        total_input_tokens: 50000,
        total_output_tokens: 25000,
        total_thinking_tokens: 10000,
        total_cache_hit_tokens: 15000,
        total_cost_usd: 0.75,
        session_count: 10,
        success_count: 8,
        failure_count: 2
      },
      efficiency: {
        success_rate: 80,
        avg_tokens_per_session: 8500,
        avg_cost_per_session: 0.075,
        cache_hit_rate: 30,
        score: 75,
        rating: 'good'
      },
      trends: {
        cost: {
          period: 'week',
          change_percent: -5,
          direction: 'down' as const
        },
        tokens: {
          period: 'week',
          change_percent: 10,
          direction: 'up' as const
        }
      }
    }
  }),
  getUsageByDateRange: async () => ({
    success: true,
    data: {
      date_range: {
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0]
      },
      daily: [
        { date: new Date().toISOString().split('T')[0], total_tokens: 8500, total_cost_usd: 0.08, session_count: 1 },
        { date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0], total_tokens: 12000, total_cost_usd: 0.12, session_count: 2 }
      ],
      weekly: {},
      monthly: {},
      by_spec: [
        { spec_id: '001', spec_name: 'Sample Task', total_tokens: 20000, total_cost_usd: 0.20, session_count: 3 }
      ],
      total_cost: 0.75
    }
  }),
  getUsageByAgent: async () => ({
    success: true,
    data: {
      breakdown: {
        planner: {
          agent_type: 'planner',
          total_tokens: 15000,
          total_cost_usd: 0.15,
          session_count: 3,
          success_count: 3,
          failure_count: 0
        },
        coder: {
          agent_type: 'coder',
          total_tokens: 50000,
          total_cost_usd: 0.50,
          session_count: 5,
          success_count: 4,
          failure_count: 1
        },
        qa_reviewer: {
          agent_type: 'qa_reviewer',
          total_tokens: 10000,
          total_cost_usd: 0.10,
          session_count: 2,
          success_count: 1,
          failure_count: 1
        }
      },
      totals: {
        tokens: 75000,
        cost_usd: 0.75,
        sessions: 10
      }
    }
  }),
  getUsageBySpec: async () => ({
    success: true,
    data: {
      specs: [
        {
          spec_id: '001',
          spec_name: 'Add User Authentication',
          total_tokens: 35000,
          total_cost_usd: 0.35,
          session_count: 4,
          success_count: 3,
          failure_count: 1,
          last_session_at: new Date().toISOString()
        },
        {
          spec_id: '002',
          spec_name: 'Fix Sidebar Bug',
          total_tokens: 15000,
          total_cost_usd: 0.15,
          session_count: 2,
          success_count: 2,
          failure_count: 0,
          last_session_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        }
      ],
      total_specs: 2
    }
  }),
  exportUsageReport: async () => ({
    success: true,
    data: {
      csv_content: 'date,spec_id,spec_name,agent_type,input_tokens,output_tokens,cost_usd\n2024-01-15,001,Sample,coder,1000,500,0.02',
      record_count: 1,
      message: 'Export successful'
    }
  }),

  // Git Operations
  initializeGit: async () => ({
    success: true,
    data: {
      success: true,
      initialized: true,
      alreadyInitialized: false,
      message: 'Git repository initialized'
    }
  })
};

/**
 * Initialize browser mock if not running in Electron
 */
export function initBrowserMock(): void {
  if (!isElectron) {
    console.warn('%c[Browser Mock] Initializing mock electronAPI for browser preview', 'color: #f0ad4e; font-weight: bold;');
    (window as Window & { electronAPI: ElectronAPI }).electronAPI = browserMockAPI;
  }
}

// Auto-initialize
initBrowserMock();
