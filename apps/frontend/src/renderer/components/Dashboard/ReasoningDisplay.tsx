import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useReasoningStore } from '../../stores/reasoning-store';
import type { CurrentReasoning, AgentStatus } from '../../../shared/types/reasoning';

interface ReasoningDisplayProps {
  /** Optional CSS class name */
  className?: string;
  /** Maximum height of the display area in pixels */
  maxHeight?: number;
  /** Whether to show timestamps with reasoning entries */
  showTimestamps?: boolean;
}

/** Maximum characters before truncating text with "show more" */
const TRUNCATE_THRESHOLD = 500;

/** Animation variants for reasoning text */
const textAnimationVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

/**
 * ReasoningDisplay - Live reasoning text display component
 *
 * Displays the agent's current reasoning/thinking step in real-time.
 * Features:
 * - Auto-scrolls to show latest reasoning text
 * - Truncates text >500 characters with expandable "Show more" button
 * - Smooth fade-in animations for new reasoning entries
 * - Shows waiting state when no reasoning is available
 */
export function ReasoningDisplay({
  className,
  maxHeight = 200,
  showTimestamps = false,
}: ReasoningDisplayProps) {
  const { t } = useTranslation('tasks');

  // Get state from reasoning store
  const currentReasoning = useReasoningStore((state) => state.currentReasoning);
  const agentStatus = useReasoningStore((state) => state.agentStatus);

  // Local state for "show more" expansion
  const [isExpanded, setIsExpanded] = useState(false);

  // Ref for auto-scroll container
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new reasoning arrives
  useEffect(() => {
    if (scrollContainerRef.current && currentReasoning) {
      const container = scrollContainerRef.current;
      // Use smooth scroll for better UX
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [currentReasoning?.text, currentReasoning?.timestamp]);

  // Reset expansion when reasoning changes
  useEffect(() => {
    setIsExpanded(false);
  }, [currentReasoning?.timestamp]);

  // Toggle expanded state
  const handleToggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  // Determine what text to display
  const displayText = getDisplayText(currentReasoning, isExpanded);
  const shouldShowExpandButton = currentReasoning?.isTruncated && !isExpanded;
  const shouldShowCollapseButton = currentReasoning?.isTruncated && isExpanded;

  // Status-based styling and messages
  const isActive = agentStatus === 'running' || agentStatus === 'paused';
  const isEmpty = !currentReasoning;

  return (
    <div className={cn('flex flex-col rounded-lg border bg-card', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {t('reasoning.liveReasoning', 'Live Reasoning')}
          </h3>
          {/* Activity indicator */}
          {isActive && currentReasoning && (
            <motion.div
              className="h-1.5 w-1.5 rounded-full bg-info"
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
        {/* Timestamp */}
        {showTimestamps && currentReasoning?.timestamp && (
          <span className="text-[10px] text-muted-foreground">
            {formatTimestamp(currentReasoning.timestamp)}
          </span>
        )}
      </div>

      {/* Content area with scrolling */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-4"
        style={{ maxHeight: `${maxHeight}px`, minHeight: '120px' }}
      >
        <AnimatePresence mode="wait">
          {isEmpty ? (
            // Empty state
            <EmptyReasoningState key="empty" agentStatus={agentStatus} />
          ) : (
            // Reasoning text
            <motion.div
              key={currentReasoning.timestamp}
              variants={textAnimationVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="space-y-2"
            >
              <p className="text-sm whitespace-pre-wrap break-words leading-relaxed text-foreground">
                {displayText}
              </p>

              {/* Show more/less buttons */}
              {shouldShowExpandButton && (
                <motion.button
                  onClick={handleToggleExpand}
                  className={cn(
                    'inline-flex items-center gap-1 text-xs font-medium',
                    'text-primary hover:text-primary/80',
                    'transition-colors duration-150'
                  )}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <ChevronDownIcon className="h-3 w-3" />
                  {t('reasoning.showMore', 'Show more')}
                </motion.button>
              )}

              {shouldShowCollapseButton && (
                <motion.button
                  onClick={handleToggleExpand}
                  className={cn(
                    'inline-flex items-center gap-1 text-xs font-medium',
                    'text-primary hover:text-primary/80',
                    'transition-colors duration-150'
                  )}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <ChevronUpIcon className="h-3 w-3" />
                  {t('reasoning.showLess', 'Show less')}
                </motion.button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Character count indicator for long text */}
      {currentReasoning?.fullText && (
        <div className="border-t px-4 py-1.5">
          <span className="text-[10px] text-muted-foreground">
            {isExpanded
              ? t('reasoning.fullTextShowing', '{{count}} characters', {
                  count: currentReasoning.fullText.length,
                })
              : t('reasoning.truncatedText', 'Showing {{shown}} of {{total}} characters', {
                  shown: TRUNCATE_THRESHOLD,
                  total: currentReasoning.fullText.length,
                })}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Empty state component when no reasoning is available
 */
function EmptyReasoningState({ agentStatus }: { agentStatus: AgentStatus }) {
  const { t } = useTranslation('tasks');

  const isIdle = agentStatus === 'idle';
  const isCompleted = agentStatus === 'completed';
  const isError = agentStatus === 'error';
  const isStopped = agentStatus === 'stopped';

  // Determine message based on agent status
  let message: string;
  let IconComponent = WaitingIcon;

  if (isIdle) {
    message = t('reasoning.waitingForAgent', 'Start a task to see reasoning...');
    IconComponent = IdleIcon;
  } else if (isCompleted) {
    message = t('reasoning.agentCompleted', 'Agent completed successfully');
    IconComponent = CompletedIcon;
  } else if (isError) {
    message = t('reasoning.agentErrored', 'Agent encountered an error');
    IconComponent = ErrorIcon;
  } else if (isStopped) {
    message = t('reasoning.agentStopped', 'Agent was stopped');
    IconComponent = StoppedIcon;
  } else {
    message = t('reasoning.waitingForReasoning', 'Waiting for agent reasoning...');
  }

  return (
    <motion.div
      key="empty-state"
      variants={textAnimationVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.2 }}
      className="flex h-full items-center justify-center py-6"
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <IconComponent
          className={cn(
            'h-6 w-6',
            isError ? 'text-destructive' : 'text-muted-foreground'
          )}
        />
        <p className="text-sm text-muted-foreground italic">{message}</p>
        {/* Pulsing dots animation for waiting state */}
        {!isIdle && !isCompleted && !isError && !isStopped && (
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="h-1 w-1 rounded-full bg-muted-foreground/50"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{
                  duration: 1,
                  repeat: Infinity,
                  delay: i * 0.2,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get the display text based on current state and expansion
 */
function getDisplayText(
  reasoning: CurrentReasoning | null,
  isExpanded: boolean
): string {
  if (!reasoning) return '';

  if (isExpanded && reasoning.fullText) {
    return reasoning.fullText;
  }

  return reasoning.text;
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

// ============================================
// Icon Components
// ============================================

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function ChevronUpIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
    </svg>
  );
}

function WaitingIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function IdleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  );
}

function CompletedIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function ErrorIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  );
}

function StoppedIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
      />
    </svg>
  );
}

export default ReasoningDisplay;
