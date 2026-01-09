import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  GitCommit,
  GitPullRequest,
  Tag,
  Link2,
  Unlink,
  Plus,
  ExternalLink
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../ui/tooltip';
import { cn } from '../../lib/utils';
import type { Task } from '../../../shared/types';

interface LinkedArtifactsSectionProps {
  task: Task;
  /** Called when user wants to link a new commit */
  onLinkCommit?: () => void;
  /** Called when user wants to link a new PR */
  onLinkPR?: () => void;
  /** Called when user wants to link a new tag */
  onLinkTag?: () => void;
  /** Called when user wants to unlink a commit */
  onUnlinkCommit?: (commitHash: string) => void;
  /** Called when user wants to unlink a PR */
  onUnlinkPR?: (prNumber: number) => void;
  /** Called when user wants to unlink a tag */
  onUnlinkTag?: (tagName: string) => void;
  /** Whether the UI should be interactive (disabled when task is running) */
  disabled?: boolean;
}

/**
 * LinkedArtifactsSection - Displays linked Git artifacts (commits, PRs, tags)
 * and provides UI to link/unlink artifacts from a task.
 */
export function LinkedArtifactsSection({
  task,
  onLinkCommit,
  onLinkPR,
  onLinkTag,
  onUnlinkCommit,
  onUnlinkPR,
  onUnlinkTag,
  disabled = false
}: LinkedArtifactsSectionProps) {
  const { t } = useTranslation(['tasks']);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const linkedCommits = task.metadata?.linkedCommits || [];
  const linkedPRs = task.metadata?.linkedPRs || [];
  const linkedTags = task.metadata?.linkedTags || [];

  const hasAnyLinked = linkedCommits.length > 0 || linkedPRs.length > 0 || linkedTags.length > 0;

  // Format commit hash for display (short version)
  const formatCommitHash = (hash: string) => hash.substring(0, 7);

  // Generate GitHub URL for commit (if project has GitHub configured)
  const getCommitUrl = (hash: string) => {
    // TODO: Get actual repo URL from project settings
    return undefined;
  };

  // Generate GitHub URL for PR (if project has GitHub configured)
  const getPRUrl = (prNumber: number) => {
    // TODO: Get actual repo URL from project settings
    return undefined;
  };

  return (
    <div className="space-y-3">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Link2 className="h-3 w-3 text-blue-400" />
          {t('tasks:linkedArtifacts.title')}
        </h3>

        {/* Link Buttons */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={onLinkCommit}
                disabled={disabled}
              >
                <GitCommit className="h-3.5 w-3.5 mr-1" />
                <Plus className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {t('tasks:linkedArtifacts.linkCommit')}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={onLinkPR}
                disabled={disabled}
              >
                <GitPullRequest className="h-3.5 w-3.5 mr-1" />
                <Plus className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {t('tasks:linkedArtifacts.linkPR')}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={onLinkTag}
                disabled={disabled}
              >
                <Tag className="h-3.5 w-3.5 mr-1" />
                <Plus className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {t('tasks:linkedArtifacts.linkTag')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Linked Items Display */}
      {hasAnyLinked ? (
        <div className="space-y-2">
          {/* Linked Commits */}
          {linkedCommits.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {linkedCommits.map((commitHash) => {
                const isHovered = hoveredItem === `commit-${commitHash}`;
                const commitUrl = getCommitUrl(commitHash);

                return (
                  <div
                    key={commitHash}
                    className="group relative"
                    onMouseEnter={() => setHoveredItem(`commit-${commitHash}`)}
                    onMouseLeave={() => setHoveredItem(null)}
                  >
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-xs font-mono flex items-center gap-1.5 pr-1 transition-colors',
                        'bg-blue-500/10 text-blue-400 border-blue-500/20',
                        isHovered && 'bg-blue-500/20'
                      )}
                    >
                      <GitCommit className="h-3 w-3" />
                      <span>{formatCommitHash(commitHash)}</span>

                      {/* External link button */}
                      {commitUrl && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => window.electronAPI?.openExternal(commitUrl)}
                              className="p-0.5 hover:bg-blue-500/30 rounded transition-colors"
                            >
                              <ExternalLink className="h-2.5 w-2.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {t('tasks:linkedArtifacts.viewOnGitHub')}
                          </TooltipContent>
                        </Tooltip>
                      )}

                      {/* Unlink button */}
                      {!disabled && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => onUnlinkCommit?.(commitHash)}
                              className={cn(
                                'p-0.5 hover:bg-destructive/30 rounded transition-all',
                                'opacity-0 group-hover:opacity-100'
                              )}
                            >
                              <Unlink className="h-2.5 w-2.5 text-destructive" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {t('tasks:linkedArtifacts.unlinkCommit')}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </Badge>

                    {/* Full hash tooltip */}
                    {isHovered && (
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-popover border border-border rounded px-2 py-1 text-xs font-mono shadow-lg z-50 whitespace-nowrap">
                        {commitHash}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Linked PRs */}
          {linkedPRs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {linkedPRs.map((prNumber) => {
                const prUrl = getPRUrl(prNumber);

                return (
                  <div key={prNumber} className="group">
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-xs flex items-center gap-1.5 pr-1 transition-colors',
                        'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                        'hover:bg-emerald-500/20'
                      )}
                    >
                      <GitPullRequest className="h-3 w-3" />
                      <span>#{prNumber}</span>

                      {/* External link button */}
                      {prUrl && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => window.electronAPI?.openExternal(prUrl)}
                              className="p-0.5 hover:bg-emerald-500/30 rounded transition-colors"
                            >
                              <ExternalLink className="h-2.5 w-2.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {t('tasks:linkedArtifacts.viewOnGitHub')}
                          </TooltipContent>
                        </Tooltip>
                      )}

                      {/* Unlink button */}
                      {!disabled && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => onUnlinkPR?.(prNumber)}
                              className={cn(
                                'p-0.5 hover:bg-destructive/30 rounded transition-all',
                                'opacity-0 group-hover:opacity-100'
                              )}
                            >
                              <Unlink className="h-2.5 w-2.5 text-destructive" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {t('tasks:linkedArtifacts.unlinkPR')}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}

          {/* Linked Tags */}
          {linkedTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {linkedTags.map((tagName) => (
                <div key={tagName} className="group">
                  <Badge
                    variant="secondary"
                    className={cn(
                      'text-xs flex items-center gap-1.5 pr-1 transition-colors',
                      'bg-amber-500/10 text-amber-400 border-amber-500/20',
                      'hover:bg-amber-500/20'
                    )}
                  >
                    <Tag className="h-3 w-3" />
                    <span>{tagName}</span>

                    {/* Unlink button */}
                    {!disabled && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => onUnlinkTag?.(tagName)}
                            className={cn(
                              'p-0.5 hover:bg-destructive/30 rounded transition-all',
                              'opacity-0 group-hover:opacity-100'
                            )}
                          >
                            <Unlink className="h-2.5 w-2.5 text-destructive" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {t('tasks:linkedArtifacts.unlinkTag')}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Empty State */
        <div className="text-sm text-muted-foreground italic py-2">
          {t('tasks:linkedArtifacts.noLinkedArtifacts')}
        </div>
      )}
    </div>
  );
}
