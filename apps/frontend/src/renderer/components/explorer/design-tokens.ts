/**
 * Explorer Design Tokens
 *
 * Design system tokens for the CodebaseExplorer component.
 * These match the app's Oscura Midnight dark-mode-first design language.
 *
 * Key principles:
 * - Dark mode first (OLED-optimized backgrounds)
 * - Borders over shadows (subtle 1px borders for definition)
 * - Semantic colors (consistent meaning across components)
 * - Smooth transitions (200ms cubic-bezier for interactions)
 */

import type { NodeType, EdgeType } from '../../../shared/types/explorer';

// ============================================
// Color Palette
// ============================================

/**
 * Node type colors - semantic, consistent with app design
 * Using Tailwind color palette for consistency
 */
export const NODE_COLORS: Record<NodeType, string> = {
  directory: 'rgb(99, 102, 241)',   // indigo-500
  file: 'rgb(59, 130, 246)',        // blue-500
  class: 'rgb(168, 85, 247)',       // purple-500
  function: 'rgb(34, 197, 94)',     // green-500
  symbol: 'rgb(245, 158, 11)',      // amber-500
};

/**
 * Node hover colors (slightly lighter)
 */
export const NODE_HOVER_COLORS: Record<NodeType, string> = {
  directory: 'rgb(129, 140, 248)',  // indigo-400
  file: 'rgb(96, 165, 250)',        // blue-400
  class: 'rgb(192, 132, 252)',      // purple-400
  function: 'rgb(74, 222, 128)',    // green-400
  symbol: 'rgb(251, 191, 36)',      // amber-400
};

/**
 * Node selected colors (with glow effect)
 */
export const NODE_SELECTED_COLORS: Record<NodeType, string> = {
  directory: 'rgb(165, 180, 252)',  // indigo-300
  file: 'rgb(147, 197, 253)',       // blue-300
  class: 'rgb(216, 180, 254)',      // purple-300
  function: 'rgb(134, 239, 172)',   // green-300
  symbol: 'rgb(252, 211, 77)',      // amber-300
};

/**
 * Edge colors with transparency for visual hierarchy
 */
export const EDGE_COLORS: Record<EdgeType, string> = {
  imports: 'rgba(148, 163, 184, 0.5)',   // slate-400/50
  calls: 'rgba(34, 197, 94, 0.4)',       // green-500/40
  inherits: 'rgba(168, 85, 247, 0.5)',   // purple-500/50
  contains: 'rgba(100, 116, 139, 0.3)',  // slate-500/30
};

/**
 * Edge highlight colors (for hover/selection)
 */
export const EDGE_HIGHLIGHT_COLORS: Record<EdgeType, string> = {
  imports: 'rgba(148, 163, 184, 0.8)',   // slate-400/80
  calls: 'rgba(34, 197, 94, 0.7)',       // green-500/70
  inherits: 'rgba(168, 85, 247, 0.8)',   // purple-500/80
  contains: 'rgba(100, 116, 139, 0.6)',  // slate-500/60
};

/**
 * UI background colors (matching app theme)
 */
export const UI_COLORS = {
  // Backgrounds
  background: 'rgb(11, 11, 15)',        // --background (near-black, OLED)
  surface: 'rgb(18, 18, 22)',           // --card
  surfaceHover: 'rgb(24, 24, 28)',      // --card hover
  surfaceActive: 'rgb(30, 30, 34)',     // --card active

  // Borders
  border: 'rgb(35, 35, 35)',            // --border
  borderHover: 'rgb(50, 50, 50)',       // --border hover
  borderFocus: 'rgb(214, 216, 118)',    // --primary (yellow accent)

  // Text
  text: 'rgb(230, 230, 230)',           // --foreground
  textMuted: 'rgb(148, 163, 184)',      // --muted-foreground (slate-400)
  textDim: 'rgb(100, 116, 139)',        // slate-500

  // Accent (primary yellow from app theme)
  primary: 'rgb(214, 216, 118)',        // --primary
  primaryHover: 'rgb(224, 226, 138)',   // --primary lighter
  primaryMuted: 'rgba(214, 216, 118, 0.15)', // --primary/15

  // Semantic
  success: 'rgb(34, 197, 94)',          // green-500
  warning: 'rgb(245, 158, 11)',         // amber-500
  error: 'rgb(239, 68, 68)',            // red-500
  info: 'rgb(59, 130, 246)',            // blue-500
};

// ============================================
// Node Sizes
// ============================================

/**
 * Node sizes (radius in pixels) for Sigma.js
 * Scaled based on importance/hierarchy
 */
export const NODE_SIZES: Record<NodeType, number> = {
  directory: 12,
  file: 8,
  class: 10,
  function: 6,
  symbol: 4,
};

/**
 * Node sizes when zoomed out (level-of-detail)
 */
export const NODE_SIZES_LOD: Record<NodeType, number> = {
  directory: 16,
  file: 10,
  class: 12,
  function: 8,
  symbol: 6,
};

/**
 * Minimum node size (for very zoomed out views)
 */
export const NODE_SIZE_MIN = 2;

/**
 * Maximum node size (for very zoomed in views)
 */
export const NODE_SIZE_MAX = 24;

// ============================================
// Edge Sizes
// ============================================

/**
 * Edge widths by type
 */
export const EDGE_SIZES: Record<EdgeType, number> = {
  imports: 1.5,
  calls: 1,
  inherits: 2,
  contains: 0.5,
};

/**
 * Edge widths when highlighted
 */
export const EDGE_SIZES_HIGHLIGHT: Record<EdgeType, number> = {
  imports: 2.5,
  calls: 2,
  inherits: 3,
  contains: 1.5,
};

// ============================================
// Typography
// ============================================

/**
 * Font settings for graph labels
 */
export const TYPOGRAPHY = {
  /** Label font family */
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  /** Monospace font for code/paths */
  fontFamilyMono: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
  /** Label font size */
  labelSize: 12,
  /** Label font weight */
  labelWeight: '500',
  /** Small label size (for zoomed out) */
  labelSizeSmall: 10,
  /** Large label size (for selected nodes) */
  labelSizeLarge: 14,
};

// ============================================
// Spacing & Layout
// ============================================

/**
 * Spacing values (4px base, matching Tailwind)
 */
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
};

/**
 * Border radius values
 */
export const RADIUS = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  full: 9999,
};

// ============================================
// Animations & Transitions
// ============================================

/**
 * Animation durations (in ms)
 */
export const DURATION = {
  fast: 100,
  normal: 200,
  slow: 300,
  layout: 500,
};

/**
 * Easing functions
 */
export const EASING = {
  default: 'cubic-bezier(0.4, 0, 0.2, 1)',
  in: 'cubic-bezier(0.4, 0, 1, 1)',
  out: 'cubic-bezier(0, 0, 0.2, 1)',
  inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
};

// ============================================
// Shadows & Effects
// ============================================

/**
 * Box shadows (minimal in dark mode)
 */
export const SHADOWS = {
  none: 'none',
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
  // Glow effects for highlights
  glow: {
    primary: '0 0 20px rgba(214, 216, 118, 0.3)',
    node: '0 0 12px rgba(255, 255, 255, 0.2)',
  },
};

// ============================================
// Sigma.js Configuration
// ============================================

/**
 * Default Sigma.js settings
 */
export const SIGMA_SETTINGS = {
  // Rendering
  renderEdgeLabels: false,
  hideEdgesOnMove: true,
  hideLabelsOnMove: false,

  // Labels
  labelRenderedSizeThreshold: 8,
  labelFont: TYPOGRAPHY.fontFamily,
  labelSize: TYPOGRAPHY.labelSize,
  labelWeight: TYPOGRAPHY.labelWeight,
  labelColor: { color: UI_COLORS.text },

  // Defaults
  defaultNodeColor: NODE_COLORS.file,
  defaultEdgeColor: EDGE_COLORS.imports,
  defaultNodeType: 'circle',
  defaultEdgeType: 'arrow',

  // Performance
  enableEdgeEvents: false,
  zIndex: true,

  // Camera
  minCameraRatio: 0.05,
  maxCameraRatio: 10,
};

/**
 * ForceAtlas2 layout defaults
 */
export const FORCE_ATLAS_SETTINGS = {
  iterations: 100,
  gravity: 1,
  scalingRatio: 2,
  barnesHutOptimize: true,
  barnesHutTheta: 0.5,
  strongGravityMode: true,
  slowDown: 1,
  outboundAttractionDistribution: false,
  linLogMode: false,
  adjustSizes: true,
  edgeWeightInfluence: 1,
};

// ============================================
// Utility Functions
// ============================================

/**
 * Get node color by type with optional state
 */
export function getNodeColor(
  type: NodeType,
  state: 'default' | 'hover' | 'selected' = 'default'
): string {
  switch (state) {
    case 'hover':
      return NODE_HOVER_COLORS[type];
    case 'selected':
      return NODE_SELECTED_COLORS[type];
    default:
      return NODE_COLORS[type];
  }
}

/**
 * Get edge color by type with optional highlight
 */
export function getEdgeColor(type: EdgeType, highlighted = false): string {
  return highlighted ? EDGE_HIGHLIGHT_COLORS[type] : EDGE_COLORS[type];
}

/**
 * Get node size by type with optional LOD
 */
export function getNodeSize(type: NodeType, lod = false): number {
  return lod ? NODE_SIZES_LOD[type] : NODE_SIZES[type];
}

/**
 * Get edge size by type with optional highlight
 */
export function getEdgeSize(type: EdgeType, highlighted = false): number {
  return highlighted ? EDGE_SIZES_HIGHLIGHT[type] : EDGE_SIZES[type];
}

/**
 * CSS transition string generator
 */
export function transition(
  property: string | string[] = 'all',
  duration: keyof typeof DURATION = 'normal'
): string {
  const props = Array.isArray(property) ? property.join(', ') : property;
  return `${props} ${DURATION[duration]}ms ${EASING.default}`;
}
