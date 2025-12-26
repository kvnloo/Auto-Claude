import * as React from 'react';
import { memo, useMemo, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { X, ChevronDown, ChevronUp, Clock, GitBranch, AlertTriangle, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  useReasoningStore,
  getDecisionTypeColor,
  getNodeStatusColor,
} from '../../stores/reasoning-store';
import type {
  DecisionNode,
  DecisionType,
  DecisionNodeStatus,
} from '../../../shared/types/reasoning';

// ============================================
// Types
// ============================================

interface DecisionInspectorProps {
  /** Optional CSS class name */
  className?: string;
  /** Render as a modal or inline panel */
  variant?: 'panel' | 'modal';
  /** Callback when inspector is closed */
  onClose?: () => void;
}

interface DecisionInspectorContentProps {
  /** The decision to display */
  decision: DecisionNode;
  /** Callback when close button is clicked */
  onClose: () => void;
  /** Optional CSS class name */
  className?: string;
  /** Variant for styling differences */
  variant?: 'panel' | 'modal';
}

// ============================================
// Helper Functions
// ============================================

/**
 * Format a timestamp for display
 */
function formatTimestamp(timestamp: string): { date: string; time: string; relative: string } {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  let relative: string;
  if (diffSec < 60) {
    relative = `${diffSec}s ago`;
  } else if (diffMin < 60) {
    relative = `${diffMin}m ago`;
  } else {
    relative = `${diffHr}h ago`;
  }

  return {
    date: date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }),
    time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    relative,
  };
}

/**
 * Get decision type label
 */
function getDecisionTypeLabel(type: DecisionType): string {
  const labels: Record<DecisionType, string> = {
    planning: 'Planning',
    execution: 'Execution',
    analysis: 'Analysis',
    tool_call: 'Tool Call',
    reasoning: 'Reasoning',
    result: 'Result',
    error: 'Error',
  };
  return labels[type] || 'Unknown';
}

/**
 * Get status display config
 */
function getStatusConfig(status: DecisionNodeStatus): {
  label: string;
  color: string;
  bgColor: string;
  Icon: React.ElementType;
} {
  const config: Record<DecisionNodeStatus, {
    label: string;
    color: string;
    bgColor: string;
    Icon: React.ElementType;
  }> = {
    pending: { label: 'Pending', color: 'text-muted-foreground', bgColor: 'bg-muted', Icon: Circle },
    active: { label: 'Active', color: 'text-primary', bgColor: 'bg-primary/10', Icon: Loader2 },
    completed: { label: 'Completed', color: 'text-success', bgColor: 'bg-success/10', Icon: CheckCircle2 },
    failed: { label: 'Failed', color: 'text-destructive', bgColor: 'bg-destructive/10', Icon: AlertTriangle },
  };
  return config[status] || config.pending;
}

// ============================================
// Sub-components
// ============================================

/**
 * Decision type badge with icon
 */
const TypeBadge = memo(function TypeBadge({ type }: { type: DecisionType }) {
  const colorClass = getDecisionTypeColor(type);
  const label = getDecisionTypeLabel(type);

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        colorClass.replace('bg-', 'bg-').replace('-500', '-500/20'),
        'text-foreground'
      )}
    >
      <div className={cn('h-2 w-2 rounded-full', colorClass)} />
      {label}
    </div>
  );
});

/**
 * Status badge with icon and animation
 */
const StatusBadge = memo(function StatusBadge({ status }: { status: DecisionNodeStatus }) {
  const config = getStatusConfig(status);
  const isActive = status === 'active';

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.bgColor,
        config.color
      )}
    >
      <config.Icon
        className={cn('h-3 w-3', isActive && 'animate-spin')}
      />
      {config.label}
    </div>
  );
});

/**
 * Collapsible section with header and content
 */
function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
  isEmpty = false,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  isEmpty?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (isEmpty) return null;

  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </span>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Key-value metadata row
 */
function MetadataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1">
      <span className="text-xs text-muted-foreground flex-shrink-0">{label}</span>
      <span className="text-xs text-foreground text-right break-words max-w-[60%]">{value}</span>
    </div>
  );
}

// ============================================
// Main Content Component
// ============================================

/**
 * Decision inspector content - displays all decision details
 */
const DecisionInspectorContent = memo(function DecisionInspectorContent({
  decision,
  onClose,
  className,
  variant = 'panel',
}: DecisionInspectorContentProps) {
  const { t } = useTranslation('tasks');

  // Get related nodes from store
  const getNodeById = useReasoningStore((state) => state.getNodeById);
  const getChildNodes = useReasoningStore((state) => state.getChildNodes);

  // Get parent and children
  const parentNode = useMemo(
    () => (decision.parentId ? getNodeById(decision.parentId) : undefined),
    [decision.parentId, getNodeById]
  );
  const childNodes = useMemo(
    () => getChildNodes(decision.id),
    [decision.id, getChildNodes]
  );

  // Format timestamp
  const formattedTime = useMemo(
    () => formatTimestamp(decision.timestamp),
    [decision.timestamp]
  );

  const isModal = variant === 'modal';

  return (
    <motion.div
      className={cn(
        'flex h-full flex-col bg-card',
        isModal && 'rounded-2xl border border-border shadow-xl',
        className
      )}
      initial={{ opacity: 0, x: isModal ? 0 : 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: isModal ? 0 : 20 }}
      transition={{ duration: 0.2 }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate" title={decision.label}>
            {decision.label}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <TypeBadge type={decision.type} />
            <StatusBadge status={decision.status} />
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={cn(
            'flex-shrink-0 rounded-lg p-1.5',
            'text-muted-foreground hover:text-foreground',
            'hover:bg-accent transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background'
          )}
          aria-label={t('reasoning.closeInspector', 'Close inspector')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Timestamp section */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span>{formattedTime.date}</span>
          <span>•</span>
          <span>{formattedTime.time}</span>
          <span className="ml-auto text-muted-foreground/70">{formattedTime.relative}</span>
        </div>

        {/* Reasoning section */}
        <CollapsibleSection
          title={t('reasoning.rationale', 'Rationale')}
          defaultOpen={true}
          isEmpty={!decision.reasoning}
        >
          <div className="rounded-md bg-muted/50 p-3">
            <p className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
              {decision.reasoning}
            </p>
          </div>
        </CollapsibleSection>

        {/* Context section */}
        <CollapsibleSection
          title={t('reasoning.context', 'Context')}
          defaultOpen={true}
          isEmpty={!decision.context}
        >
          <div className="rounded-md bg-muted/50 p-3">
            <p className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
              {decision.context}
            </p>
          </div>
        </CollapsibleSection>

        {/* Tool information section */}
        <CollapsibleSection
          title={t('reasoning.toolInfo', 'Tool Information')}
          defaultOpen={true}
          isEmpty={!decision.toolName}
        >
          <div className="space-y-2">
            <MetadataRow
              label={t('reasoning.toolName', 'Tool')}
              value={<code className="rounded bg-muted px-1.5 py-0.5">{decision.toolName}</code>}
            />
            {decision.toolInput && (
              <div className="mt-2">
                <span className="text-xs text-muted-foreground">
                  {t('reasoning.toolInput', 'Input')}
                </span>
                <pre className="mt-1 rounded-md bg-muted/50 p-2 text-xs text-foreground overflow-x-auto max-h-32">
                  {decision.toolInput}
                </pre>
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* Result section */}
        <CollapsibleSection
          title={t('reasoning.result', 'Result')}
          defaultOpen={true}
          isEmpty={!decision.result}
        >
          <div className="rounded-md bg-success/10 border border-success/20 p-3">
            <p className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
              {decision.result}
            </p>
          </div>
        </CollapsibleSection>

        {/* Error section */}
        <CollapsibleSection
          title={t('reasoning.error', 'Error')}
          defaultOpen={true}
          isEmpty={!decision.error}
        >
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
            <p className="text-sm text-destructive whitespace-pre-wrap break-words leading-relaxed">
              {decision.error}
            </p>
          </div>
        </CollapsibleSection>

        {/* Relationships section */}
        <CollapsibleSection
          title={t('reasoning.relationships', 'Relationships')}
          defaultOpen={false}
          isEmpty={!parentNode && childNodes.length === 0}
        >
          <div className="space-y-3">
            {/* Parent node */}
            {parentNode && (
              <div>
                <span className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1.5">
                  <GitBranch className="h-3 w-3 rotate-180" />
                  {t('reasoning.parentDecision', 'Parent Decision')}
                </span>
                <RelatedNodeCard node={parentNode} />
              </div>
            )}

            {/* Child nodes */}
            {childNodes.length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1.5">
                  <GitBranch className="h-3 w-3" />
                  {t('reasoning.childDecisions', 'Child Decisions')} ({childNodes.length})
                </span>
                <div className="space-y-2">
                  {childNodes.map((child) => (
                    <RelatedNodeCard key={child.id} node={child} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* Metadata section */}
        <CollapsibleSection
          title={t('reasoning.metadata', 'Metadata')}
          defaultOpen={false}
        >
          <div className="space-y-1">
            <MetadataRow label={t('reasoning.nodeId', 'ID')} value={<code className="text-[10px]">{decision.id}</code>} />
            <MetadataRow label={t('reasoning.depth', 'Depth')} value={decision.depth} />
            {decision.subtaskId && (
              <MetadataRow label={t('reasoning.subtaskId', 'Subtask')} value={decision.subtaskId} />
            )}
            <MetadataRow
              label={t('reasoning.childCount', 'Children')}
              value={decision.childIds.length}
            />
          </div>
        </CollapsibleSection>
      </div>
    </motion.div>
  );
});

/**
 * Compact card for related (parent/child) nodes
 */
const RelatedNodeCard = memo(function RelatedNodeCard({ node }: { node: DecisionNode }) {
  const selectDecision = useReasoningStore((state) => state.selectDecision);

  const handleClick = useCallback(() => {
    selectDecision(node);
  }, [node, selectDecision]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'w-full text-left rounded-md border border-border p-2',
        'hover:bg-accent hover:border-accent-foreground/20',
        'transition-colors focus:outline-none focus:ring-2 focus:ring-ring'
      )}
    >
      <div className="flex items-center gap-2">
        <div className={cn('h-2 w-2 rounded-full flex-shrink-0', getDecisionTypeColor(node.type))} />
        <span className="text-xs font-medium text-foreground truncate">{node.label}</span>
        <StatusBadge status={node.status} />
      </div>
    </button>
  );
});

// ============================================
// Main Component
// ============================================

/**
 * DecisionInspector - Modal/panel component for inspecting decision details
 *
 * Displays detailed information about a selected decision node including:
 * - Decision label and type
 * - Status with visual indicator
 * - Timestamp with relative time
 * - Full reasoning/rationale text
 * - Context information
 * - Tool call details (if applicable)
 * - Parent/child relationships
 * - Additional metadata
 *
 * Can be rendered as:
 * - Inline panel (variant="panel") - embedded in dashboard layout
 * - Modal dialog (variant="modal") - centered overlay
 */
export function DecisionInspector({
  className,
  variant = 'panel',
  onClose,
}: DecisionInspectorProps) {
  const { t } = useTranslation('tasks');

  // Get state from reasoning store
  const selectedDecision = useReasoningStore((state) => state.selectedDecision);
  const isInspectorOpen = useReasoningStore((state) => state.isInspectorOpen);
  const closeInspector = useReasoningStore((state) => state.closeInspector);

  // Handle close
  const handleClose = useCallback(() => {
    closeInspector();
    onClose?.();
  }, [closeInspector, onClose]);

  // Don't render if not open or no decision selected
  if (!isInspectorOpen || !selectedDecision) {
    return null;
  }

  if (variant === 'modal') {
    // Render as modal overlay
    return (
      <AnimatePresence>
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Modal content */}
          <motion.div
            className={cn('relative z-10 w-full max-w-md max-h-[85vh]', className)}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <DecisionInspectorContent
              decision={selectedDecision}
              onClose={handleClose}
              variant="modal"
            />
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  // Render as inline panel
  return (
    <AnimatePresence>
      <DecisionInspectorContent
        decision={selectedDecision}
        onClose={handleClose}
        className={className}
        variant="panel"
      />
    </AnimatePresence>
  );
}

export default DecisionInspector;
