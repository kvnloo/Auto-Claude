// Main component export
export { CodebaseExplorer } from './CodebaseExplorer';

// Sub-component exports
export { DependencyGraph } from './DependencyGraph';
export { DepthSlider, DepthSliderCompact } from './DepthSlider';
export { InfoPanel, InfoPanelCompact } from './InfoPanel';
export { GraphLegend, GraphLegendCompact, GraphLegendInline } from './GraphLegend';
export { ExplorerEmptyState, ExplorerEmptyStateInline } from './ExplorerEmptyState';

// Hook exports
export { useExplorer } from './hooks/useExplorer';
export { useGraphLayout } from './hooks/useGraphLayout';

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
