import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { useMergeProgress, useMergeHealth, useMergeHistory } from '../stores/merge-store';
import type { MergeProgress, MergeHealth, MergeAttempt, MergeProgressConflict } from '../../shared/types';

interface MergeStatusIndicatorProps {
  taskId: string;
  className?: string;
  compact?: boolean; // Compact mode for smaller displays (e.g., task card)
  showHistory?: boolean; // Whether to show merge history
  maxConflicts?: number; // Max conflicts to display before truncating (default: 5)
}

// Health display configuration (colors only - labels are translated)
const HEALTH_COLORS: Record<MergeHealth, { color: string; bgColor: string; textColor: string }> = {
  pass: { color: 'bg-success', bgColor: 'bg-success/20', textColor: 'text-success' },
  warning: { color: 'bg-warning', bgColor: 'bg-warning/20', textColor: 'text-warning' },
  fail: { color: 'bg-destructive', bgColor: 'bg-destructive/20', textColor: 'text-destructive' },
};

// Health label translation keys
const HEALTH_LABEL_KEYS: Record<MergeHealth, string> = {
  pass: 'merge.health.pass',
  warning: 'merge.health.warning',
  fail: 'merge.health.fail',
};

/**
 * MergeStatusIndicator - Displays real-time merge progress, health badge, and conflict information
 *
 * Features:
 * - Real-time progress bar showing merge percentage
 * - Three-state health badge (pass/warning/fail)
 * - Expandable conflict list with resolution status
 * - Optional merge history display
 *
 * Usage:
 * ```tsx
 * <MergeStatusIndicator taskId={task.id} />
 * <MergeStatusIndicator taskId={task.id} compact showHistory={false} />
 * ```
 */
export function MergeStatusIndicator({
  taskId,
  className,
  compact = false,
  showHistory = false,
  maxConflicts = 5,
}: MergeStatusIndicatorProps) {
  const { t } = useTranslation('tasks');

  // Get merge data from store
  const progress = useMergeProgress(taskId);
  const health = useMergeHealth(taskId);
  const history = useMergeHistory(taskId);

  // If no active merge and no history, show nothing
  if (!progress && history.length === 0) {
    return null;
  }

  // Use active progress or latest history for display
  const displayData = progress || (history.length > 0 ? historyToProgress(history[history.length - 1]) : null);

  if (!displayData) {
    return null;
  }

  const colors = HEALTH_COLORS[health];
  const isMerging = displayData.status === 'merging' || displayData.status === 'resolving';
  const isComplete = displayData.status === 'complete';
  const isFailed = displayData.status === 'failed' || displayData.status === 'timeout';

  const conflictCount = displayData.conflicts?.length || 0;
  const resolvedCount = displayData.conflictsResolved || 0;

  return (
    <div className={cn('space-y-2', className)}>
      {/* Header row with label and health badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {isMerging ? t('merge.labels.merging', 'Merging') : t('merge.labels.mergeStatus', 'Merge')}
          </span>
          {isMerging && (
            <motion.div
              className={cn('h-1.5 w-1.5 rounded-full', colors.color)}
              animate={{
                scale: [1, 1.5, 1],
                opacity: [1, 0.5, 1],
              }}
              transition={{
                duration: 1,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          )}
        </div>
        <MergeHealthBadge health={health} compact={compact} />
      </div>

      {/* Progress bar */}
      <MergeProgressBar
        progress={displayData.progress}
        health={health}
        isMerging={isMerging}
        isComplete={isComplete}
        isFailed={isFailed}
      />

      {/* Current step indicator (only when merging) */}
      {isMerging && displayData.currentStep && !compact && (
        <motion.div
          className="text-[10px] text-muted-foreground truncate"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {displayData.currentStep}
        </motion.div>
      )}

      {/* Conflict list */}
      {conflictCount > 0 && !compact && (
        <ConflictList
          conflicts={displayData.conflicts || []}
          resolvedCount={resolvedCount}
          maxDisplay={maxConflicts}
        />
      )}

      {/* Compact conflict summary */}
      {conflictCount > 0 && compact && (
        <div className="text-[10px] text-muted-foreground">
          {conflictCount} {conflictCount === 1 ? t('merge.labels.conflict', 'conflict') : t('merge.labels.conflicts', 'conflicts')}
          {resolvedCount > 0 && (
            <span className="text-success ml-1">
              ({resolvedCount} {t('merge.labels.resolved', 'resolved')})
            </span>
          )}
        </div>
      )}

      {/* Merge history (optional) */}
      {showHistory && history.length > 0 && !compact && (
        <MergeHistoryList history={history} />
      )}
    </div>
  );
}

/**
 * Health badge component showing merge health status
 */
function MergeHealthBadge({
  health,
  compact = false,
}: {
  health: MergeHealth;
  compact?: boolean;
}) {
  const { t } = useTranslation('tasks');
  const colors = HEALTH_COLORS[health];
  const label = t(HEALTH_LABEL_KEYS[health], health);

  return (
    <motion.div
      className={cn(
        'flex items-center gap-1 rounded-full font-medium',
        colors.bgColor,
        colors.textColor,
        compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]'
      )}
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <HealthIcon health={health} />
      {!compact && <span>{label}</span>}
    </motion.div>
  );
}

/**
 * Icon for health status
 */
function HealthIcon({ health }: { health: MergeHealth }) {
  const size = 'h-2.5 w-2.5';

  if (health === 'pass') {
    return (
      <svg className={size} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
      </svg>
    );
  }

  if (health === 'warning') {
    return (
      <svg className={size} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
    );
  }

  // fail
  return (
    <svg className={size} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

/**
 * Progress bar for merge progress
 */
function MergeProgressBar({
  progress,
  health,
  isMerging,
  isComplete,
  isFailed,
}: {
  progress: number;
  health: MergeHealth;
  isMerging: boolean;
  isComplete: boolean;
  isFailed: boolean;
}) {
  const colors = HEALTH_COLORS[health];

  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          'relative h-1.5 flex-1 overflow-hidden rounded-full',
          isFailed ? 'bg-destructive/20' : 'bg-border'
        )}
      >
        <AnimatePresence mode="wait">
          {isMerging && progress < 100 ? (
            // Active merge - show animated progress
            <>
              <motion.div
                key="progress"
                className={cn('h-full rounded-full', colors.color)}
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
              {/* Shimmer effect for active merge */}
              <motion.div
                key="shimmer"
                className="absolute inset-0 h-full w-1/4 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                animate={{
                  x: ['-100%', '500%'],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />
            </>
          ) : isComplete ? (
            // Complete - full bar with success color
            <motion.div
              key="complete"
              className={cn('h-full rounded-full', colors.color)}
              initial={{ width: 0 }}
              animate={{ width: '100%' }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          ) : isFailed ? (
            // Failed - pulsing error bar
            <motion.div
              key="failed"
              className="absolute inset-0 bg-destructive/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
          ) : (
            // Static progress
            <motion.div
              key="static"
              className={cn('h-full rounded-full', colors.color)}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          )}
        </AnimatePresence>
      </div>
      <span className="text-xs font-medium text-foreground min-w-[2.5rem] text-right">
        {progress}%
      </span>
    </div>
  );
}

/**
 * Conflict list component
 */
function ConflictList({
  conflicts,
  resolvedCount,
  maxDisplay,
}: {
  conflicts: MergeProgressConflict[];
  resolvedCount: number;
  maxDisplay: number;
}) {
  const { t } = useTranslation('tasks');
  const displayConflicts = conflicts.slice(0, maxDisplay);
  const hiddenCount = conflicts.length - displayConflicts.length;

  return (
    <div className="space-y-1">
      {/* Summary */}
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">
          {conflicts.length} {conflicts.length === 1 ? t('merge.labels.conflict', 'conflict') : t('merge.labels.conflicts', 'conflicts')}
        </span>
        {resolvedCount > 0 && (
          <span className="text-success">
            {resolvedCount} {t('merge.labels.resolved', 'resolved')}
          </span>
        )}
      </div>

      {/* Conflict indicators */}
      <div className="flex flex-wrap gap-1">
        {displayConflicts.map((conflict, index) => (
          <motion.div
            key={conflict.filePath || `conflict-${index}`}
            className={cn(
              'h-2 w-2 rounded-full',
              conflict.resolved ? 'bg-warning' : 'bg-destructive'
            )}
            initial={{ scale: 0, opacity: 0 }}
            animate={{
              scale: 1,
              opacity: 1,
              ...((!conflict.resolved) && {
                boxShadow: [
                  '0 0 0 0 rgba(var(--destructive), 0.4)',
                  '0 0 0 4px rgba(var(--destructive), 0)',
                ],
              }),
            }}
            transition={{
              scale: { delay: index * 0.03, duration: 0.2 },
              opacity: { delay: index * 0.03, duration: 0.2 },
              boxShadow: !conflict.resolved
                ? { duration: 1, repeat: Infinity, ease: 'easeOut' }
                : undefined,
            }}
            title={`${conflict.filePath}: ${conflict.resolved ? 'Resolved' : 'Unresolved'}${conflict.resolutionMethod ? ` (${conflict.resolutionMethod})` : ''}`}
          />
        ))}
        {hiddenCount > 0 && (
          <span className="text-[9px] text-muted-foreground font-medium ml-0.5">
            +{hiddenCount}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Merge history list component
 */
function MergeHistoryList({ history }: { history: MergeAttempt[] }) {
  const { t } = useTranslation('tasks');

  // Show most recent 3 entries
  const recentHistory = history.slice(-3).reverse();

  return (
    <div className="mt-3 pt-2 border-t border-border">
      <div className="text-[10px] text-muted-foreground mb-1.5">
        {t('merge.labels.history', 'Merge History')}
      </div>
      <div className="space-y-1.5">
        {recentHistory.map((attempt) => (
          <MergeHistoryItem key={attempt.id} attempt={attempt} />
        ))}
      </div>
    </div>
  );
}

/**
 * Single merge history item
 */
function MergeHistoryItem({ attempt }: { attempt: MergeAttempt }) {
  const colors = HEALTH_COLORS[attempt.health];

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  };

  return (
    <div className="flex items-center gap-2 text-[9px]">
      <div className={cn('h-1.5 w-1.5 rounded-full', colors.color)} />
      <span className="text-muted-foreground">
        {attempt.completedAt ? formatTime(attempt.completedAt) : '—'}
      </span>
      <span className={cn('font-medium', colors.textColor)}>
        {attempt.status}
      </span>
      {attempt.conflicts.length > 0 && (
        <span className="text-muted-foreground">
          ({attempt.conflicts.length} conflicts)
        </span>
      )}
      <span className="text-muted-foreground ml-auto">
        {formatDuration(attempt.durationSeconds)}
      </span>
    </div>
  );
}

/**
 * Helper function to convert MergeAttempt to MergeProgress for display
 */
function historyToProgress(attempt: MergeAttempt): MergeProgress {
  return {
    taskId: attempt.taskId,
    status: attempt.status,
    health: attempt.health,
    progress: attempt.progressPercent,
    currentStep: attempt.currentStep,
    conflicts: attempt.conflicts,
    conflictsResolved: attempt.conflicts.filter(c => c.resolved).length,
    startedAt: attempt.startedAt,
    elapsedTime: attempt.durationSeconds * 1000,
  };
}

// Also export individual components for flexible use
export { MergeHealthBadge, MergeProgressBar, ConflictList, MergeHistoryList };
