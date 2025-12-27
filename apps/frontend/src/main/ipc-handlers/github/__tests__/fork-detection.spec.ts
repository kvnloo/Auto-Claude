/**
 * Integration tests for GitHub fork detection functionality
 * Tests fork detection, parent repository extraction, and API routing
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock project store
const mockGetProject = vi.fn();
vi.mock('../../../project-store', () => ({
  projectStore: {
    getProject: (...args: unknown[]) => mockGetProject(...args)
  }
}));

// Mock fs module
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args)
}));

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn()
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock electron ipcMain
const mockHandlers = new Map<string, Function>();
vi.mock('electron', () => {
  const mockIpcMain = new (class extends EventEmitter {
    handle(channel: string, handler: Function): void {
      mockHandlers.set(channel, handler);
    }

    removeHandler(channel: string): void {
      mockHandlers.delete(channel);
    }
  })();

  return {
    ipcMain: mockIpcMain
  };
});

// Helper to invoke registered handlers
async function invokeHandler(channel: string, event: unknown, ...args: unknown[]): Promise<unknown> {
  const handler = mockHandlers.get(channel);
  if (handler) {
    return handler(event, ...args);
  }
  throw new Error(`No handler for channel: ${channel}`);
}

// Test project data
const mockProject = {
  id: 'test-project-id',
  name: 'Test Project',
  path: '/test/project',
  autoBuildPath: '.auto-claude'
};

// Mock API responses
const mockForkRepoResponse = {
  id: 123456,
  name: 'forked-repo',
  full_name: 'user/forked-repo',
  description: 'A forked repository',
  html_url: 'https://github.com/user/forked-repo',
  default_branch: 'main',
  private: false,
  owner: { login: 'user', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
  fork: true,
  parent: {
    id: 654321,
    name: 'original-repo',
    full_name: 'original-owner/original-repo',
    owner: { login: 'original-owner', avatar_url: 'https://avatars.githubusercontent.com/u/2' },
    html_url: 'https://github.com/original-owner/original-repo'
  }
};

const mockNonForkRepoResponse = {
  id: 789012,
  name: 'my-repo',
  full_name: 'user/my-repo',
  description: 'A non-fork repository',
  html_url: 'https://github.com/user/my-repo',
  default_branch: 'main',
  private: false,
  owner: { login: 'user', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
  fork: false
};

const mockIssuesFromParent = [
  {
    id: 1,
    number: 1,
    title: 'Issue from parent repo',
    body: 'This is an issue from the parent repository',
    state: 'open',
    labels: [],
    assignees: [],
    user: { login: 'contributor', avatar_url: 'https://avatars.githubusercontent.com/u/3' },
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    comments: 5,
    url: 'https://api.github.com/repos/original-owner/original-repo/issues/1',
    html_url: 'https://github.com/original-owner/original-repo/issues/1'
  }
];

describe('Fork Detection Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHandlers.clear();

    // Default project mock
    mockGetProject.mockReturnValue(mockProject);

    // Default file system mock
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      'GITHUB_TOKEN=test-token\nGITHUB_REPO=user/forked-repo'
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('detectForkStatus function', () => {
    it('should detect forked repository and extract parent info', async () => {
      // Mock successful API response for a fork
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockForkRepoResponse
      });

      const { detectForkStatus } = await import('../repository-handlers');
      const result = await detectForkStatus('test-token', 'user/forked-repo');

      expect(result.isFork).toBe(true);
      expect(result.parentRepository).toBeDefined();
      expect(result.parentRepository?.owner).toBe('original-owner');
      expect(result.parentRepository?.name).toBe('original-repo');
      expect(result.parentRepository?.fullName).toBe('original-owner/original-repo');
      expect(result.parentRepository?.url).toBe('https://github.com/original-owner/original-repo');
    });

    it('should return isFork: false for non-fork repository', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockNonForkRepoResponse
      });

      const { detectForkStatus } = await import('../repository-handlers');
      const result = await detectForkStatus('test-token', 'user/my-repo');

      expect(result.isFork).toBe(false);
      expect(result.parentRepository).toBeUndefined();
    });

    it('should handle GitHub URL formats', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockForkRepoResponse
      });

      const { detectForkStatus } = await import('../repository-handlers');
      const result = await detectForkStatus('test-token', 'https://github.com/user/forked-repo');

      expect(result.isFork).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/user/forked-repo',
        expect.any(Object)
      );
    });

    it('should handle git URL formats', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockForkRepoResponse
      });

      const { detectForkStatus } = await import('../repository-handlers');
      const result = await detectForkStatus('test-token', 'git@github.com:user/forked-repo.git');

      expect(result.isFork).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/user/forked-repo',
        expect.any(Object)
      );
    });

    it('should throw error for invalid repository format', async () => {
      const { detectForkStatus } = await import('../repository-handlers');

      await expect(detectForkStatus('test-token', '')).rejects.toThrow(
        'Invalid repository format. Use owner/repo or GitHub URL.'
      );
    });
  });

  describe('GITHUB_DETECT_FORK IPC handler', () => {
    it('should detect fork status for project', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockForkRepoResponse
      });

      const { registerDetectFork } = await import('../repository-handlers');
      registerDetectFork();

      const result = await invokeHandler('github:detectFork', {}, 'test-project-id');

      expect(result).toEqual({
        success: true,
        data: {
          isFork: true,
          parentRepository: {
            owner: 'original-owner',
            name: 'original-repo',
            fullName: 'original-owner/original-repo',
            url: 'https://github.com/original-owner/original-repo'
          }
        }
      });
    });

    it('should return error when project not found', async () => {
      mockGetProject.mockReturnValueOnce(null);

      const { registerDetectFork } = await import('../repository-handlers');
      registerDetectFork();

      const result = await invokeHandler('github:detectFork', {}, 'unknown-project');

      expect(result).toEqual({
        success: false,
        error: 'Project not found'
      });
    });

    it('should return error when no GitHub config', async () => {
      mockExistsSync.mockReturnValueOnce(false);

      const { registerDetectFork } = await import('../repository-handlers');
      registerDetectFork();

      const result = await invokeHandler('github:detectFork', {}, 'test-project-id');

      expect(result).toEqual({
        success: false,
        error: 'No GitHub token or repository configured'
      });
    });
  });

  describe('Issue routing with fork detection', () => {
    it('should route issue requests to parent repo when fork is configured', async () => {
      // Configure as fork
      mockReadFileSync.mockReturnValue(
        'GITHUB_TOKEN=test-token\nGITHUB_REPO=user/forked-repo\nIS_FORK=true\nGITHUB_PARENT_REPO=original-owner/original-repo'
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockIssuesFromParent
      });

      const { registerGetIssues } = await import('../issue-handlers');
      registerGetIssues();

      const result = await invokeHandler('github:getIssues', {}, 'test-project-id', 'open');

      // Verify API was called with parent repo
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('original-owner/original-repo'),
        expect.any(Object)
      );

      expect(result).toHaveProperty('success', true);
    });

    it('should route issue requests to fork repo when not configured as fork', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => []
      });

      const { registerGetIssues } = await import('../issue-handlers');
      registerGetIssues();

      const result = await invokeHandler('github:getIssues', {}, 'test-project-id', 'open');

      // Verify API was called with fork repo (not parent)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('user/forked-repo'),
        expect.any(Object)
      );

      expect(result).toHaveProperty('success', true);
    });
  });

  describe('Connection check with fork status', () => {
    it('should include fork status in connection check response', async () => {
      // First call for repo info, second for issues
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockForkRepoResponse
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        });

      const { registerCheckConnection } = await import('../repository-handlers');
      registerCheckConnection();

      const result = await invokeHandler('github:checkConnection', {}, 'test-project-id') as {
        success: boolean;
        data: { isFork: boolean; parentRepository?: object };
      };

      expect(result.success).toBe(true);
      expect(result.data.isFork).toBe(true);
      expect(result.data.parentRepository).toBeDefined();
    });

    it('should not include parent info for non-fork repos', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockNonForkRepoResponse
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        });

      const { registerCheckConnection } = await import('../repository-handlers');
      registerCheckConnection();

      const result = await invokeHandler('github:checkConnection', {}, 'test-project-id') as {
        success: boolean;
        data: { isFork: boolean; parentRepository?: object };
      };

      expect(result.success).toBe(true);
      expect(result.data.isFork).toBe(false);
      expect(result.data.parentRepository).toBeUndefined();
    });
  });

  describe('getTargetRepo helper function', () => {
    it('should return parent repo when isFork and parentRepo configured', async () => {
      const { getTargetRepo } = await import('../utils');

      const config = {
        token: 'test-token',
        repo: 'user/forked-repo',
        isFork: true,
        parentRepo: 'original-owner/original-repo'
      };

      const result = getTargetRepo(config, true);
      expect(result).toBe('original-owner/original-repo');
    });

    it('should return fork repo when useParentForIssues is false', async () => {
      const { getTargetRepo } = await import('../utils');

      const config = {
        token: 'test-token',
        repo: 'user/forked-repo',
        isFork: true,
        parentRepo: 'original-owner/original-repo'
      };

      const result = getTargetRepo(config, false);
      expect(result).toBe('user/forked-repo');
    });

    it('should return fork repo when not marked as fork', async () => {
      const { getTargetRepo } = await import('../utils');

      const config = {
        token: 'test-token',
        repo: 'user/my-repo'
      };

      const result = getTargetRepo(config, true);
      expect(result).toBe('user/my-repo');
    });

    it('should return fork repo when parentRepo not configured', async () => {
      const { getTargetRepo } = await import('../utils');

      const config = {
        token: 'test-token',
        repo: 'user/forked-repo',
        isFork: true
        // No parentRepo configured
      };

      const result = getTargetRepo(config, true);
      expect(result).toBe('user/forked-repo');
    });
  });

  describe('normalizeRepoReference helper function', () => {
    it('should pass through owner/repo format unchanged', async () => {
      const { normalizeRepoReference } = await import('../utils');
      expect(normalizeRepoReference('owner/repo')).toBe('owner/repo');
    });

    it('should strip https://github.com/ prefix', async () => {
      const { normalizeRepoReference } = await import('../utils');
      expect(normalizeRepoReference('https://github.com/owner/repo')).toBe('owner/repo');
    });

    it('should strip .git suffix', async () => {
      const { normalizeRepoReference } = await import('../utils');
      expect(normalizeRepoReference('https://github.com/owner/repo.git')).toBe('owner/repo');
    });

    it('should handle git@github.com: format', async () => {
      const { normalizeRepoReference } = await import('../utils');
      expect(normalizeRepoReference('git@github.com:owner/repo.git')).toBe('owner/repo');
    });

    it('should return empty string for empty input', async () => {
      const { normalizeRepoReference } = await import('../utils');
      expect(normalizeRepoReference('')).toBe('');
    });
  });

  describe('Fallback behavior for inaccessible parent repos', () => {
    it('should fall back to fork repo when parent returns 404', async () => {
      const { githubFetchWithFallback } = await import('../utils');

      const config = {
        token: 'test-token',
        repo: 'user/forked-repo',
        isFork: true,
        parentRepo: 'original-owner/original-repo'
      };

      // First call (parent) returns 404, second call (fork) succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => 'Not Found'
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockIssuesFromParent
        });

      const result = await githubFetchWithFallback(
        config,
        '/repos/{repo}/issues',
        true
      );

      expect(result.usedFallback).toBe(true);
      expect(result.usedRepo).toBe('user/forked-repo');
    });

    it('should fall back to fork repo when parent returns 403', async () => {
      const { githubFetchWithFallback } = await import('../utils');

      const config = {
        token: 'test-token',
        repo: 'user/forked-repo',
        isFork: true,
        parentRepo: 'original-owner/original-repo'
      };

      // First call (parent) returns 403, second call (fork) succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          text: async () => 'Forbidden'
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        });

      const result = await githubFetchWithFallback(
        config,
        '/repos/{repo}/issues',
        true
      );

      expect(result.usedFallback).toBe(true);
      expect(result.usedRepo).toBe('user/forked-repo');
    });

    it('should not fall back when using fork repo directly', async () => {
      const { githubFetchWithFallback } = await import('../utils');

      const config = {
        token: 'test-token',
        repo: 'user/my-repo'
        // Not a fork
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => []
      });

      const result = await githubFetchWithFallback(
        config,
        '/repos/{repo}/issues',
        true
      );

      expect(result.usedFallback).toBe(false);
      expect(result.usedRepo).toBe('user/my-repo');
    });
  });

  describe('Backward compatibility', () => {
    it('should work with projects without fork configuration', async () => {
      // Simple config without fork fields
      mockReadFileSync.mockReturnValue(
        'GITHUB_TOKEN=test-token\nGITHUB_REPO=user/my-repo'
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => []
      });

      const { registerGetIssues } = await import('../issue-handlers');
      registerGetIssues();

      const result = await invokeHandler('github:getIssues', {}, 'test-project-id', 'open');

      expect(result).toHaveProperty('success', true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('user/my-repo'),
        expect.any(Object)
      );
    });

    it('should handle IS_FORK=false gracefully', async () => {
      mockReadFileSync.mockReturnValue(
        'GITHUB_TOKEN=test-token\nGITHUB_REPO=user/my-repo\nIS_FORK=false'
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => []
      });

      const { registerGetIssues } = await import('../issue-handlers');
      registerGetIssues();

      const result = await invokeHandler('github:getIssues', {}, 'test-project-id', 'open');

      expect(result).toHaveProperty('success', true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('user/my-repo'),
        expect.any(Object)
      );
    });
  });
});
