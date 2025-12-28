/**
 * Force Layout WebWorker
 *
 * Runs ForceAtlas2 layout algorithm off the main thread
 * to prevent UI blocking during graph layout computation.
 *
 * Uses Barnes-Hut optimization for O(n log n) complexity
 * instead of naive O(n²) force calculation.
 */

import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';

// ============================================
// Types
// ============================================

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  size?: number;
  fixed?: boolean;
}

interface LayoutEdge {
  source: string;
  target: string;
  weight?: number;
}

interface ForceAtlas2Settings {
  iterations: number;
  gravity: number;
  scalingRatio: number;
  barnesHutOptimize: boolean;
  barnesHutTheta: number;
  strongGravityMode: boolean;
  slowDown: number;
  outboundAttractionDistribution: boolean;
  linLogMode: boolean;
  adjustSizes: boolean;
  edgeWeightInfluence: number;
}

interface NoverlapSettings {
  maxIterations: number;
  margin: number;
  ratio: number;
  speed: number;
}

type WorkerMessage =
  | { type: 'start'; nodes: LayoutNode[]; edges: LayoutEdge[]; settings: Partial<ForceAtlas2Settings> }
  | { type: 'stop' }
  | { type: 'update-settings'; settings: Partial<ForceAtlas2Settings> }
  | { type: 'noverlap'; settings?: Partial<NoverlapSettings> };

type WorkerResponse =
  | { type: 'positions'; positions: Record<string, { x: number; y: number }> }
  | { type: 'progress'; progress: number; iteration: number }
  | { type: 'complete'; positions: Record<string, { x: number; y: number }>; duration: number }
  | { type: 'error'; error: string };

// ============================================
// Default Settings
// ============================================

const DEFAULT_FA2_SETTINGS: ForceAtlas2Settings = {
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

const DEFAULT_NOVERLAP_SETTINGS: NoverlapSettings = {
  maxIterations: 50,
  margin: 5,
  ratio: 1.1,
  speed: 3,
};

// ============================================
// State
// ============================================

let graph: Graph | null = null;
let isRunning = false;
let currentSettings: ForceAtlas2Settings = { ...DEFAULT_FA2_SETTINGS };

// ============================================
// Message Handler
// ============================================

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'start':
      startLayout(message.nodes, message.edges, message.settings);
      break;

    case 'stop':
      stopLayout();
      break;

    case 'update-settings':
      updateSettings(message.settings);
      break;

    case 'noverlap':
      runNoverlap(message.settings);
      break;
  }
};

// ============================================
// Layout Functions
// ============================================

/**
 * Start the ForceAtlas2 layout algorithm
 */
function startLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  settings: Partial<ForceAtlas2Settings>
): void {
  if (isRunning) {
    stopLayout();
  }

  const startTime = performance.now();
  isRunning = true;
  currentSettings = { ...DEFAULT_FA2_SETTINGS, ...settings };

  try {
    // Create graph from input data
    graph = new Graph({ type: 'directed', multi: false });

    // Add nodes with positions
    for (const node of nodes) {
      graph.addNode(node.id, {
        x: node.x,
        y: node.y,
        size: node.size || 1,
      });
    }

    // Add edges
    for (const edge of edges) {
      if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
        if (!graph.hasEdge(edge.source, edge.target)) {
          graph.addEdge(edge.source, edge.target, {
            weight: edge.weight || 1,
          });
        }
      }
    }

    // Run ForceAtlas2 with progress updates
    const totalIterations = currentSettings.iterations;
    const batchSize = Math.max(10, Math.floor(totalIterations / 10));

    let currentIteration = 0;

    const runBatch = () => {
      if (!isRunning || !graph) return;

      const iterationsThisBatch = Math.min(batchSize, totalIterations - currentIteration);

      // Run a batch of iterations
      forceAtlas2.assign(graph, {
        iterations: iterationsThisBatch,
        settings: {
          gravity: currentSettings.gravity,
          scalingRatio: currentSettings.scalingRatio,
          barnesHutOptimize: currentSettings.barnesHutOptimize,
          barnesHutTheta: currentSettings.barnesHutTheta,
          strongGravityMode: currentSettings.strongGravityMode,
          slowDown: currentSettings.slowDown,
          outboundAttractionDistribution: currentSettings.outboundAttractionDistribution,
          linLogMode: currentSettings.linLogMode,
          adjustSizes: currentSettings.adjustSizes,
          edgeWeightInfluence: currentSettings.edgeWeightInfluence,
        },
      });

      currentIteration += iterationsThisBatch;

      // Send progress update
      const progress = currentIteration / totalIterations;
      postProgress(progress, currentIteration);

      // Send intermediate positions every few batches
      if (currentIteration % (batchSize * 3) === 0 || currentIteration >= totalIterations) {
        postPositions();
      }

      // Continue or complete
      if (currentIteration < totalIterations && isRunning) {
        // Use setTimeout to allow message processing
        setTimeout(runBatch, 0);
      } else {
        // Layout complete
        const duration = performance.now() - startTime;
        postComplete(duration);
        isRunning = false;
      }
    };

    // Start the layout process
    runBatch();
  } catch (error) {
    postError(error instanceof Error ? error.message : String(error));
    isRunning = false;
  }
}

/**
 * Stop the current layout
 */
function stopLayout(): void {
  isRunning = false;
}

/**
 * Update layout settings (will apply on next batch)
 */
function updateSettings(settings: Partial<ForceAtlas2Settings>): void {
  currentSettings = { ...currentSettings, ...settings };
}

/**
 * Run noverlap to remove node overlaps
 */
function runNoverlap(settings?: Partial<NoverlapSettings>): void {
  if (!graph) {
    postError('No graph loaded for noverlap');
    return;
  }

  const opts = { ...DEFAULT_NOVERLAP_SETTINGS, ...settings };

  try {
    noverlap.assign(graph, {
      maxIterations: opts.maxIterations,
      settings: {
        margin: opts.margin,
        ratio: opts.ratio,
        speed: opts.speed,
      },
    });

    postPositions();
  } catch (error) {
    postError(error instanceof Error ? error.message : String(error));
  }
}

// ============================================
// Response Functions
// ============================================

/**
 * Post current positions to main thread
 */
function postPositions(): void {
  if (!graph) return;

  const positions: Record<string, { x: number; y: number }> = {};

  graph.forEachNode((nodeId, attrs) => {
    positions[nodeId] = { x: attrs.x, y: attrs.y };
  });

  const response: WorkerResponse = {
    type: 'positions',
    positions,
  };

  self.postMessage(response);
}

/**
 * Post progress update
 */
function postProgress(progress: number, iteration: number): void {
  const response: WorkerResponse = {
    type: 'progress',
    progress,
    iteration,
  };

  self.postMessage(response);
}

/**
 * Post completion with final positions
 */
function postComplete(duration: number): void {
  if (!graph) return;

  const positions: Record<string, { x: number; y: number }> = {};

  graph.forEachNode((nodeId, attrs) => {
    positions[nodeId] = { x: attrs.x, y: attrs.y };
  });

  const response: WorkerResponse = {
    type: 'complete',
    positions,
    duration,
  };

  self.postMessage(response);
}

/**
 * Post error message
 */
function postError(error: string): void {
  const response: WorkerResponse = {
    type: 'error',
    error,
  };

  self.postMessage(response);
}
