import { useState } from 'react';
import {
  X,
  FileCode,
  Folder,
  FunctionSquare,
  Boxes,
  Hash,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  CornerDownRight,
  FileText,
  Code,
  GitBranch,
  Gauge,
  Layers
} from 'lucide-react';
import { Card, CardHeader, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { Separator } from '../ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../../lib/utils';
import type {
  SelectedNodeInfo,
  GraphNode,
  GraphEdge,
  NodeType,
  EdgeType,
  ComplexityRating,
  DEFAULT_GRAPH_COLORS
} from '../../../shared/types';

// ============================================
// Type Definitions
// ============================================

interface InfoPanelProps {
  selectedNodeInfo: SelectedNodeInfo;
  onClose: () => void;
  onNodeClick?: (nodeId: string) => void;
  className?: string;
}

interface RelationshipsSectionProps {
  title: string;
  edges: GraphEdge[];
  nodes: GraphNode[];
  icon: React.ElementType;
  onNodeClick?: (nodeId: string) => void;
}

interface NodeBadgeProps {
  node: GraphNode;
  onClick?: () => void;
}

// ============================================
// Constants
// ============================================

const NODE_TYPE_ICONS: Record<NodeType, React.ElementType> = {
  directory: Folder,
  file: FileCode,
  class: Boxes,
  function: FunctionSquare,
  symbol: Hash
};

const NODE_TYPE_LABELS: Record<NodeType, string> = {
  directory: 'Directory',
  file: 'File',
  class: 'Class',
  function: 'Function',
  symbol: 'Symbol'
};

const NODE_TYPE_COLORS: Record<NodeType, string> = {
  directory: 'text-indigo-500 bg-indigo-500/10',
  file: 'text-blue-500 bg-blue-500/10',
  class: 'text-purple-500 bg-purple-500/10',
  function: 'text-green-500 bg-green-500/10',
  symbol: 'text-amber-500 bg-amber-500/10'
};

const EDGE_TYPE_LABELS: Record<EdgeType, string> = {
  imports: 'Imports',
  calls: 'Calls',
  inherits: 'Extends',
  contains: 'Contains'
};

const COMPLEXITY_COLORS: Record<ComplexityRating, string> = {
  low: 'text-green-500 bg-green-500/10',
  medium: 'text-amber-500 bg-amber-500/10',
  high: 'text-red-500 bg-red-500/10'
};

const COMPLEXITY_LABELS: Record<ComplexityRating, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High'
};

// ============================================
// Helper Functions
// ============================================

function getNodeById(nodes: GraphNode[], nodeId: string | GraphNode): GraphNode | undefined {
  if (typeof nodeId === 'object') return nodeId;
  return nodes.find(n => n.id === nodeId);
}

function getEdgeNodeId(edge: GraphEdge, direction: 'source' | 'target'): string {
  const node = edge[direction];
  return typeof node === 'string' ? node : node.id;
}

// ============================================
// Sub-components
// ============================================

function NodeBadge({ node, onClick }: NodeBadgeProps) {
  const Icon = NODE_TYPE_ICONS[node.type];
  const colorClass = NODE_TYPE_COLORS[node.type];

  return (
    <Badge
      variant="outline"
      className={cn(
        'text-xs font-mono cursor-pointer hover:bg-accent transition-colors',
        onClick && 'hover:border-primary'
      )}
      onClick={onClick}
    >
      <Icon className={cn('h-3 w-3 mr-1', colorClass.split(' ')[0])} />
      {node.name}
    </Badge>
  );
}

function RelationshipsSection({
  title,
  edges,
  nodes,
  icon: Icon,
  onNodeClick
}: RelationshipsSectionProps) {
  const [expanded, setExpanded] = useState(true);

  if (edges.length === 0) return null;

  // Group edges by type
  const edgesByType = edges.reduce((acc, edge) => {
    if (!acc[edge.type]) acc[edge.type] = [];
    acc[edge.type].push(edge);
    return acc;
  }, {} as Record<EdgeType, GraphEdge[]>);

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className="border-t border-border pt-3"
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between text-xs font-medium hover:text-foreground">
        <div className="flex items-center gap-2">
          <Icon className="h-3 w-3" />
          {title} ({edges.length})
        </div>
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        {Object.entries(edgesByType).map(([type, typeEdges]) => (
          <div key={type} className="space-y-1">
            <p className="text-xs text-muted-foreground capitalize">
              {EDGE_TYPE_LABELS[type as EdgeType]}
            </p>
            <div className="flex flex-wrap gap-1">
              {typeEdges.slice(0, 10).map((edge) => {
                const nodeId = title.includes('incoming')
                  ? getEdgeNodeId(edge, 'source')
                  : getEdgeNodeId(edge, 'target');
                const node = getNodeById(nodes, nodeId);
                if (!node) return null;
                return (
                  <NodeBadge
                    key={edge.id}
                    node={node}
                    onClick={onNodeClick ? () => onNodeClick(node.id) : undefined}
                  />
                );
              })}
              {typeEdges.length > 10 && (
                <Badge variant="secondary" className="text-xs">
                  +{typeEdges.length - 10} more
                </Badge>
              )}
            </div>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function MetadataRow({
  icon: Icon,
  label,
  value,
  valueClassName
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn('font-medium', valueClassName)}>{value}</span>
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export function InfoPanel({
  selectedNodeInfo,
  onClose,
  onNodeClick,
  className
}: InfoPanelProps) {
  const { node, incomingEdges, outgoingEdges, parent, children } = selectedNodeInfo;
  const { metadata } = node;

  const Icon = NODE_TYPE_ICONS[node.type];
  const typeColor = NODE_TYPE_COLORS[node.type];

  // Collect all related nodes for lookups
  const allRelatedNodes = [
    ...incomingEdges.map(e => (typeof e.source === 'string' ? null : e.source)).filter(Boolean),
    ...outgoingEdges.map(e => (typeof e.target === 'string' ? null : e.target)).filter(Boolean),
    parent,
    ...children
  ].filter(Boolean) as GraphNode[];

  return (
    <Card className={cn('w-80 h-full flex flex-col overflow-hidden', className)}>
      {/* Header */}
      <CardHeader className="pb-3 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <div className={cn('p-1 rounded', typeColor)}>
                <Icon className="h-4 w-4" />
              </div>
              <Badge variant="outline" className={cn('text-xs capitalize', typeColor)}>
                {NODE_TYPE_LABELS[node.type]}
              </Badge>
            </div>
            <h3 className="font-semibold text-sm truncate" title={node.name}>
              {node.name}
            </h3>
            <p className="text-xs text-muted-foreground font-mono truncate" title={node.filePath}>
              {node.filePath}
            </p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close panel</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>

      <Separator />

      {/* Scrollable Content */}
      <ScrollArea className="flex-1">
        <CardContent className="p-4 space-y-4">
          {/* Metrics */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
              Metrics
            </h4>
            <div className="grid gap-1.5">
              {metadata.loc !== undefined && (
                <MetadataRow
                  icon={FileText}
                  label="Lines of Code"
                  value={metadata.loc.toLocaleString()}
                />
              )}
              {metadata.complexity && (
                <MetadataRow
                  icon={Gauge}
                  label="Complexity"
                  value={
                    <Badge
                      variant="outline"
                      className={cn('text-xs', COMPLEXITY_COLORS[metadata.complexity])}
                    >
                      {COMPLEXITY_LABELS[metadata.complexity]}
                    </Badge>
                  }
                />
              )}
              {metadata.language && (
                <MetadataRow
                  icon={Code}
                  label="Language"
                  value={
                    <span className="capitalize">{metadata.language}</span>
                  }
                />
              )}
              {metadata.startLine !== undefined && metadata.endLine !== undefined && (
                <MetadataRow
                  icon={Layers}
                  label="Location"
                  value={`Lines ${metadata.startLine}-${metadata.endLine}`}
                />
              )}
            </div>
          </div>

          {/* Signature (for functions) */}
          {metadata.signature && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
                Signature
              </h4>
              <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto">
                {metadata.signature}
              </pre>
            </div>
          )}

          {/* Docstring */}
          {metadata.docstring && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
                Documentation
              </h4>
              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {metadata.docstring}
              </p>
            </div>
          )}

          {/* Exports */}
          {metadata.exports && metadata.exports.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
                Exports ({metadata.exports.length})
              </h4>
              <div className="flex flex-wrap gap-1">
                {metadata.exports.slice(0, 15).map((exp) => (
                  <Badge key={exp} variant="outline" className="text-xs font-mono">
                    {exp}
                  </Badge>
                ))}
                {metadata.exports.length > 15 && (
                  <Badge variant="secondary" className="text-xs">
                    +{metadata.exports.length - 15} more
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Parameters (for functions) */}
          {metadata.parameters && metadata.parameters.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
                Parameters ({metadata.parameters.length})
              </h4>
              <div className="flex flex-wrap gap-1">
                {metadata.parameters.map((param) => (
                  <Badge key={param} variant="outline" className="text-xs font-mono">
                    {param}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Return Type (for functions) */}
          {metadata.returnType && (
            <MetadataRow
              icon={ArrowUpRight}
              label="Returns"
              value={
                <code className="text-xs bg-muted px-1 py-0.5 rounded">
                  {metadata.returnType}
                </code>
              }
            />
          )}

          <Separator />

          {/* Relationships */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
              Relationships
            </h4>

            {/* Parent */}
            {parent && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CornerDownRight className="h-3 w-3" />
                  Parent
                </p>
                <NodeBadge
                  node={parent}
                  onClick={onNodeClick ? () => onNodeClick(parent.id) : undefined}
                />
              </div>
            )}

            {/* Children */}
            {children.length > 0 && (
              <Collapsible defaultOpen={children.length <= 5} className="space-y-1">
                <CollapsibleTrigger className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground">
                  <span className="flex items-center gap-1">
                    <GitBranch className="h-3 w-3" />
                    Children ({children.length})
                  </span>
                  <ChevronDown className="h-3 w-3" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {children.slice(0, 10).map((child) => (
                      <NodeBadge
                        key={child.id}
                        node={child}
                        onClick={onNodeClick ? () => onNodeClick(child.id) : undefined}
                      />
                    ))}
                    {children.length > 10 && (
                      <Badge variant="secondary" className="text-xs">
                        +{children.length - 10} more
                      </Badge>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Incoming edges (nodes that reference this node) */}
            <RelationshipsSection
              title="Used by (incoming)"
              edges={incomingEdges}
              nodes={allRelatedNodes}
              icon={ArrowDownRight}
              onNodeClick={onNodeClick}
            />

            {/* Outgoing edges (nodes this node references) */}
            <RelationshipsSection
              title="Uses (outgoing)"
              edges={outgoingEdges}
              nodes={allRelatedNodes}
              icon={ArrowUpRight}
              onNodeClick={onNodeClick}
            />

            {/* Empty state */}
            {!parent &&
              children.length === 0 &&
              incomingEdges.length === 0 &&
              outgoingEdges.length === 0 && (
                <p className="text-xs text-muted-foreground italic">
                  No relationships found
                </p>
              )}
          </div>
        </CardContent>
      </ScrollArea>
    </Card>
  );
}

// ============================================
// Compact Variant
// ============================================

interface InfoPanelCompactProps {
  node: GraphNode;
  className?: string;
}

/**
 * Compact variant of InfoPanel for tooltip/popover use
 */
export function InfoPanelCompact({ node, className }: InfoPanelCompactProps) {
  const { metadata } = node;
  const Icon = NODE_TYPE_ICONS[node.type];
  const typeColor = NODE_TYPE_COLORS[node.type];

  return (
    <div className={cn('p-3 space-y-2', className)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className={cn('p-1 rounded', typeColor)}>
          <Icon className="h-3 w-3" />
        </div>
        <span className="font-medium text-sm">{node.name}</span>
        <Badge variant="outline" className="text-xs capitalize">
          {node.type}
        </Badge>
      </div>

      {/* Path */}
      <p className="text-xs text-muted-foreground font-mono truncate">
        {node.filePath}
      </p>

      {/* Quick stats */}
      <div className="flex gap-3 text-xs text-muted-foreground">
        {metadata.loc !== undefined && (
          <span>{metadata.loc} LOC</span>
        )}
        {metadata.complexity && (
          <Badge
            variant="outline"
            className={cn('text-xs', COMPLEXITY_COLORS[metadata.complexity])}
          >
            {metadata.complexity}
          </Badge>
        )}
        {metadata.language && (
          <span className="capitalize">{metadata.language}</span>
        )}
      </div>
    </div>
  );
}
