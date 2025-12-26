import {
  DecisionNode,
  DecisionType,
  DecisionNodeStatus,
  ReasoningEdge,
  ReasoningEvent,
  ReasoningEventType,
  AddNodePayload,
  UpdateNodeStatusPayload,
} from '../../shared/types/reasoning';

/**
 * Parser for extracting decision nodes and reasoning from agent logs.
 * Builds a tree structure of agent decisions for visualization.
 */
export class ReasoningParser {
  /** Counter for generating unique node IDs */
  private nodeCounter: number = 0;

  /** Stack of active decision node IDs (for parent tracking) */
  private nodeStack: string[] = [];

  /** Map of node IDs to nodes for quick lookup */
  private nodesMap: Map<string, DecisionNode> = new Map();

  /** All edges between nodes */
  private edges: ReasoningEdge[] = [];

  /** Current task ID being processed */
  private currentTaskId: string | null = null;

  /** Timestamp when parsing started */
  private startedAt: Date | null = null;

  /**
   * Reset parser state for a new task
   */
  reset(taskId?: string): void {
    this.nodeCounter = 0;
    this.nodeStack = [];
    this.nodesMap = new Map();
    this.edges = [];
    this.currentTaskId = taskId || null;
    this.startedAt = new Date();
  }

  /**
   * Get all nodes as an array
   */
  getNodes(): DecisionNode[] {
    return Array.from(this.nodesMap.values());
  }

  /**
   * Get all edges
   */
  getEdges(): ReasoningEdge[] {
    return this.edges;
  }

  /**
   * Get a node by ID
   */
  getNode(nodeId: string): DecisionNode | undefined {
    return this.nodesMap.get(nodeId);
  }

  /**
   * Generate a unique node ID
   */
  private generateNodeId(): string {
    this.nodeCounter++;
    return `decision-${this.nodeCounter}`;
  }

  /**
   * Get the current parent node ID (top of stack)
   */
  private getCurrentParentId(): string | undefined {
    return this.nodeStack.length > 0
      ? this.nodeStack[this.nodeStack.length - 1]
      : undefined;
  }

  /**
   * Parse a log line and extract reasoning/decision information.
   * Returns a ReasoningEvent if the log contains relevant information.
   */
  parseLog(log: string, taskId?: string): ReasoningEvent | null {
    const trimmedLog = log.trim();
    if (!trimmedLog) {
      return null;
    }

    // Update task ID if provided
    if (taskId && taskId !== this.currentTaskId) {
      this.reset(taskId);
    }

    const timestamp = new Date().toISOString();

    // Try to parse decision patterns
    const decisionResult = this.parseDecisionPattern(trimmedLog, timestamp);
    if (decisionResult) {
      return decisionResult;
    }

    // Try to parse reasoning/thinking patterns
    const reasoningResult = this.parseReasoningPattern(trimmedLog, timestamp);
    if (reasoningResult) {
      return reasoningResult;
    }

    // Try to parse tool call patterns
    const toolResult = this.parseToolCallPattern(trimmedLog, timestamp);
    if (toolResult) {
      return toolResult;
    }

    // Try to parse result/completion patterns
    const completionResult = this.parseCompletionPattern(trimmedLog, timestamp);
    if (completionResult) {
      return completionResult;
    }

    // Try to parse error patterns
    const errorResult = this.parseErrorPattern(trimmedLog, timestamp);
    if (errorResult) {
      return errorResult;
    }

    return null;
  }

  /**
   * Parse decision-making patterns in logs.
   * Patterns: "Planning:", "Deciding:", "Decision:", "Approach:"
   */
  private parseDecisionPattern(log: string, timestamp: string): ReasoningEvent | null {
    const lowerLog = log.toLowerCase();

    // Planning decisions
    const planningPatterns = [
      /^(?:planning|plan):\s*(.+)/i,
      /^(?:strategy|strategizing):\s*(.+)/i,
      /^(?:approach):\s*(.+)/i,
    ];

    for (const pattern of planningPatterns) {
      const match = log.match(pattern);
      if (match) {
        return this.createDecisionEvent('planning', match[1], timestamp, 'Planning');
      }
    }

    // Explicit decision patterns
    const decisionPatterns = [
      /^(?:decision|deciding):\s*(.+)/i,
      /^(?:choosing|choice):\s*(.+)/i,
      /^(?:selected|selecting):\s*(.+)/i,
    ];

    for (const pattern of decisionPatterns) {
      const match = log.match(pattern);
      if (match) {
        return this.createDecisionEvent('execution', match[1], timestamp, 'Decision');
      }
    }

    // Analysis patterns
    const analysisPatterns = [
      /^(?:analyzing|analysis):\s*(.+)/i,
      /^(?:examining|reviewing):\s*(.+)/i,
      /^(?:inspecting|looking at):\s*(.+)/i,
    ];

    for (const pattern of analysisPatterns) {
      const match = log.match(pattern);
      if (match) {
        return this.createDecisionEvent('analysis', match[1], timestamp, 'Analysis');
      }
    }

    // Check for implicit decision indicators
    if (lowerLog.includes('will implement') || lowerLog.includes('going to implement')) {
      return this.createDecisionEvent('execution', this.extractRelevantText(log), timestamp, 'Implementation');
    }

    if (lowerLog.includes('will use') || lowerLog.includes('choosing to use')) {
      return this.createDecisionEvent('execution', this.extractRelevantText(log), timestamp, 'Tool Selection');
    }

    return null;
  }

  /**
   * Parse reasoning/thinking patterns in logs.
   * Patterns: "Thinking:", "Reasoning:", "Considering:"
   */
  private parseReasoningPattern(log: string, timestamp: string): ReasoningEvent | null {
    const reasoningPatterns = [
      /^(?:thinking|thought):\s*(.+)/i,
      /^(?:reasoning|reason):\s*(.+)/i,
      /^(?:considering|consideration):\s*(.+)/i,
      /^(?:evaluating|evaluation):\s*(.+)/i,
    ];

    for (const pattern of reasoningPatterns) {
      const match = log.match(pattern);
      if (match) {
        return {
          type: 'reasoning_update',
          taskId: this.currentTaskId || 'unknown',
          timestamp,
          reasoning: match[1].trim(),
        };
      }
    }

    // Extended thinking block patterns (Claude agent output)
    if (log.includes('<thinking>') || log.includes('</thinking>')) {
      const thinkingMatch = log.match(/<thinking>([\s\S]*?)(?:<\/thinking>|$)/);
      if (thinkingMatch) {
        return {
          type: 'reasoning_update',
          taskId: this.currentTaskId || 'unknown',
          timestamp,
          reasoning: thinkingMatch[1].trim(),
        };
      }
    }

    return null;
  }

  /**
   * Parse tool call patterns in logs.
   * Patterns: Tool invocations, file operations, commands
   */
  private parseToolCallPattern(log: string, timestamp: string): ReasoningEvent | null {
    const lowerLog = log.toLowerCase();

    // Tool invocation patterns
    const toolPatterns = [
      { pattern: /^(?:invoking|calling|using)\s+(?:tool\s+)?["']?(\w+)["']?\s*(?:with|:)?\s*(.*)/i, type: 'tool_call' as DecisionType },
      { pattern: /^(?:running|executing)\s+(?:command\s+)?["']?([^"']+)["']?/i, type: 'tool_call' as DecisionType },
      { pattern: /^(?:reading|writing|editing)\s+(?:file\s+)?["']?([^"']+)["']?/i, type: 'tool_call' as DecisionType },
    ];

    for (const { pattern, type } of toolPatterns) {
      const match = log.match(pattern);
      if (match) {
        const toolName = this.extractToolName(match[1]);
        const toolInput = match[2]?.trim() || '';

        const node = this.createNode({
          id: this.generateNodeId(),
          label: `${toolName}`,
          type,
          reasoning: log,
          toolName,
          toolInput,
          parentId: this.getCurrentParentId(),
        });

        return {
          type: 'decision_made',
          taskId: this.currentTaskId || 'unknown',
          timestamp,
          decision: node,
        };
      }
    }

    // Implicit tool usage patterns
    if (lowerLog.includes('grep') || lowerLog.includes('searching for')) {
      return this.createToolEvent('Grep', log, timestamp);
    }

    if (lowerLog.includes('reading file') || lowerLog.includes('read tool')) {
      return this.createToolEvent('Read', log, timestamp);
    }

    if (lowerLog.includes('writing to') || lowerLog.includes('write tool')) {
      return this.createToolEvent('Write', log, timestamp);
    }

    if (lowerLog.includes('edit tool') || lowerLog.includes('editing')) {
      return this.createToolEvent('Edit', log, timestamp);
    }

    if (lowerLog.includes('bash') || lowerLog.includes('running command')) {
      return this.createToolEvent('Bash', log, timestamp);
    }

    return null;
  }

  /**
   * Parse completion/result patterns in logs.
   * Patterns: "Result:", "Complete:", "Done:", "Output:"
   */
  private parseCompletionPattern(log: string, timestamp: string): ReasoningEvent | null {
    const lowerLog = log.toLowerCase();

    const completionPatterns = [
      /^(?:result|output):\s*(.+)/i,
      /^(?:complete|completed|done|finished):\s*(.+)/i,
      /^(?:success|successfully):\s*(.+)/i,
    ];

    for (const pattern of completionPatterns) {
      const match = log.match(pattern);
      if (match) {
        const parentId = this.getCurrentParentId();

        // If there's an active node, mark it as completed
        if (parentId) {
          const parentNode = this.nodesMap.get(parentId);
          if (parentNode) {
            parentNode.status = 'completed';
            parentNode.result = match[1].trim();

            // Pop from stack
            this.nodeStack.pop();

            return {
              type: 'decision_completed',
              taskId: this.currentTaskId || 'unknown',
              timestamp,
              decision: parentNode,
            };
          }
        }

        // Otherwise, create a result node
        const node = this.createNode({
          id: this.generateNodeId(),
          label: 'Result',
          type: 'result',
          reasoning: match[1].trim(),
          parentId,
        });

        node.status = 'completed';

        return {
          type: 'decision_completed',
          taskId: this.currentTaskId || 'unknown',
          timestamp,
          decision: node,
        };
      }
    }

    // Subtask completion patterns
    if (lowerLog.includes('subtask completed') || lowerLog.includes('subtask done')) {
      const subtaskMatch = log.match(/subtask[:\s]+["']?([^"']+)["']?\s+(?:completed|done)/i);
      const subtaskId = subtaskMatch?.[1];

      return {
        type: 'decision_completed',
        taskId: this.currentTaskId || 'unknown',
        timestamp,
        decision: {
          type: 'execution',
          status: 'completed',
          subtaskId,
        },
      };
    }

    // Build completion
    if (lowerLog.includes('build complete') || lowerLog.includes('=== build complete ===')) {
      return {
        type: 'agent_completed',
        taskId: this.currentTaskId || 'unknown',
        timestamp,
      };
    }

    return null;
  }

  /**
   * Parse error patterns in logs.
   * Patterns: "Error:", "Failed:", "Exception:"
   */
  private parseErrorPattern(log: string, timestamp: string): ReasoningEvent | null {
    const lowerLog = log.toLowerCase();

    const errorPatterns = [
      /^(?:error|err):\s*(.+)/i,
      /^(?:failed|failure):\s*(.+)/i,
      /^(?:exception|exception thrown):\s*(.+)/i,
      /^(?:fatal):\s*(.+)/i,
    ];

    for (const pattern of errorPatterns) {
      const match = log.match(pattern);
      if (match) {
        const parentId = this.getCurrentParentId();

        // If there's an active node, mark it as failed
        if (parentId) {
          const parentNode = this.nodesMap.get(parentId);
          if (parentNode) {
            parentNode.status = 'failed';
            parentNode.error = match[1].trim();

            // Pop from stack
            this.nodeStack.pop();

            return {
              type: 'decision_failed',
              taskId: this.currentTaskId || 'unknown',
              timestamp,
              decision: parentNode,
              error: match[1].trim(),
            };
          }
        }

        // Otherwise, create an error node
        const node = this.createNode({
          id: this.generateNodeId(),
          label: 'Error',
          type: 'error',
          reasoning: match[1].trim(),
          parentId,
        });

        node.status = 'failed';
        node.error = match[1].trim();

        return {
          type: 'decision_failed',
          taskId: this.currentTaskId || 'unknown',
          timestamp,
          decision: node,
          error: match[1].trim(),
        };
      }
    }

    // Implicit error detection
    if (lowerLog.includes('build failed') || lowerLog.includes('execution failed')) {
      return {
        type: 'agent_stopped',
        taskId: this.currentTaskId || 'unknown',
        timestamp,
        error: log.trim().substring(0, 200),
      };
    }

    return null;
  }

  /**
   * Create a decision node and add it to the tree
   */
  private createNode(payload: AddNodePayload): DecisionNode {
    const parentId = payload.parentId || this.getCurrentParentId();
    const parentNode = parentId ? this.nodesMap.get(parentId) : undefined;
    const depth = parentNode ? parentNode.depth + 1 : 0;

    const node: DecisionNode = {
      id: payload.id,
      label: payload.label,
      type: payload.type,
      status: 'active',
      timestamp: new Date().toISOString(),
      reasoning: payload.reasoning,
      context: payload.context,
      parentId,
      childIds: [],
      toolName: payload.toolName,
      toolInput: payload.toolInput,
      subtaskId: payload.subtaskId,
      depth,
    };

    // Add to nodes map
    this.nodesMap.set(node.id, node);

    // Update parent's childIds
    if (parentNode) {
      parentNode.childIds.push(node.id);
    }

    // Create edge from parent to this node
    if (parentId) {
      const edge: ReasoningEdge = {
        id: `edge-${parentId}-${node.id}`,
        source: parentId,
        target: node.id,
        type: 'default',
        animated: true, // Active edge
      };
      this.edges.push(edge);
    }

    // Push to stack (this becomes the new parent for nested decisions)
    this.nodeStack.push(node.id);

    return node;
  }

  /**
   * Create a decision event for a decision pattern match
   */
  private createDecisionEvent(
    type: DecisionType,
    reasoning: string,
    timestamp: string,
    labelPrefix: string
  ): ReasoningEvent {
    const node = this.createNode({
      id: this.generateNodeId(),
      label: this.createLabel(labelPrefix, reasoning),
      type,
      reasoning: reasoning.trim(),
      parentId: this.getCurrentParentId(),
    });

    return {
      type: 'decision_made',
      taskId: this.currentTaskId || 'unknown',
      timestamp,
      decision: node,
    };
  }

  /**
   * Create a tool call event
   */
  private createToolEvent(
    toolName: string,
    log: string,
    timestamp: string
  ): ReasoningEvent {
    const node = this.createNode({
      id: this.generateNodeId(),
      label: `Tool: ${toolName}`,
      type: 'tool_call',
      reasoning: log,
      toolName,
      parentId: this.getCurrentParentId(),
    });

    return {
      type: 'decision_made',
      taskId: this.currentTaskId || 'unknown',
      timestamp,
      decision: node,
    };
  }

  /**
   * Create a short label from a prefix and reasoning text
   */
  private createLabel(prefix: string, reasoning: string): string {
    const maxLength = 30;
    const truncated = reasoning.length > maxLength
      ? reasoning.substring(0, maxLength) + '...'
      : reasoning;
    return `${prefix}: ${truncated}`;
  }

  /**
   * Extract the relevant text from a log line (remove common prefixes)
   */
  private extractRelevantText(log: string): string {
    // Remove common log prefixes
    return log
      .replace(/^\[[\w\s:.-]+\]\s*/i, '') // Remove timestamp brackets
      .replace(/^(?:info|debug|warn|error):\s*/i, '') // Remove log level
      .trim();
  }

  /**
   * Extract tool name from a matched pattern
   */
  private extractToolName(match: string): string {
    // Capitalize first letter and clean up
    const cleaned = match.trim().toLowerCase();
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  /**
   * Update a node's status
   */
  updateNodeStatus(payload: UpdateNodeStatusPayload): DecisionNode | undefined {
    const node = this.nodesMap.get(payload.nodeId);
    if (!node) {
      return undefined;
    }

    node.status = payload.status;

    if (payload.result) {
      node.result = payload.result;
    }

    if (payload.error) {
      node.error = payload.error;
    }

    // Update edge animation based on status
    const edge = this.edges.find((e) => e.target === payload.nodeId);
    if (edge) {
      edge.animated = payload.status === 'active';
    }

    // If completed or failed, pop from stack if at top
    if (
      (payload.status === 'completed' || payload.status === 'failed') &&
      this.nodeStack[this.nodeStack.length - 1] === payload.nodeId
    ) {
      this.nodeStack.pop();
    }

    return node;
  }

  /**
   * Get the currently active node (if any)
   */
  getActiveNode(): DecisionNode | undefined {
    const activeId = this.getCurrentParentId();
    return activeId ? this.nodesMap.get(activeId) : undefined;
  }

  /**
   * Get all root nodes (nodes without parents)
   */
  getRootNodes(): DecisionNode[] {
    return Array.from(this.nodesMap.values()).filter(
      (node) => !node.parentId
    );
  }

  /**
   * Get child nodes for a given parent
   */
  getChildNodes(parentId: string): DecisionNode[] {
    const parent = this.nodesMap.get(parentId);
    if (!parent) {
      return [];
    }

    return parent.childIds
      .map((id) => this.nodesMap.get(id))
      .filter((node): node is DecisionNode => node !== undefined);
  }

  /**
   * Get the node stack depth (for nesting visualization)
   */
  getCurrentDepth(): number {
    return this.nodeStack.length;
  }

  /**
   * Check if the parser has any nodes
   */
  hasNodes(): boolean {
    return this.nodesMap.size > 0;
  }

  /**
   * Get parser statistics
   */
  getStats(): {
    totalNodes: number;
    activeNodes: number;
    completedNodes: number;
    failedNodes: number;
    toolCalls: number;
    maxDepth: number;
  } {
    const nodes = Array.from(this.nodesMap.values());

    let maxDepth = 0;
    let activeNodes = 0;
    let completedNodes = 0;
    let failedNodes = 0;
    let toolCalls = 0;

    for (const node of nodes) {
      if (node.depth > maxDepth) {
        maxDepth = node.depth;
      }

      switch (node.status) {
        case 'active':
          activeNodes++;
          break;
        case 'completed':
          completedNodes++;
          break;
        case 'failed':
          failedNodes++;
          break;
      }

      if (node.type === 'tool_call') {
        toolCalls++;
      }
    }

    return {
      totalNodes: nodes.length,
      activeNodes,
      completedNodes,
      failedNodes,
      toolCalls,
      maxDepth,
    };
  }
}

/**
 * Singleton instance for use across the main process
 */
export const reasoningParser = new ReasoningParser();
