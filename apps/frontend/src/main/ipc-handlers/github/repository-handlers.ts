/**
 * GitHub repository-related IPC handlers
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult, GitHubRepository, GitHubSyncStatus } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getGitHubConfig, githubFetch, normalizeRepoReference } from './utils';
import type { GitHubAPIRepository } from './types';

/**
 * Result of fork status detection
 */
export interface ForkStatusResult {
  isFork: boolean;
  parentRepository?: {
    owner: string;
    name: string;
    fullName: string;
    url: string;
  };
}

/**
 * Detect if a repository is a fork and extract parent repository information.
 * Queries the GitHub API to check the fork status and retrieve parent repository details.
 *
 * @param token GitHub API token for authentication
 * @param repo Repository reference (owner/repo format, full URL, or git URL)
 * @returns Fork status and parent repository info if applicable
 * @throws Error if repository format is invalid or API call fails
 */
export async function detectForkStatus(
  token: string,
  repo: string
): Promise<ForkStatusResult> {
  // Normalize the repo reference (handles full URLs, git URLs, etc.)
  const normalizedRepo = normalizeRepoReference(repo);
  if (!normalizedRepo) {
    throw new Error('Invalid repository format. Use owner/repo or GitHub URL.');
  }

  // Fetch repository information from GitHub API
  const repoData = await githubFetch(
    token,
    `/repos/${normalizedRepo}`
  ) as GitHubAPIRepository;

  // Check if repository is a fork and has parent information
  if (!repoData.fork || !repoData.parent) {
    return { isFork: false };
  }

  // Extract parent repository information
  return {
    isFork: true,
    parentRepository: {
      owner: repoData.parent.owner.login,
      name: repoData.parent.name,
      fullName: repoData.parent.full_name,
      url: repoData.parent.html_url
    }
  };
}

/**
 * Check GitHub connection status
 */
export function registerCheckConnection(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_CHECK_CONNECTION,
    async (_, projectId: string): Promise<IPCResult<GitHubSyncStatus>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = getGitHubConfig(project);
      if (!config) {
        return {
          success: true,
          data: {
            connected: false,
            error: 'No GitHub token or repository configured'
          }
        };
      }

      try {
        // Normalize repo reference (handles full URLs, git URLs, etc.)
        const normalizedRepo = normalizeRepoReference(config.repo);
        if (!normalizedRepo) {
          return {
            success: true,
            data: {
              connected: false,
              error: 'Invalid repository format. Use owner/repo or GitHub URL.'
            }
          };
        }

        // Fetch repo info
        const repoData = await githubFetch(
          config.token,
          `/repos/${normalizedRepo}`
        ) as { full_name: string; description?: string };

        // Count open issues
        const issuesData = await githubFetch(
          config.token,
          `/repos/${normalizedRepo}/issues?state=open&per_page=1`
        ) as unknown[];

        const openCount = Array.isArray(issuesData) ? issuesData.length : 0;

        return {
          success: true,
          data: {
            connected: true,
            repoFullName: repoData.full_name,
            repoDescription: repoData.description,
            issueCount: openCount,
            lastSyncedAt: new Date().toISOString()
          }
        };
      } catch (error) {
        return {
          success: true,
          data: {
            connected: false,
            error: error instanceof Error ? error.message : 'Failed to connect to GitHub'
          }
        };
      }
    }
  );
}

/**
 * Get list of GitHub repositories (personal + organization)
 */
export function registerGetRepositories(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_GET_REPOSITORIES,
    async (_, projectId: string): Promise<IPCResult<GitHubRepository[]>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = getGitHubConfig(project);
      if (!config) {
        return { success: false, error: 'No GitHub token configured' };
      }

      try {
        // Fetch user's personal + organization repos
        // affiliation parameter includes: owner, collaborator, organization_member
        const repos = await githubFetch(
          config.token,
          '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member'
        ) as GitHubAPIRepository[];

        const result: GitHubRepository[] = repos.map(repo => ({
          id: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description,
          url: repo.html_url,
          defaultBranch: repo.default_branch,
          private: repo.private,
          owner: {
            login: repo.owner.login,
            avatarUrl: repo.owner.avatar_url
          }
        }));

        return { success: true, data: result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch repositories'
        };
      }
    }
  );
}

/**
 * Register all repository-related handlers
 */
export function registerRepositoryHandlers(): void {
  registerCheckConnection();
  registerGetRepositories();
}
