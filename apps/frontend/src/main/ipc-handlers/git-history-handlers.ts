import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type {
  IPCResult,
  GitCommit,
  GitTagInfo
} from '../../shared/types';
import { getTags, getCommits } from '../changelog/git-integration';

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
   */
  ipcMain.handle(
    IPC_CHANNELS.GIT_GET_HISTORY,
    async (
      _,
      projectPath: string,
      options?: TimelineGitHistoryOptions
    ): Promise<IPCResult<GitCommit[]>> => {
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

        return { success: true, data: filteredCommits };
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
