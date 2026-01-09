/**
 * Git-related types for Timeline/Gantt view
 *
 * These types are specifically designed for the Timeline view,
 * supporting task-to-artifact linking and project history visualization.
 */

/**
 * Git commit representation for Timeline view
 *
 * Contains essential commit information plus task linking capability.
 * Used to display commits as markers on the timeline and show
 * relationships between code changes and tasks.
 */
export interface TimelineGitCommit {
  /** Short commit hash (7 characters) */
  hash: string;

  /** Full commit hash (40 characters) */
  fullHash?: string;

  /** Commit date in ISO format */
  date: string;

  /** Author name */
  author: string;

  /** Author email (optional) */
  authorEmail?: string;

  /** Commit message (first line / subject) */
  message: string;

  /** Full commit body (optional) */
  body?: string;

  /**
   * IDs of tasks linked to this commit.
   * Tasks can be linked manually via UI or auto-detected
   * from commit messages mentioning spec/task IDs.
   */
  linkedTaskIds: string[];

  /** Number of files changed in this commit (optional) */
  filesChanged?: number;

  /** Number of line insertions (optional) */
  insertions?: number;

  /** Number of line deletions (optional) */
  deletions?: number;

  /**
   * Whether this commit has parent commits.
   * Used to detect shallow clones where history may be incomplete.
   */
  hasParents?: boolean;
}

/**
 * Git tag representation for Timeline view
 *
 * Used to display release milestones on the timeline.
 * Tags typically represent versions/releases and are shown
 * as vertical milestone markers.
 */
export interface TimelineGitTag {
  /** Tag name (e.g., 'v1.0.0', 'release-2024-01') */
  name: string;

  /** Tag creation date in ISO format */
  date: string;

  /** Hash of the commit this tag points to */
  commitHash: string;

  /**
   * Tag description/message.
   * For annotated tags, this contains the tag message.
   * For lightweight tags, this may be empty.
   */
  description?: string;

  /** Whether this is an annotated tag (vs lightweight) */
  isAnnotated?: boolean;

  /** Tagger name (for annotated tags) */
  tagger?: string;

  /** Tagger email (for annotated tags) */
  taggerEmail?: string;
}

/**
 * Options for fetching Git history in Timeline view
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

  /** Filter commits by author */
  author?: string;

  /** Filter commits by file path */
  path?: string;
}

/**
 * Result of fetching Git history for Timeline view
 */
export interface TimelineGitHistory {
  /** Array of commits, ordered from newest to oldest */
  commits: TimelineGitCommit[];

  /** Array of tags */
  tags: TimelineGitTag[];

  /** The earliest commit date in the history */
  genesisDate?: string;

  /** The first release tag (typically v0.1.0, v1.0.0, etc.) */
  firstReleaseTag?: TimelineGitTag;

  /**
   * Whether the history appears to be shallow (incomplete).
   * True if the earliest commit has no parents but isn't
   * the initial commit (root commit).
   */
  isShallowHistory?: boolean;

  /** Total number of commits in the repository (if known) */
  totalCommitCount?: number;
}

/**
 * Represents a milestone on the timeline
 * Can be derived from tags or manually created
 */
export interface TimelineMilestone {
  /** Unique identifier */
  id: string;

  /** Milestone name/label */
  name: string;

  /** Date in ISO format */
  date: string;

  /** Type of milestone */
  type: 'tag' | 'release' | 'custom';

  /** Associated tag name (if type is 'tag' or 'release') */
  tagName?: string;

  /** Description or notes */
  description?: string;

  /** Color for visual styling (optional) */
  color?: string;
}
