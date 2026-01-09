import { ipcMain } from 'electron';
import { execFileSync } from 'child_process';
import { IPC_CHANNELS } from '../../shared/constants';
import type {
  IPCResult,
  GitCommit,
  GitTagInfo
} from '../../shared/types';
import { getTags, getCommits } from '../changelog/git-integration';
import { getToolPath } from '../cli-tool-manager';

/**
 * Options for fetching Git history
 */
export interface TimelineGitHistoryOptions {
  /** Maximum number of commits to retrieve (default: 500) */
  limit?: number;
  /** Include merge commits (default: true) */
  includeMergeCommits?: boolean;
  /** Only return commits since this date (ISO format) */
  since?: string;
  /** Only return commits until this date (ISO format) */
  until?: string;
}

/**
 * Extended GitCommit with parent info for shallow detection
 */
export interface TimelineGitCommitWithParents extends GitCommit {
  /** Whether this commit has parent commits (for shallow detection) */
  hasParents: boolean;
}

/**
 * Extended response for git history including shallow detection
 */
export interface TimelineGitHistoryResponse {
  /** Array of commits */
  commits: TimelineGitCommitWithParents[];
  /** Whether the repository is a shallow clone */
  isShallowRepository: boolean;
  /** Hash of the oldest commit in this fetch */
  oldestCommitHash?: string;
}

/**
 * Register Git history IPC handlers for Timeline view
 *
 * These handlers provide access to Git history data needed for
 * the Timeline/Gantt view visualization.
 */
export function registerGitHistoryHandlers(): void {
  /**
   * Get Git commit history for a project
   *
   * Returns an array of commits with hash, date, author, and message.
   * Used by Timeline view to display project history visualization.
   * Also returns shallow repository detection information.
   */
  ipcMain.handle(
    IPC_CHANNELS.GIT_GET_HISTORY,
    async (
      _,
      projectPath: string,
      options?: TimelineGitHistoryOptions
    ): Promise<IPCResult<TimelineGitHistoryResponse>> => {
      try {
        if (!projectPath) {
          return { success: false, error: 'Project path is required' };
        }

        // Map timeline options to changelog git history options
        const gitHistoryOptions = {
          type: 'recent' as const,
          count: options?.limit ?? 500,
          includeMergeCommits: options?.includeMergeCommits ?? true
        };

        // Use existing git-integration function
        const commits = getCommits(projectPath, gitHistoryOptions);

        // If date filtering is requested, apply post-filtering
        let filteredCommits = commits;

        if (options?.since) {
          const sinceDate = new Date(options.since).getTime();
          filteredCommits = filteredCommits.filter(
            commit => new Date(commit.date).getTime() >= sinceDate
          );
        }

        if (options?.until) {
          const untilDate = new Date(options.until).getTime();
          filteredCommits = filteredCommits.filter(
            commit => new Date(commit.date).getTime() <= untilDate
          );
        }

        // Detect shallow repository
        const isShallowRepository = checkIsShallowRepository(projectPath);

        // Get the oldest commit in the fetch
        const oldestCommit = filteredCommits.length > 0
          ? filteredCommits[filteredCommits.length - 1]
          : undefined;

        // Check if the oldest commit has parents (if it does but is at the boundary,
        // the history might be incomplete even in non-shallow repos when using limit)
        let oldestHasParents = false;
        if (oldestCommit) {
          oldestHasParents = checkCommitHasParents(projectPath, oldestCommit.fullHash ?? oldestCommit.hash);
        }

        // Convert to extended format with parent info
        const commitsWithParents: TimelineGitCommitWithParents[] = filteredCommits.map((commit, index) => ({
          ...commit,
          // The oldest commit in our fetch - check if it has parents
          hasParents: index === filteredCommits.length - 1 ? oldestHasParents : true
        }));

        return {
          success: true,
          data: {
            commits: commitsWithParents,
            isShallowRepository,
            oldestCommitHash: oldestCommit?.hash
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get Git history'
        };
      }
    }
  );

  /**
   * Get Git tags for a project
   *
   * Returns an array of tags with name, date, and commit hash.
   * Used by Timeline view to display milestones/releases.
   */
  ipcMain.handle(
    IPC_CHANNELS.GIT_GET_TAGS,
    async (_, projectPath: string): Promise<IPCResult<GitTagInfo[]>> => {
      try {
        if (!projectPath) {
          return { success: false, error: 'Project path is required' };
        }

        // Use existing git-integration function
        const tags = getTags(projectPath);

        return { success: true, data: tags };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get Git tags'
        };
      }
    }
  );
}

/**
 * Check if a repository is a shallow clone
 *
 * Uses `git rev-parse --is-shallow-repository` which reliably detects
 * shallow clones created with `--depth` option.
 */
function checkIsShallowRepository(projectPath: string): boolean {
  try {
    const result = execFileSync(
      getToolPath('git'),
      ['rev-parse', '--is-shallow-repository'],
      {
        cwd: projectPath,
        encoding: 'utf-8'
      }
    ).trim();

    return result === 'true';
  } catch {
    // If the command fails, assume not shallow
    return false;
  }
}

/**
 * Check if a specific commit has parent commits
 *
 * Returns true if the commit has at least one parent.
 * A root/initial commit has no parents.
 */
function checkCommitHasParents(projectPath: string, commitHash: string): boolean {
  try {
    // Use git rev-parse to get parent(s) of the commit
    // If the commit has parents, this returns the parent hash(es)
    // If it's a root commit, this returns empty string
    const result = execFileSync(
      getToolPath('git'),
      ['rev-parse', `${commitHash}^`, '--verify'],
      {
        cwd: projectPath,
        encoding: 'utf-8',
        // Suppress stderr since this will fail for root commits
        stdio: ['pipe', 'pipe', 'pipe']
      }
    ).trim();

    // If we got a result, the commit has parents
    return result.length > 0;
  } catch {
    // If the command fails, the commit has no parents (is a root commit)
    // This happens when trying to get parent of the initial commit
    return false;
  }
}
