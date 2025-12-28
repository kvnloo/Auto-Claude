// Main component export
export { CodebaseExplorer } from './CodebaseExplorer';

// Sub-component exports
export { DependencyGraph } from './DependencyGraph';
export { SigmaGraph } from './SigmaGraph';
export { DepthSlider, DepthSliderCompact } from './DepthSlider';
export { InfoPanel, InfoPanelCompact } from './InfoPanel';
export { GraphLegend, GraphLegendCompact, GraphLegendInline } from './GraphLegend';
export { ExplorerEmptyState, ExplorerEmptyStateInline } from './ExplorerEmptyState';
export { ExplorerLoadingState, ExplorerLoadingStateCompact, ExplorerLoadingStateInline } from './ExplorerLoadingState';

// Hook exports
export { useExplorer } from './hooks/useExplorer';
export { useGraphLayout } from './hooks/useGraphLayout';
export { useSigmaGraph } from './hooks/useSigmaGraph';
export { useForceLayout } from './hooks/useForceLayout';

// Adapter exports
export {
  convertToGraphology,
  filterByDepth,
  highlightNode,
  selectNode,
  applyPositions,
  getGraphStats,
  exportToGraphData,
} from './adapters/graphology-adapter';

// Design token exports
export * from './design-tokens';

// Type exports from hooks
export type {
  SimulationNode,
  SimulationLink,
  ForceConfig,
  UseGraphLayoutOptions,
  UseGraphLayoutResult,
} from './hooks/useGraphLayout';

// Type exports from components
export type {
  ExplorerEmptyStateProps,
  ExplorerEmptyStateInlineProps,
} from './ExplorerEmptyState';

export type {
  ExplorerLoadingStateProps,
  ExplorerLoadingStateCompactProps,
  ExplorerLoadingStateInlineProps,
} from './ExplorerLoadingState';
