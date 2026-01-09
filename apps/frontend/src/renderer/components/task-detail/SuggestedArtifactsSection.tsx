import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  GitCommit,
  Lightbulb,
  Plus,
  Check,
  Loader2,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible';
import { cn } from '../../lib/utils';
import { useGitHistory } from '../../hooks/useGitHistory';
import type { Task } from '../../../shared/types';
import type { TimelineGitCommit } from '../../../shared/types/git';

interface SuggestedArtifactsSectionProps {
  task: Task;
  /** Called when user wants to link a suggested commit */
  onLinkCommit?: (commitHash: string) => void;
  /** Called when user wants to link multiple commits at once */
  onLinkMultipleCommits?: (commitHashes: string[]) => void;
  /** Whether the UI should be interactive (disabled when task is running) */
  disabled?: boolean;
}

/**
 * Get the best identifier for a commit (fullHash preferred, falls back to hash)
 */
function getCommitIdentifier(commit: TimelineGitCommit): string {
  return commit.fullHash || commit.hash;
}

/**
 * Extract patterns to search for from a task
 * Returns an array of search patterns (spec ID, spec number, variations)
 */
function getSearchPatterns(task: Task): string[] {
  const patterns: string[] = [];

  // Add spec ID (e.g., "028-timeline-gantt-view")
  if (task.specId) {
    patterns.push(task.specId.toLowerCase());

    // Extract just the number part (e.g., "028")
    const specNumber = task.specId.match(/^(\d+)/);
    if (specNumber) {
      patterns.push(specNumber[1]);
    }

    // Add spec name without number (e.g., "timeline-gantt-view")
    const specNameMatch = task.specId.match(/^\d+-(.+)$/);
    if (specNameMatch) {
      patterns.push(specNameMatch[1].toLowerCase());
    }
  }

  // Add common prefixes used in commit messages
  // e.g., "auto-claude: 028" or "[028]" or "#028"
  const specNumber = task.specId.match(/^(\d+)/)?.[1];
  if (specNumber) {
    patterns.push(`auto-claude: ${specNumber}`);
    patterns.push(`[${specNumber}]`);
    patterns.push(`#${specNumber}`);
  }

  return patterns;
}

/**
 * Check if a commit message mentions any of the search patterns
 */
function commitMatchesTask(commit: TimelineGitCommit, patterns: string[]): boolean {
  const message = (commit.message + ' ' + (commit.body || '')).toLowerCase();

  return patterns.some(pattern => {
    // For numeric patterns, ensure they're word-bounded to avoid false positives
    // e.g., "028" should match "028-feature" but not "10028"
    if (/^\d+$/.test(pattern)) {
      // Match if preceded by start, space, colon, slash, hyphen, bracket, or hash
      // And followed by end, space, hyphen, bracket, colon, or dot
      const regex = new RegExp(`(?:^|[\\s:/\\-\\[#])${pattern}(?:[\\s\\-\\]:.]|$)`);
      return regex.test(message);
    }
    // For other patterns, simple substring match
    return message.includes(pattern);
  });
}

/**
 * SuggestedArtifactsSection - Shows commits that mention the task ID
 * and suggests linking them to the task.
 */
export function SuggestedArtifactsSection({
  task,
  onLinkCommit,
  onLinkMultipleCommits,
  disabled = false
}: SuggestedArtifactsSectionProps) {
  const { t } = useTranslation(['tasks']);
  const { commits, isLoading } = useGitHistory({ autoFetch: true });
  const [isOpen, setIsOpen] = useState(true);
  const [linkingHashes, setLinkingHashes] = useState<Set<string>>(new Set());
  const [isLinkingAll, setIsLinkingAll] = useState(false);

  // Get already linked commits
  const linkedCommits = useMemo(() =>
    new Set(task.metadata?.linkedCommits || []),
    [task.metadata?.linkedCommits]
  );

  // Get search patterns for this task
  const searchPatterns = useMemo(() =>
    getSearchPatterns(task),
    [task]
  );

  // Find commits that match the task but aren't already linked
  const suggestedCommits = useMemo(() => {
    if (!commits.length || !searchPatterns.length) return [];

    return commits.filter(commit => {
      const commitId = getCommitIdentifier(commit);
      // Skip if already linked (check both hash and fullHash)
      if (linkedCommits.has(commit.hash) || linkedCommits.has(commitId)) {
        return false;
      }
      // Check if commit mentions the task
      return commitMatchesTask(commit, searchPatterns);
    }).slice(0, 10); // Limit to 10 suggestions
  }, [commits, searchPatterns, linkedCommits]);

  // Format commit hash for display (short version)
  const formatCommitHash = (hash: string) => hash.substring(0, 7);

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
    });
  };

  // Handle linking a single commit
  const handleLinkCommit = async (commitHash: string) => {
    if (disabled || linkingHashes.has(commitHash)) return;

    setLinkingHashes(prev => new Set(prev).add(commitHash));
    try {
      await onLinkCommit?.(commitHash);
    } finally {
      setLinkingHashes(prev => {
        const next = new Set(prev);
        next.delete(commitHash);
        return next;
      });
    }
  };

  // Handle linking all suggested commits
  const handleLinkAll = async () => {
    if (disabled || isLinkingAll || suggestedCommits.length === 0) return;

    setIsLinkingAll(true);
    try {
      const hashes = suggestedCommits.map(c => getCommitIdentifier(c));
      await onLinkMultipleCommits?.(hashes);
    } finally {
      setIsLinkingAll(false);
    }
  };

  // Don't show if loading, no suggestions, or patterns are empty
  if (isLoading || suggestedCommits.length === 0) {
    return null;
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide',
              'text-amber-500 dark:text-amber-400',
              'hover:text-amber-600 dark:hover:text-amber-300 transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 rounded'
            )}
          >
            <Lightbulb className="h-3 w-3" />
            {t('tasks:linkedArtifacts.suggestions.title')}
            <Badge
              variant="outline"
              className="ml-1 h-4 px-1 text-[10px] font-normal border-amber-500/30 text-amber-500"
            >
              {suggestedCommits.length}
            </Badge>
            {isOpen ? (
              <ChevronUp className="h-3 w-3 ml-1" />
            ) : (
              <ChevronDown className="h-3 w-3 ml-1" />
            )}
          </button>
        </CollapsibleTrigger>

        {/* Link All Button */}
        {suggestedCommits.length > 1 && onLinkMultipleCommits && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-amber-500 hover:text-amber-600 hover:bg-amber-500/10"
                onClick={handleLinkAll}
                disabled={disabled || isLinkingAll}
              >
                {isLinkingAll ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <Check className="h-3 w-3 mr-1" />
                )}
                {t('tasks:linkedArtifacts.suggestions.linkAll')}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {t('tasks:linkedArtifacts.suggestions.linkAllTooltip', { count: suggestedCommits.length })}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <CollapsibleContent>
        {/* Suggestions Description */}
        <p className="text-xs text-muted-foreground mt-1.5 mb-2">
          {t('tasks:linkedArtifacts.suggestions.description')}
        </p>

        {/* Suggested Commits List */}
        <div className="space-y-1.5">
          {suggestedCommits.map((commit) => {
            const commitId = getCommitIdentifier(commit);
            const isLinking = linkingHashes.has(commitId);

            return (
              <div
                key={commitId}
                className={cn(
                  'group flex items-center gap-2 py-1.5 px-2 rounded-md',
                  'bg-amber-500/5 hover:bg-amber-500/10 transition-colors',
                  'border border-amber-500/10'
                )}
              >
                <GitCommit className="h-3.5 w-3.5 text-amber-500 shrink-0" />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-amber-600 dark:text-amber-400">
                      {formatCommitHash(commit.hash)}
                    </code>
                    <span className="text-xs text-muted-foreground truncate">
                      {commit.message}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                    {commit.author} · {formatDate(commit.date)}
                  </div>
                </div>

                {/* Link Button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        'h-6 w-6 p-0 shrink-0',
                        'opacity-0 group-hover:opacity-100 transition-opacity',
                        'text-amber-500 hover:text-amber-600 hover:bg-amber-500/20'
                      )}
                      onClick={() => handleLinkCommit(commitId)}
                      disabled={disabled || isLinking}
                    >
                      {isLinking ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    {t('tasks:linkedArtifacts.linkCommit')}
                  </TooltipContent>
                </Tooltip>
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
