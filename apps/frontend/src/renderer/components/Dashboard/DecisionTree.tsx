import React, { useCallback, useMemo, memo, useEffect } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  useReactFlow,
  NodeTypes,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
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
  ReasoningEdge,
} from '../../../shared/types/reasoning';

// ============================================
// Types
// ============================================

interface DecisionTreeProps {
  /** Optional CSS class name */
  className?: string;
  /** Minimum height for the tree container */
  minHeight?: string;
  /** Whether to show the minimap */
  showMinimap?: boolean;
  /** Whether to show background grid */
  showBackground?: boolean;
  /** Whether to show controls */
  showControls?: boolean;
}

interface DecisionNodeData extends Record<string, unknown> {
  label: string;
  type: DecisionType;
  status: DecisionNodeStatus;
  timestamp: string;
  reasoning: string;
  toolName?: string;
  decision: DecisionNode;
  isSelected: boolean;
  onSelect: (decision: DecisionNode) => void;
}

// ============================================
// Layout Configuration
// ============================================

const LAYOUT_CONFIG = {
  /** Horizontal spacing between sibling nodes */
  horizontalSpacing: 200,
  /** Vertical spacing between levels */
  verticalSpacing: 100,
  /** Starting X position */
  startX: 100,
  /** Starting Y position */
  startY: 50,
  /** Node width for layout calculations */
  nodeWidth: 180,
  /** Node height for layout calculations */
  nodeHeight: 60,
};

// ============================================
// Custom Decision Node Component
// ============================================

/**
 * Custom node component for decision tree visualization.
 * Displays decision type, label, status, and handles click interactions.
 */
const DecisionNodeComponent = memo(function DecisionNodeComponent({
  data,
  selected,
}: {
  data: DecisionNodeData;
  selected?: boolean;
}) {
  const { label, type, status, timestamp, toolName, decision, isSelected, onSelect } = data;

  // Get styling based on type and status
  const typeColorClass = getDecisionTypeColor(type);
  const statusColorClass = getNodeStatusColor(status);
  const isActive = status === 'active';
  const isFailed = status === 'failed';
  const isCompleted = status === 'completed';

  // Format timestamp for display
  const formattedTime = useMemo(() => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, [timestamp]);

  // Handle node click
  const handleClick = useCallback(() => {
    onSelect(decision);
  }, [decision, onSelect]);

  return (
    <>
      {/* Source handle (output) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className={cn('!w-3 !h-3 !bg-border', isActive && '!bg-primary')}
      />

      {/* Target handle (input) */}
      <Handle
        type="target"
        position={Position.Top}
        className={cn('!w-3 !h-3 !bg-border', isActive && '!bg-primary')}
      />

      {/* Node content */}
      <motion.div
        className={cn(
          'relative flex flex-col rounded-lg border-2 bg-card shadow-sm transition-all cursor-pointer min-w-[160px] max-w-[200px]',
          statusColorClass,
          (isSelected || selected) && 'ring-2 ring-primary ring-offset-2',
          isActive && 'shadow-lg shadow-primary/20'
        )}
        onClick={handleClick}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        animate={
          isActive
            ? {
                boxShadow: [
                  '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  '0 8px 12px -2px rgba(59, 130, 246, 0.3)',
                  '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                ],
              }
            : undefined
        }
        transition={
          isActive
            ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }
            : { duration: 0.1 }
        }
      >
        {/* Type indicator bar */}
        <div className={cn('h-1.5 w-full rounded-t-md', typeColorClass)} />

        {/* Content */}
        <div className="p-2 space-y-1">
          {/* Label */}
          <div className="flex items-center gap-1.5">
            <NodeTypeIcon type={type} className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <p className="text-xs font-medium text-foreground truncate" title={label}>
              {label}
            </p>
          </div>

          {/* Tool name if applicable */}
          {toolName && (
            <p className="text-[10px] text-muted-foreground truncate pl-5">
              {toolName}
            </p>
          )}

          {/* Footer: Status + Time */}
          <div className="flex items-center justify-between pt-1 border-t border-border/50">
            <div className="flex items-center gap-1">
              <StatusIndicator status={status} />
              <span className={cn(
                'text-[10px] font-medium capitalize',
                isCompleted && 'text-success',
                isFailed && 'text-destructive',
                isActive && 'text-primary',
                status === 'pending' && 'text-muted-foreground'
              )}>
                {status}
              </span>
            </div>
            <span className="text-[9px] text-muted-foreground tabular-nums">
              {formattedTime}
            </span>
          </div>
        </div>

        {/* Active pulse indicator */}
        {isActive && (
          <motion.div
            className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-primary"
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
      </motion.div>
    </>
  );
});

// ============================================
// Helper Components
// ============================================

/**
 * Status indicator dot with animation for active state
 */
function StatusIndicator({ status }: { status: DecisionNodeStatus }) {
  const isActive = status === 'active';
  const statusColor = {
    pending: 'bg-muted-foreground',
    active: 'bg-primary',
    completed: 'bg-success',
    failed: 'bg-destructive',
  }[status];

  return (
    <motion.div
      className={cn('h-2 w-2 rounded-full', statusColor)}
      animate={
        isActive
          ? { scale: [1, 1.3, 1], opacity: [1, 0.7, 1] }
          : undefined
      }
      transition={
        isActive
          ? { duration: 0.8, repeat: Infinity, ease: 'easeInOut' }
          : undefined
      }
    />
  );
}

/**
 * Icon component for different decision types
 */
function NodeTypeIcon({ type, className }: { type: DecisionType; className?: string }) {
  switch (type) {
    case 'planning':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
        </svg>
      );
    case 'execution':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
        </svg>
      );
    case 'analysis':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
      );
    case 'tool_call':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
        </svg>
      );
    case 'reasoning':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
        </svg>
      );
    case 'result':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'error':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      );
    default:
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
  }
}

/**
 * Empty state when no decisions have been made
 */
function EmptyTreeState() {
  const { t } = useTranslation('tasks');

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <div className="rounded-full bg-muted p-4">
        <svg
          className="h-8 w-8 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
          />
        </svg>
      </div>
      <div className="text-center">
        <h4 className="text-sm font-medium text-foreground">
          {t('reasoning.noDecisionsYet', 'No Decisions Yet')}
        </h4>
        <p className="mt-1 text-xs text-muted-foreground max-w-xs">
          {t('reasoning.waitingForDecisions', 'Waiting for the agent to make decisions. The decision tree will appear here as the agent reasons through the task.')}
        </p>
      </div>
    </div>
  );
}

// ============================================
// Node Types Registry
// ============================================

const nodeTypes: NodeTypes = {
  decision: DecisionNodeComponent,
};

// ============================================
// Layout Algorithm
// ============================================

/**
 * Calculate positions for nodes in a tree layout.
 * Uses a simple hierarchical layout algorithm.
 */
function calculateTreeLayout(
  decisions: DecisionNode[],
  selectedDecisionId: string | null,
  onSelect: (decision: DecisionNode) => void
): Node<DecisionNodeData>[] {
  if (decisions.length === 0) return [];

  // Build parent-child relationships
  const childrenMap = new Map<string | undefined, DecisionNode[]>();
  decisions.forEach((node) => {
    const parentId = node.parentId;
    if (!childrenMap.has(parentId)) {
      childrenMap.set(parentId, []);
    }
    childrenMap.get(parentId)!.push(node);
  });

  // Calculate positions using BFS
  const nodes: Node<DecisionNodeData>[] = [];
  const positionedNodes = new Set<string>();

  // Track x position for each depth level
  const levelWidths = new Map<number, number>();

  function getNodeX(depth: number): number {
    const currentWidth = levelWidths.get(depth) || LAYOUT_CONFIG.startX;
    levelWidths.set(depth, currentWidth + LAYOUT_CONFIG.horizontalSpacing);
    return currentWidth;
  }

  function processNode(node: DecisionNode, depth: number, parentX?: number) {
    if (positionedNodes.has(node.id)) return;
    positionedNodes.add(node.id);

    const x = parentX !== undefined
      ? parentX + LAYOUT_CONFIG.horizontalSpacing * (Math.random() * 0.4 - 0.2) // Slight variation
      : getNodeX(depth);
    const y = LAYOUT_CONFIG.startY + depth * LAYOUT_CONFIG.verticalSpacing;

    nodes.push({
      id: node.id,
      type: 'decision',
      position: { x, y },
      data: {
        label: node.label,
        type: node.type,
        status: node.status,
        timestamp: node.timestamp,
        reasoning: node.reasoning,
        toolName: node.toolName,
        decision: node,
        isSelected: node.id === selectedDecisionId,
        onSelect,
      },
      selected: node.id === selectedDecisionId,
    });

    // Process children
    const children = childrenMap.get(node.id) || [];
    const childStartX = x - ((children.length - 1) * LAYOUT_CONFIG.horizontalSpacing) / 2;

    children.forEach((child, index) => {
      processNode(child, depth + 1, childStartX + index * LAYOUT_CONFIG.horizontalSpacing);
    });
  }

  // Start with root nodes (nodes without parents)
  const rootNodes = childrenMap.get(undefined) || [];
  rootNodes.forEach((root, index) => {
    processNode(root, 0, LAYOUT_CONFIG.startX + index * LAYOUT_CONFIG.horizontalSpacing * 2);
  });

  return nodes;
}

/**
 * Convert store edges to React Flow edges with styling
 */
function convertEdges(storeEdges: ReasoningEdge[], activeNodeId?: string): Edge[] {
  return storeEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'smoothstep',
    animated: edge.animated || edge.target === activeNodeId,
    style: {
      stroke: edge.type === 'error' ? '#ef4444' : '#6b7280',
      strokeWidth: edge.target === activeNodeId ? 2 : 1.5,
    },
    markerEnd: {
      type: 'arrowclosed' as const,
      color: edge.type === 'error' ? '#ef4444' : '#6b7280',
    },
  }));
}

// ============================================
// Auto-fit Component
// ============================================

/**
 * Component to auto-fit the view when nodes change
 */
function AutoFitView({ nodeCount }: { nodeCount: number }) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    // Debounce fitView to avoid excessive calls
    const timeout = setTimeout(() => {
      fitView({ padding: 0.2, duration: 300 });
    }, 100);

    return () => clearTimeout(timeout);
  }, [nodeCount, fitView]);

  return null;
}

// ============================================
// Main DecisionTree Component
// ============================================

/**
 * DecisionTree - React Flow decision tree visualization
 *
 * Displays agent decisions as an interactive graph with:
 * - Custom node types for different decision types
 * - Pan and zoom navigation
 * - Clickable nodes for inspection
 * - Current active node highlighting
 * - Animated edges for active connections
 */
export function DecisionTree({
  className,
  minHeight = '400px',
  showMinimap = true,
  showBackground = true,
  showControls = true,
}: DecisionTreeProps) {
  const { t } = useTranslation('tasks');

  // Get state from reasoning store
  const storeNodes = useReasoningStore((state) => state.nodes);
  const storeEdges = useReasoningStore((state) => state.edges);
  const selectedDecision = useReasoningStore((state) => state.selectedDecision);
  const selectDecision = useReasoningStore((state) => state.selectDecision);
  const agentStatus = useReasoningStore((state) => state.agentStatus);
  const getActiveNode = useReasoningStore((state) => state.getActiveNode);

  const activeNode = getActiveNode();

  // Memoize node selection handler
  const handleNodeSelect = useCallback(
    (decision: DecisionNode) => {
      selectDecision(decision);
    },
    [selectDecision]
  );

  // Calculate layout and convert nodes
  const flowNodes = useMemo(
    () => calculateTreeLayout(storeNodes, selectedDecision?.id || null, handleNodeSelect),
    [storeNodes, selectedDecision?.id, handleNodeSelect]
  );

  // Convert edges
  const flowEdges = useMemo(
    () => convertEdges(storeEdges, activeNode?.id),
    [storeEdges, activeNode?.id]
  );

  // Use React Flow state management
  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

  // Update nodes when store changes
  useEffect(() => {
    setNodes(flowNodes);
  }, [flowNodes, setNodes]);

  // Update edges when store changes
  useEffect(() => {
    setEdges(flowEdges);
  }, [flowEdges, setEdges]);

  // Determine if we should show empty state
  const showEmptyState = storeNodes.length === 0;
  const isRunning = agentStatus === 'running' || agentStatus === 'paused';

  if (showEmptyState) {
    return (
      <div className={cn('flex flex-col rounded-lg border bg-card', className)} style={{ minHeight }}>
        <EmptyTreeState />
      </div>
    );
  }

  return (
    <div
      className={cn('flex flex-col rounded-lg border bg-card overflow-hidden', className)}
      style={{ minHeight }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
        attributionPosition="bottom-left"
        proOptions={{ hideAttribution: true }}
        className="decision-tree-flow"
      >
        {/* Controls panel */}
        {showControls && (
          <Controls
            position="top-right"
            showInteractive={false}
            className="!bg-card !border !border-border !shadow-sm"
          />
        )}

        {/* Background grid */}
        {showBackground && (
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1}
            color="hsl(var(--muted-foreground) / 0.2)"
          />
        )}

        {/* Minimap for navigation */}
        {showMinimap && storeNodes.length > 5 && (
          <MiniMap
            nodeStrokeWidth={3}
            pannable
            zoomable
            className="!bg-card/80 !border !border-border !rounded-lg"
            maskColor="hsl(var(--background) / 0.8)"
          />
        )}

        {/* Info panel */}
        <Panel position="top-left" className="!m-2">
          <div className="flex items-center gap-2 rounded-md bg-card/90 backdrop-blur-sm border px-3 py-1.5 shadow-sm">
            <span className="text-xs text-muted-foreground">
              {storeNodes.length} {storeNodes.length === 1 ? t('reasoning.node', 'node') : t('reasoning.nodes', 'nodes')}
            </span>
            {isRunning && (
              <motion.div
                className="flex items-center gap-1.5 text-xs text-primary"
                animate={{ opacity: [1, 0.5, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                <span>{t('reasoning.liveUpdating', 'Live')}</span>
              </motion.div>
            )}
          </div>
        </Panel>

        {/* Auto-fit view component */}
        <AutoFitView nodeCount={storeNodes.length} />
      </ReactFlow>
    </div>
  );
}

export default DecisionTree;
