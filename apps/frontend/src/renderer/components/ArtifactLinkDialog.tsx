/**
 * ArtifactLinkDialog - Dialog for selecting Git artifacts to link to a task
 *
 * Shows a searchable list of recent commits, open PRs, and tags with checkbox
 * selection for linking to tasks in the Timeline view.
 *
 * Features:
 * - Tabbed interface for Commits, PRs, and Tags
 * - Search filtering within each tab
 * - Checkbox multi-selection
 * - Recent items shown first
 * - Loading states and error handling
 * - Already-linked items shown as disabled
 *
 * @example
 * ```tsx
 * <ArtifactLinkDialog
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   artifactType="commit"
 *   alreadyLinked={['abc123', 'def456']}
 *   onLink={(selected) => handleLink(selected)}
 * />
 * ```
 */
import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  GitCommit,
  GitPullRequest,
  Tag,
  Search,
  Loader2,
  AlertCircle,
  Check,
  RefreshCw
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Checkbox } from './ui/checkbox';
import { ScrollArea } from './ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import { useGitHistory } from '../hooks/useGitHistory';
import type { TimelineGitCommit, TimelineGitTag } from '../../shared/types/git';

/** Type of artifact to link */
export type ArtifactType = 'commit' | 'pr' | 'tag';

/** Props for ArtifactLinkDialog */
export interface ArtifactLinkDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Initial tab to show (commit/pr/tag) */
  artifactType?: ArtifactType;
  /** Already linked commit hashes */
  linkedCommits?: string[];
  /** Already linked PR numbers */
  linkedPRs?: number[];
  /** Already linked tag names */
  linkedTags?: string[];
  /** Callback when user confirms selection */
  onLink: (selection: {
    commits?: string[];
    prs?: number[];
    tags?: string[];
  }) => void;
}

/**
 * Format a date for display in the list
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  }
}

/**
 * Format commit hash for display (short version)
 */
function formatCommitHash(hash: string): string {
  return hash.substring(0, 7);
}

/**
 * Individual commit item in the list
 */
interface CommitItemProps {
  commit: TimelineGitCommit;
  isSelected: boolean;
  isAlreadyLinked: boolean;
  onToggle: () => void;
}

function CommitItem({ commit, isSelected, isAlreadyLinked, onToggle }: CommitItemProps) {
  const { t } = useTranslation(['tasks']);

  return (
    <label
      className={cn(
        'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
        isAlreadyLinked
          ? 'opacity-60 cursor-not-allowed bg-muted/30 border-border'
          : isSelected
          ? 'bg-primary/10 border-primary/30'
          : 'bg-card border-border hover:bg-muted/50'
      )}
    >
      <Checkbox
        checked={isSelected || isAlreadyLinked}
        onCheckedChange={isAlreadyLinked ? undefined : onToggle}
        disabled={isAlreadyLinked}
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Badge
            variant="secondary"
            className="font-mono text-xs bg-blue-500/10 text-blue-400 border-blue-500/20"
          >
            <GitCommit className="h-3 w-3 mr-1" />
            {formatCommitHash(commit.hash)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {formatDate(commit.date)}
          </span>
          {isAlreadyLinked && (
            <Badge variant="outline" className="text-xs">
              {t('tasks:artifactLinkDialog.alreadyLinked')}
            </Badge>
          )}
        </div>
        <p className="text-sm text-foreground truncate">{commit.message}</p>
        <p className="text-xs text-muted-foreground">
          {t('tasks:timeline.commits.by', { author: commit.author })}
        </p>
      </div>
    </label>
  );
}

/**
 * Individual tag item in the list
 */
interface TagItemProps {
  tag: TimelineGitTag;
  isSelected: boolean;
  isAlreadyLinked: boolean;
  onToggle: () => void;
}

function TagItem({ tag, isSelected, isAlreadyLinked, onToggle }: TagItemProps) {
  const { t } = useTranslation(['tasks']);
  const isRelease = /^v?\d+(\.\d+)*(-[\w.]+)?$/.test(tag.name) ||
                    /^release[-/]?\d/.test(tag.name.toLowerCase());

  return (
    <label
      className={cn(
        'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
        isAlreadyLinked
          ? 'opacity-60 cursor-not-allowed bg-muted/30 border-border'
          : isSelected
          ? 'bg-primary/10 border-primary/30'
          : 'bg-card border-border hover:bg-muted/50'
      )}
    >
      <Checkbox
        checked={isSelected || isAlreadyLinked}
        onCheckedChange={isAlreadyLinked ? undefined : onToggle}
        disabled={isAlreadyLinked}
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Badge
            variant="secondary"
            className={cn(
              'text-xs',
              isRelease
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            )}
          >
            <Tag className="h-3 w-3 mr-1" />
            {tag.name}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {formatDate(tag.date)}
          </span>
          {isAlreadyLinked && (
            <Badge variant="outline" className="text-xs">
              {t('tasks:artifactLinkDialog.alreadyLinked')}
            </Badge>
          )}
        </div>
        {tag.description && (
          <p className="text-sm text-muted-foreground truncate">{tag.description}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {isRelease
            ? t('tasks:timeline.tags.release')
            : t('tasks:timeline.tags.tag')}
        </p>
      </div>
    </label>
  );
}

/**
 * PR item placeholder (PRs need additional API support)
 */
interface PRItemProps {
  prNumber: number;
  title: string;
  isSelected: boolean;
  isAlreadyLinked: boolean;
  onToggle: () => void;
}

function PRItem({ prNumber, title, isSelected, isAlreadyLinked, onToggle }: PRItemProps) {
  const { t } = useTranslation(['tasks']);

  return (
    <label
      className={cn(
        'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
        isAlreadyLinked
          ? 'opacity-60 cursor-not-allowed bg-muted/30 border-border'
          : isSelected
          ? 'bg-primary/10 border-primary/30'
          : 'bg-card border-border hover:bg-muted/50'
      )}
    >
      <Checkbox
        checked={isSelected || isAlreadyLinked}
        onCheckedChange={isAlreadyLinked ? undefined : onToggle}
        disabled={isAlreadyLinked}
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Badge
            variant="secondary"
            className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
          >
            <GitPullRequest className="h-3 w-3 mr-1" />
            #{prNumber}
          </Badge>
          {isAlreadyLinked && (
            <Badge variant="outline" className="text-xs">
              {t('tasks:artifactLinkDialog.alreadyLinked')}
            </Badge>
          )}
        </div>
        <p className="text-sm text-foreground truncate">{title}</p>
      </div>
    </label>
  );
}

/**
 * Empty state component
 */
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
      <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

/**
 * Loading state component
 */
function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
      <Loader2 className="h-8 w-8 mb-2 animate-spin" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

/**
 * Main ArtifactLinkDialog component
 */
export function ArtifactLinkDialog({
  open,
  onOpenChange,
  artifactType = 'commit',
  linkedCommits = [],
  linkedPRs = [],
  linkedTags = [],
  onLink
}: ArtifactLinkDialogProps) {
  const { t } = useTranslation(['tasks', 'common']);

  // Git history data
  const {
    commits,
    tags,
    isLoading,
    error,
    refresh
  } = useGitHistory({
    initialLimit: 100,
    autoFetch: true
  });

  // Tab state
  const [activeTab, setActiveTab] = useState<ArtifactType>(artifactType);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Selection state
  const [selectedCommits, setSelectedCommits] = useState<Set<string>>(new Set());
  const [selectedPRs, setSelectedPRs] = useState<Set<number>>(new Set());
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  // Reset state when dialog opens
  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (newOpen) {
      // Reset selections when opening
      setSelectedCommits(new Set());
      setSelectedPRs(new Set());
      setSelectedTags(new Set());
      setSearchQuery('');
      setActiveTab(artifactType);
    }
    onOpenChange(newOpen);
  }, [onOpenChange, artifactType]);

  // Sets for O(1) lookup
  const linkedCommitSet = useMemo(() => new Set(linkedCommits), [linkedCommits]);
  const linkedPRSet = useMemo(() => new Set(linkedPRs), [linkedPRs]);
  const linkedTagSet = useMemo(() => new Set(linkedTags), [linkedTags]);

  // Filtered commits based on search
  const filteredCommits = useMemo(() => {
    if (!searchQuery.trim()) return commits;
    const query = searchQuery.toLowerCase();
    return commits.filter(
      (c) =>
        c.message.toLowerCase().includes(query) ||
        c.hash.toLowerCase().includes(query) ||
        c.author.toLowerCase().includes(query)
    );
  }, [commits, searchQuery]);

  // Filtered tags based on search
  const filteredTags = useMemo(() => {
    if (!searchQuery.trim()) return tags;
    const query = searchQuery.toLowerCase();
    return tags.filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        (t.description?.toLowerCase().includes(query) ?? false)
    );
  }, [tags, searchQuery]);

  // Toggle commit selection
  const toggleCommit = useCallback((hash: string) => {
    setSelectedCommits((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) {
        next.delete(hash);
      } else {
        next.add(hash);
      }
      return next;
    });
  }, []);

  // Toggle PR selection
  const togglePR = useCallback((prNumber: number) => {
    setSelectedPRs((prev) => {
      const next = new Set(prev);
      if (next.has(prNumber)) {
        next.delete(prNumber);
      } else {
        next.add(prNumber);
      }
      return next;
    });
  }, []);

  // Toggle tag selection
  const toggleTag = useCallback((tagName: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagName)) {
        next.delete(tagName);
      } else {
        next.add(tagName);
      }
      return next;
    });
  }, []);

  // Handle link confirmation
  const handleConfirm = useCallback(() => {
    const selection: { commits?: string[]; prs?: number[]; tags?: string[] } = {};

    if (selectedCommits.size > 0) {
      selection.commits = Array.from(selectedCommits);
    }
    if (selectedPRs.size > 0) {
      selection.prs = Array.from(selectedPRs);
    }
    if (selectedTags.size > 0) {
      selection.tags = Array.from(selectedTags);
    }

    onLink(selection);
    onOpenChange(false);
  }, [selectedCommits, selectedPRs, selectedTags, onLink, onOpenChange]);

  // Total selection count
  const totalSelected = selectedCommits.size + selectedPRs.size + selectedTags.size;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {activeTab === 'commit' && <GitCommit className="h-5 w-5 text-blue-400" />}
            {activeTab === 'pr' && <GitPullRequest className="h-5 w-5 text-emerald-400" />}
            {activeTab === 'tag' && <Tag className="h-5 w-5 text-amber-400" />}
            {t('tasks:artifactLinkDialog.title')}
          </DialogTitle>
          <DialogDescription>
            {t('tasks:artifactLinkDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value as ArtifactType);
            setSearchQuery('');
          }}
          className="flex-1 flex flex-col min-h-0"
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="commit" className="flex items-center gap-1.5">
              <GitCommit className="h-4 w-4" />
              {t('tasks:artifactLinkDialog.tabs.commits')}
              {selectedCommits.size > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                  {selectedCommits.size}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="pr" className="flex items-center gap-1.5">
              <GitPullRequest className="h-4 w-4" />
              {t('tasks:artifactLinkDialog.tabs.prs')}
              {selectedPRs.size > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                  {selectedPRs.size}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="tag" className="flex items-center gap-1.5">
              <Tag className="h-4 w-4" />
              {t('tasks:artifactLinkDialog.tabs.tags')}
              {selectedTags.size > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                  {selectedTags.size}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Search Input */}
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('tasks:artifactLinkDialog.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Error State */}
          {error && (
            <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="flex-1">{error}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={refresh}
                className="h-7 px-2"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* Commits Tab */}
          <TabsContent value="commit" className="flex-1 min-h-0 mt-2">
            <ScrollArea className="h-[300px] pr-4">
              {isLoading ? (
                <LoadingState message={t('tasks:artifactLinkDialog.loadingCommits')} />
              ) : filteredCommits.length === 0 ? (
                <EmptyState
                  message={
                    searchQuery
                      ? t('tasks:artifactLinkDialog.noMatchingCommits')
                      : t('tasks:artifactLinkDialog.noCommits')
                  }
                />
              ) : (
                <div className="space-y-2">
                  {filteredCommits.map((commit) => (
                    <CommitItem
                      key={commit.hash}
                      commit={commit}
                      isSelected={selectedCommits.has(commit.hash)}
                      isAlreadyLinked={linkedCommitSet.has(commit.hash)}
                      onToggle={() => toggleCommit(commit.hash)}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* PRs Tab */}
          <TabsContent value="pr" className="flex-1 min-h-0 mt-2">
            <ScrollArea className="h-[300px] pr-4">
              {/* PRs require GitHub API integration - show placeholder for now */}
              <EmptyState message={t('tasks:artifactLinkDialog.prsComingSoon')} />
            </ScrollArea>
          </TabsContent>

          {/* Tags Tab */}
          <TabsContent value="tag" className="flex-1 min-h-0 mt-2">
            <ScrollArea className="h-[300px] pr-4">
              {isLoading ? (
                <LoadingState message={t('tasks:artifactLinkDialog.loadingTags')} />
              ) : filteredTags.length === 0 ? (
                <EmptyState
                  message={
                    searchQuery
                      ? t('tasks:artifactLinkDialog.noMatchingTags')
                      : t('tasks:artifactLinkDialog.noTags')
                  }
                />
              ) : (
                <div className="space-y-2">
                  {filteredTags.map((tag) => (
                    <TagItem
                      key={tag.name}
                      tag={tag}
                      isSelected={selectedTags.has(tag.name)}
                      isAlreadyLinked={linkedTagSet.has(tag.name)}
                      onToggle={() => toggleTag(tag.name)}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex-shrink-0 mt-4">
          <div className="flex items-center gap-2 mr-auto text-sm text-muted-foreground">
            {totalSelected > 0 && (
              <>
                <Check className="h-4 w-4 text-primary" />
                {t('tasks:artifactLinkDialog.selectedCount', { count: totalSelected })}
              </>
            )}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:buttons.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={totalSelected === 0}>
            {t('tasks:artifactLinkDialog.linkSelected')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
