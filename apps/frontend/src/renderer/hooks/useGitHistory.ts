import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useProjectStore } from '../stores/project-store';
import type {
  GitCommit,
  GitTagInfo,
  Project
} from '../../shared/types';
import type {
  TimelineGitCommit,
  TimelineGitTag,
  TimelineGitHistoryOptions,
  TimelineMilestone
} from '../../shared/types/git';

// Re-export for type inference in store selectors
interface ProjectState {
  projects: Project[];
  selectedProjectId: string | null;
}

/**
 * Options for the useGitHistory hook
 */
export interface UseGitHistoryOptions {
  /** Initial limit for commits to load (default: 100) */
  initialLimit?: number;
  /** Increment for lazy loading (default: 100) */
  loadMoreIncrement?: number;
  /** Whether to auto-fetch on mount (default: true) */
  autoFetch?: boolean;
  /** Include merge commits (default: true) */
  includeMergeCommits?: boolean;
}

/**
 * Return type for the useGitHistory hook
 */
export interface UseGitHistoryReturn {
  // Data
  commits: TimelineGitCommit[];
  tags: TimelineGitTag[];
  milestones: TimelineMilestone[];
  genesisDate: Date | null;
  firstReleaseTag: TimelineGitTag | null;
  isShallowHistory: boolean;
  totalCommitCount: number;

  // Loading states
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;

  // Actions
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;

  // Computed values
  getCommitsByDate: (date: Date) => TimelineGitCommit[];
  getCommitsInRange: (start: Date, end: Date) => TimelineGitCommit[];
  getMilestonesByDate: (date: Date) => TimelineMilestone[];
  getCommitById: (hash: string) => TimelineGitCommit | undefined;

  // Cache info
  lastFetchedAt: Date | null;
}

/**
 * Convert GitCommit (from changelog) to TimelineGitCommit
 */
function toTimelineCommit(commit: GitCommit): TimelineGitCommit {
  return {
    hash: commit.hash,
    fullHash: commit.fullHash,
    date: commit.date,
    author: commit.author,
    authorEmail: commit.authorEmail,
    message: commit.subject,
    body: commit.body,
    linkedTaskIds: [], // Will be populated by task linking
    filesChanged: commit.filesChanged,
    insertions: commit.insertions,
    deletions: commit.deletions,
    hasParents: true // Assume true, will check for shallow detection
  };
}

/**
 * Convert GitTagInfo to TimelineGitTag
 */
function toTimelineTag(tag: GitTagInfo): TimelineGitTag {
  return {
    name: tag.name,
    date: tag.date ?? new Date().toISOString(),
    commitHash: tag.commit ?? '',
    description: undefined,
    isAnnotated: undefined
  };
}

/**
 * Detect if a tag looks like a release tag (version-like)
 */
function isReleaseTag(tagName: string): boolean {
  // Match patterns like: v1.0.0, 1.0.0, release-1.0, v0.1, etc.
  return /^v?\d+(\.\d+)*(-[\w.]+)?$/.test(tagName) ||
         /^release[-/]?\d/.test(tagName.toLowerCase());
}

/**
 * Create a milestone from a tag
 */
function tagToMilestone(tag: TimelineGitTag): TimelineMilestone {
  const isRelease = isReleaseTag(tag.name);
  return {
    id: `tag-${tag.name}`,
    name: tag.name,
    date: tag.date,
    type: isRelease ? 'release' : 'tag',
    tagName: tag.name,
    description: tag.description
  };
}

/**
 * Hook to fetch and cache Git history for the current project with lazy loading support.
 *
 * Features:
 * - Fetches commits and tags for the currently selected project
 * - Caches results to avoid redundant API calls
 * - Supports lazy loading for large histories
 * - Provides computed values for date-based lookups
 * - Detects shallow history (incomplete git clone)
 *
 * @example
 * ```tsx
 * const {
 *   commits,
 *   tags,
 *   milestones,
 *   genesisDate,
 *   isLoading,
 *   loadMore,
 *   hasMore
 * } = useGitHistory({
 *   initialLimit: 100,
 *   autoFetch: true
 * });
 * ```
 */
export function useGitHistory(
  options: UseGitHistoryOptions = {}
): UseGitHistoryReturn {
  const {
    initialLimit = 100,
    loadMoreIncrement = 100,
    autoFetch = true,
    includeMergeCommits = true
  } = options;

  // Get current project
  const selectedProject = useProjectStore((state: ProjectState) =>
    state.projects.find((p: Project) => p.id === state.selectedProjectId)
  );
  const projectPath = selectedProject?.path ?? null;

  // State
  const [commits, setCommits] = useState<TimelineGitCommit[]>([]);
  const [tags, setTags] = useState<TimelineGitTag[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [currentLimit, setCurrentLimit] = useState(initialLimit);
  const [totalCommitCount, setTotalCommitCount] = useState(0);

  // Refs for caching
  const cacheKeyRef = useRef<string | null>(null);
  const fetchInProgressRef = useRef(false);

  /**
   * Fetch git history from the main process
   */
  const fetchHistory = useCallback(async (limit: number, isLoadingMore = false) => {
    if (!projectPath) {
      setError('No project selected');
      return;
    }

    // Prevent concurrent fetches
    if (fetchInProgressRef.current) {
      return;
    }

    fetchInProgressRef.current = true;

    if (isLoadingMore) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const historyOptions: TimelineGitHistoryOptions = {
        limit,
        includeMergeCommits
      };

      // Fetch commits and tags in parallel
      const [historyResult, tagsResult] = await Promise.all([
        window.electronAPI.getGitHistory(projectPath, historyOptions),
        window.electronAPI.getGitTags(projectPath)
      ]);

      if (!historyResult.success) {
        throw new Error(historyResult.error ?? 'Failed to fetch Git history');
      }

      if (!tagsResult.success) {
        throw new Error(tagsResult.error ?? 'Failed to fetch Git tags');
      }

      const rawCommits = historyResult.data ?? [];
      const rawTags = tagsResult.data ?? [];

      // Convert to timeline types
      const timelineCommits = rawCommits.map(toTimelineCommit);
      const timelineTags = rawTags.map(toTimelineTag);

      // Sort commits by date (newest first)
      timelineCommits.sort((a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      // Sort tags by date (newest first)
      timelineTags.sort((a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      setCommits(timelineCommits);
      setTags(timelineTags);
      setTotalCommitCount(timelineCommits.length);
      setCurrentLimit(limit);
      setLastFetchedAt(new Date());
      cacheKeyRef.current = projectPath;

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error fetching git history';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
      fetchInProgressRef.current = false;
    }
  }, [projectPath, includeMergeCommits]);

  /**
   * Refresh the git history (re-fetch from scratch)
   */
  const refresh = useCallback(async () => {
    cacheKeyRef.current = null; // Invalidate cache
    await fetchHistory(initialLimit, false);
  }, [fetchHistory, initialLimit]);

  /**
   * Load more commits (lazy loading)
   */
  const loadMore = useCallback(async () => {
    const newLimit = currentLimit + loadMoreIncrement;
    await fetchHistory(newLimit, true);
  }, [fetchHistory, currentLimit, loadMoreIncrement]);

  // Auto-fetch on mount or when project changes
  useEffect(() => {
    if (!autoFetch || !projectPath) {
      return;
    }

    // Check if we need to fetch (different project or no cache)
    if (cacheKeyRef.current !== projectPath) {
      fetchHistory(initialLimit, false);
    }
  }, [autoFetch, projectPath, fetchHistory, initialLimit]);

  // Computed values
  const genesisDate = useMemo((): Date | null => {
    if (commits.length === 0) return null;
    // Genesis is the oldest commit (last in the sorted array)
    const oldestCommit = commits[commits.length - 1];
    return oldestCommit ? new Date(oldestCommit.date) : null;
  }, [commits]);

  const firstReleaseTag = useMemo((): TimelineGitTag | null => {
    // Find the first (oldest) release-like tag
    const releaseTags = tags.filter((t: TimelineGitTag) => isReleaseTag(t.name));
    if (releaseTags.length === 0) return null;
    // Return the oldest release tag
    return releaseTags[releaseTags.length - 1] ?? null;
  }, [tags]);

  const isShallowHistory = useMemo((): boolean => {
    if (commits.length === 0) return false;
    // Check if the oldest commit has no parents and there are many commits
    // This is a heuristic - shallow clones usually have commits without parents
    // at the boundary
    const oldestCommit = commits[commits.length - 1];
    // If we fetched the max limit and the oldest commit appears to be cut off,
    // it might be shallow
    return commits.length >= currentLimit && oldestCommit?.hasParents === false;
  }, [commits, currentLimit]);

  const milestones = useMemo((): TimelineMilestone[] => {
    return tags.map(tagToMilestone);
  }, [tags]);

  const hasMore = useMemo((): boolean => {
    // If we got exactly the limit, there might be more
    return commits.length === currentLimit;
  }, [commits.length, currentLimit]);

  /**
   * Get commits on a specific date
   */
  const getCommitsByDate = useCallback((date: Date): TimelineGitCommit[] => {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    return commits.filter((commit: TimelineGitCommit) => {
      const commitDate = new Date(commit.date);
      return commitDate >= dayStart && commitDate <= dayEnd;
    });
  }, [commits]);

  /**
   * Get commits within a date range
   */
  const getCommitsInRange = useCallback((start: Date, end: Date): TimelineGitCommit[] => {
    return commits.filter((commit: TimelineGitCommit) => {
      const commitDate = new Date(commit.date);
      return commitDate >= start && commitDate <= end;
    });
  }, [commits]);

  /**
   * Get milestones on a specific date
   */
  const getMilestonesByDate = useCallback((date: Date): TimelineMilestone[] => {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    return milestones.filter((milestone: TimelineMilestone) => {
      const milestoneDate = new Date(milestone.date);
      return milestoneDate >= dayStart && milestoneDate <= dayEnd;
    });
  }, [milestones]);

  /**
   * Get a commit by its hash
   */
  const getCommitById = useCallback((hash: string): TimelineGitCommit | undefined => {
    return commits.find((c: TimelineGitCommit) => c.hash === hash || c.fullHash === hash);
  }, [commits]);

  return {
    // Data
    commits,
    tags,
    milestones,
    genesisDate,
    firstReleaseTag,
    isShallowHistory,
    totalCommitCount,

    // Loading states
    isLoading,
    isLoadingMore,
    error,

    // Actions
    refresh,
    loadMore,
    hasMore,

    // Computed values
    getCommitsByDate,
    getCommitsInRange,
    getMilestonesByDate,
    getCommitById,

    // Cache info
    lastFetchedAt
  };
}
