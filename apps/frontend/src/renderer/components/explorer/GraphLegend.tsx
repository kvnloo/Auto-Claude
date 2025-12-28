import { memo, useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, ArrowRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { EdgeType, NodeType } from '../../../shared/types/explorer';
import { DEFAULT_GRAPH_COLORS, DEFAULT_NODE_SIZES } from '../../../shared/types/explorer';

// ============================================
// Types
// ============================================

interface GraphLegendProps {
  /** Whether to show node type legend in addition to edge types */
  showNodeTypes?: boolean;
  /** Whether the legend is collapsed */
  collapsed?: boolean;
  /** Callback when collapsed state changes */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Additional CSS classes */
  className?: string;
}

interface EdgeTypeInfo {
  type: EdgeType;
  label: string;
  description: string;
  dashArray: string;
}

interface NodeTypeInfo {
  type: NodeType;
  label: string;
  description: string;
  size: number;
}

// ============================================
// Constants
// ============================================

/**
 * Information about each edge type for the legend
 */
const EDGE_TYPES: EdgeTypeInfo[] = [
  {
    type: 'imports',
    label: 'Imports',
    description: 'File imports another file or module',
    dashArray: 'none'
  },
  {
    type: 'calls',
    label: 'Calls',
    description: 'Function calls another function',
    dashArray: 'none'
  },
  {
    type: 'inherits',
    label: 'Inherits',
    description: 'Class extends or inherits from another',
    dashArray: '5,3'
  },
  {
    type: 'contains',
    label: 'Contains',
    description: 'Parent contains child (e.g., directory contains files)',
    dashArray: '2,2'
  }
];

/**
 * Information about each node type for the legend
 */
const NODE_TYPES: NodeTypeInfo[] = [
  {
    type: 'directory',
    label: 'Directory',
    description: 'Folder in the project',
    size: DEFAULT_NODE_SIZES.directory
  },
  {
    type: 'file',
    label: 'File',
    description: 'Source code file',
    size: DEFAULT_NODE_SIZES.file
  },
  {
    type: 'class',
    label: 'Class',
    description: 'Class definition',
    size: DEFAULT_NODE_SIZES.class
  },
  {
    type: 'function',
    label: 'Function',
    description: 'Function or method',
    size: DEFAULT_NODE_SIZES.function
  },
  {
    type: 'symbol',
    label: 'Symbol',
    description: 'Variable, constant, or other symbol',
    size: DEFAULT_NODE_SIZES.symbol
  }
];

// ============================================
// Sub-Components
// ============================================

/**
 * Single edge type legend item
 */
interface EdgeLegendItemProps {
  info: EdgeTypeInfo;
}

const EdgeLegendItem = memo(function EdgeLegendItem({ info }: EdgeLegendItemProps) {
  const color = DEFAULT_GRAPH_COLORS.edges[info.type];

  return (
    <div
      className="flex items-center gap-2 group"
      title={info.description}
    >
      {/* Edge line visualization */}
      <svg
        width="32"
        height="12"
        viewBox="0 0 32 12"
        className="shrink-0"
        aria-hidden="true"
      >
        {/* Arrow marker definition */}
        <defs>
          <marker
            id={`legend-arrow-${info.type}`}
            viewBox="0 -4 8 8"
            refX="8"
            refY="0"
            markerWidth="4"
            markerHeight="4"
            orient="auto"
          >
            <path d="M0,-4L8,0L0,4" fill={color} />
          </marker>
        </defs>
        {/* Edge line */}
        <line
          x1="2"
          y1="6"
          x2="26"
          y2="6"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={info.dashArray}
          markerEnd={`url(#legend-arrow-${info.type})`}
        />
      </svg>

      {/* Label */}
      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
        {info.label}
      </span>
    </div>
  );
});

/**
 * Single node type legend item
 */
interface NodeLegendItemProps {
  info: NodeTypeInfo;
}

const NodeLegendItem = memo(function NodeLegendItem({ info }: NodeLegendItemProps) {
  const color = DEFAULT_GRAPH_COLORS.nodes[info.type];
  // Scale the size for display (proportional to actual sizes)
  const displaySize = Math.max(6, info.size * 0.6);

  return (
    <div
      className="flex items-center gap-2 group"
      title={info.description}
    >
      {/* Node circle visualization */}
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        className="shrink-0"
        aria-hidden="true"
      >
        <circle
          cx="10"
          cy="10"
          r={displaySize}
          fill={color}
          stroke={color}
          strokeWidth="1"
          strokeOpacity="0.7"
        />
      </svg>

      {/* Label */}
      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
        {info.label}
      </span>
    </div>
  );
});

// ============================================
// Main Component
// ============================================

/**
 * GraphLegend - Shows edge type color codes and optionally node types
 *
 * Displays a legend explaining the meaning of different edge colors and styles
 * in the dependency graph visualization.
 *
 * Edge Types:
 * - IMPORTS (blue, solid) - File imports
 * - CALLS (green, solid) - Function calls
 * - INHERITS (purple, dashed) - Class inheritance
 * - CONTAINS (gray, dotted) - Parent-child containment
 */
export function GraphLegend({
  showNodeTypes = false,
  collapsed = false,
  onCollapsedChange,
  className
}: GraphLegendProps) {
  const [isCollapsed, setIsCollapsed] = useState(collapsed);

  const handleToggle = useCallback(() => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    onCollapsedChange?.(newState);
  }, [isCollapsed, onCollapsedChange]);

  return (
    <div
      className={cn(
        'bg-background/80 backdrop-blur-sm border border-border rounded-lg',
        'transition-all duration-200',
        className
      )}
      role="region"
      aria-label="Graph legend"
    >
      {/* Header */}
      <button
        type="button"
        onClick={handleToggle}
        className={cn(
          'w-full flex items-center justify-between px-3 py-2',
          'hover:bg-accent/50 transition-colors rounded-lg',
          !isCollapsed && 'border-b border-border rounded-b-none'
        )}
        aria-expanded={!isCollapsed}
        aria-controls="legend-content"
      >
        <span className="text-xs font-medium text-muted-foreground">Legend</span>
        {isCollapsed ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {/* Content */}
      {!isCollapsed && (
        <div id="legend-content" className="px-3 py-2.5 space-y-3">
          {/* Edge Types Section */}
          <div>
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Relationships
            </h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {EDGE_TYPES.map((info) => (
                <EdgeLegendItem key={info.type} info={info} />
              ))}
            </div>
          </div>

          {/* Node Types Section (optional) */}
          {showNodeTypes && (
            <div>
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Node Types
              </h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {NODE_TYPES.map((info) => (
                  <NodeLegendItem key={info.type} info={info} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact inline version of the legend for use in toolbars or status bars
 */
export function GraphLegendCompact({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-4 text-xs text-muted-foreground',
        className
      )}
      role="region"
      aria-label="Graph legend"
    >
      {EDGE_TYPES.map((info) => {
        const color = DEFAULT_GRAPH_COLORS.edges[info.type];
        return (
          <div
            key={info.type}
            className="flex items-center gap-1.5"
            title={info.description}
          >
            <ArrowRight className="h-3 w-3" style={{ color }} />
            <span>{info.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Inline version showing just edge types with their colors
 */
export function GraphLegendInline({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 px-2 py-1.5',
        'bg-background/60 backdrop-blur-sm border border-border rounded',
        className
      )}
      role="region"
      aria-label="Graph legend"
    >
      {EDGE_TYPES.map((info) => {
        const color = DEFAULT_GRAPH_COLORS.edges[info.type];
        return (
          <div
            key={info.type}
            className="flex items-center gap-1.5"
            title={info.description}
          >
            {/* Small line indicator */}
            <svg
              width="16"
              height="8"
              viewBox="0 0 16 8"
              className="shrink-0"
              aria-hidden="true"
            >
              <line
                x1="0"
                y1="4"
                x2="16"
                y2="4"
                stroke={color}
                strokeWidth="2"
                strokeDasharray={info.dashArray}
              />
            </svg>
            <span className="text-[10px] text-muted-foreground">{info.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export default GraphLegend;
