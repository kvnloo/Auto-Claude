/**
 * Unit tests for Reasoning Parser
 * Tests log parsing, decision node creation, and tree building
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ReasoningParser } from '../reasoning-parser';

describe('ReasoningParser', () => {
  let parser: ReasoningParser;

  beforeEach(() => {
    parser = new ReasoningParser();
    parser.reset('test-task-123');
  });

  describe('reset', () => {
    it('should reset all state to initial values', () => {
      // First, add some data
      parser.parseLog('Planning: Design the implementation');
      expect(parser.hasNodes()).toBe(true);

      // Reset
      parser.reset('new-task');

      expect(parser.getNodes()).toHaveLength(0);
      expect(parser.getEdges()).toHaveLength(0);
      expect(parser.getCurrentDepth()).toBe(0);
      expect(parser.hasNodes()).toBe(false);
    });

    it('should accept optional taskId', () => {
      parser.reset();
      expect(parser.hasNodes()).toBe(false);
    });
  });

  describe('getNodes', () => {
    it('should return empty array when no nodes', () => {
      const nodes = parser.getNodes();
      expect(nodes).toEqual([]);
    });

    it('should return all nodes', () => {
      parser.parseLog('Planning: Step 1');
      parser.parseLog('Analyzing: Step 2');

      const nodes = parser.getNodes();
      expect(nodes).toHaveLength(2);
    });
  });

  describe('getEdges', () => {
    it('should return empty array when no edges', () => {
      const edges = parser.getEdges();
      expect(edges).toEqual([]);
    });

    it('should create edges between parent and child nodes', () => {
      // First node becomes root (no parent)
      parser.parseLog('Planning: Parent decision');
      // Second node becomes child of first
      parser.parseLog('Analyzing: Child decision');

      const edges = parser.getEdges();
      expect(edges).toHaveLength(1);
      expect(edges[0].source).toBe('decision-1');
      expect(edges[0].target).toBe('decision-2');
    });
  });

  describe('getNode', () => {
    it('should return undefined for non-existent node', () => {
      const node = parser.getNode('nonexistent');
      expect(node).toBeUndefined();
    });

    it('should return node by ID', () => {
      parser.parseLog('Planning: Test decision');

      const node = parser.getNode('decision-1');
      expect(node).toBeDefined();
      expect(node?.type).toBe('planning');
    });
  });

  describe('parseLog', () => {
    it('should return null for empty log', () => {
      const result = parser.parseLog('');
      expect(result).toBeNull();
    });

    it('should return null for whitespace-only log', () => {
      const result = parser.parseLog('   \n\t   ');
      expect(result).toBeNull();
    });

    it('should return null for unrecognized patterns', () => {
      const result = parser.parseLog('Just some random text without patterns');
      expect(result).toBeNull();
    });

    it('should reset state when taskId changes', () => {
      parser.parseLog('Planning: First task', 'task-1');
      expect(parser.getNodes()).toHaveLength(1);

      parser.parseLog('Planning: Second task', 'task-2');
      // Should reset and have only the new node
      expect(parser.getNodes()).toHaveLength(1);
    });
  });

  describe('parseDecisionPattern', () => {
    describe('planning patterns', () => {
      it('should parse "Planning:" pattern', () => {
        const result = parser.parseLog('Planning: Design the component');

        expect(result).not.toBeNull();
        expect(result?.type).toBe('decision_made');
        expect(result?.decision?.type).toBe('planning');
        expect(result?.decision?.reasoning).toBe('Design the component');
      });

      it('should parse "Plan:" pattern', () => {
        const result = parser.parseLog('Plan: Create API endpoints');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('planning');
      });

      it('should parse "Strategy:" pattern', () => {
        const result = parser.parseLog('Strategy: Use incremental approach');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('planning');
      });

      it('should parse "Approach:" pattern', () => {
        const result = parser.parseLog('Approach: Start with unit tests');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('planning');
      });
    });

    describe('decision patterns', () => {
      it('should parse "Decision:" pattern', () => {
        const result = parser.parseLog('Decision: Use TypeScript');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('execution');
      });

      it('should parse "Deciding:" pattern', () => {
        const result = parser.parseLog('Deciding: Which framework to use');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('execution');
      });

      it('should parse "Choosing:" pattern', () => {
        const result = parser.parseLog('Choosing: React over Vue');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('execution');
      });

      it('should parse "Selected:" pattern', () => {
        const result = parser.parseLog('Selected: PostgreSQL database');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('execution');
      });
    });

    describe('analysis patterns', () => {
      it('should parse "Analyzing:" pattern', () => {
        const result = parser.parseLog('Analyzing: The existing codebase');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('analysis');
      });

      it('should parse "Examining:" pattern', () => {
        const result = parser.parseLog('Examining: File structure');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('analysis');
      });

      it('should parse "Inspecting:" pattern', () => {
        const result = parser.parseLog('Inspecting: The component');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('analysis');
      });
    });

    describe('implicit decision patterns', () => {
      it('should parse "will implement" pattern', () => {
        const result = parser.parseLog('I will implement the feature');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('execution');
      });

      it('should parse "going to implement" pattern', () => {
        const result = parser.parseLog('Going to implement the API');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('execution');
      });

      it('should parse "will use" pattern', () => {
        const result = parser.parseLog('I will use the Read tool');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('execution');
      });

      it('should parse "choosing to use" pattern', () => {
        const result = parser.parseLog('Choosing to use vitest');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('execution');
      });
    });
  });

  describe('parseReasoningPattern', () => {
    it('should parse "Thinking:" pattern', () => {
      const result = parser.parseLog('Thinking: About the best approach');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('reasoning_update');
      expect(result?.reasoning).toBe('About the best approach');
    });

    it('should parse "Reasoning:" pattern', () => {
      const result = parser.parseLog('Reasoning: We need to consider performance');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('reasoning_update');
    });

    it('should parse "Considering:" pattern', () => {
      const result = parser.parseLog('Considering: Alternative implementations');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('reasoning_update');
    });

    it('should parse "Evaluating:" pattern', () => {
      const result = parser.parseLog('Evaluating: The tradeoffs');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('reasoning_update');
    });

    it('should parse <thinking> block pattern', () => {
      const result = parser.parseLog('<thinking>This is the agent thinking</thinking>');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('reasoning_update');
      expect(result?.reasoning).toBe('This is the agent thinking');
    });

    it('should parse incomplete <thinking> block', () => {
      const result = parser.parseLog('<thinking>Still thinking about this');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('reasoning_update');
    });
  });

  describe('parseToolCallPattern', () => {
    describe('explicit tool patterns', () => {
      it('should parse "Invoking tool" pattern', () => {
        const result = parser.parseLog('Invoking tool "Grep" with pattern');

        expect(result).not.toBeNull();
        expect(result?.type).toBe('decision_made');
        expect(result?.decision?.type).toBe('tool_call');
        expect(result?.decision?.toolName).toBe('Grep');
      });

      it('should parse "Calling" pattern', () => {
        const result = parser.parseLog('Calling Read with file path');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('tool_call');
      });

      it('should parse "Running command" pattern', () => {
        const result = parser.parseLog('Running command "npm test"');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('tool_call');
      });

      it('should parse "Reading file" pattern', () => {
        const result = parser.parseLog('Reading file "src/index.ts"');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('tool_call');
      });

      it('should parse "Writing" pattern', () => {
        const result = parser.parseLog('Writing to "output.txt"');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('tool_call');
      });
    });

    describe('implicit tool patterns', () => {
      it('should detect grep usage', () => {
        const result = parser.parseLog('Using grep to search for patterns');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('tool_call');
        expect(result?.decision?.toolName).toBe('Grep');
      });

      it('should detect searching for pattern', () => {
        const result = parser.parseLog('Searching for the function definition');

        expect(result).not.toBeNull();
        expect(result?.decision?.type).toBe('tool_call');
        expect(result?.decision?.toolName).toBe('Grep');
      });

      it('should detect Read tool usage', () => {
        const result = parser.parseLog('Using Read tool to get file contents');

        expect(result).not.toBeNull();
        expect(result?.decision?.toolName).toBe('Read');
      });

      it('should detect reading file', () => {
        // Use "read tool" phrase to trigger implicit pattern, not explicit "Reading file"
        const result = parser.parseLog('Let me use the read tool');

        expect(result).not.toBeNull();
        expect(result?.decision?.toolName).toBe('Read');
      });

      it('should detect Write tool usage', () => {
        const result = parser.parseLog('Using write tool to save changes');

        expect(result).not.toBeNull();
        expect(result?.decision?.toolName).toBe('Write');
      });

      it('should detect writing to file', () => {
        // Use "write tool" phrase to trigger implicit pattern
        const result = parser.parseLog('Need to use the write tool here');

        expect(result).not.toBeNull();
        expect(result?.decision?.toolName).toBe('Write');
      });

      it('should detect Edit tool usage', () => {
        const result = parser.parseLog('Using edit tool to modify file');

        expect(result).not.toBeNull();
        expect(result?.decision?.toolName).toBe('Edit');
      });

      it('should detect editing', () => {
        // Use "edit tool" phrase to trigger implicit pattern
        const result = parser.parseLog('Need to use the edit tool');

        expect(result).not.toBeNull();
        expect(result?.decision?.toolName).toBe('Edit');
      });

      it('should detect Bash tool usage', () => {
        const result = parser.parseLog('Using bash to run tests');

        expect(result).not.toBeNull();
        expect(result?.decision?.toolName).toBe('Bash');
      });

      it('should detect running command', () => {
        // Use "running command" phrase mid-sentence to trigger implicit pattern
        const result = parser.parseLog('Now running command for the build');

        expect(result).not.toBeNull();
        expect(result?.decision?.toolName).toBe('Bash');
      });
    });
  });

  describe('parseCompletionPattern', () => {
    it('should parse "Result:" pattern', () => {
      const result = parser.parseLog('Result: Tests passed successfully');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('decision_completed');
    });

    it('should parse "Output:" pattern', () => {
      const result = parser.parseLog('Output: Build completed');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('decision_completed');
    });

    it('should parse "Complete:" pattern', () => {
      const result = parser.parseLog('Complete: Feature implemented');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('decision_completed');
    });

    it('should parse "Done:" pattern', () => {
      const result = parser.parseLog('Done: All tests pass');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('decision_completed');
    });

    it('should parse "Successfully:" pattern', () => {
      const result = parser.parseLog('Successfully: Deployed to staging');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('decision_completed');
    });

    it('should mark parent node as completed', () => {
      // Create a parent node first
      parser.parseLog('Planning: Implement feature');
      const node = parser.getNode('decision-1');
      expect(node?.status).toBe('active');

      // Complete it
      parser.parseLog('Result: Feature done');

      // Check parent status
      const updatedNode = parser.getNode('decision-1');
      expect(updatedNode?.status).toBe('completed');
    });

    it('should parse "subtask completed" pattern', () => {
      // Pattern requires literal "subtask completed" or "subtask done" substring
      const result = parser.parseLog('The subtask completed successfully');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('decision_completed');
    });

    it('should parse "build complete" pattern', () => {
      const result = parser.parseLog('=== Build Complete ===');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('agent_completed');
    });
  });

  describe('parseErrorPattern', () => {
    it('should parse "Error:" pattern', () => {
      const result = parser.parseLog('Error: Failed to compile');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('decision_failed');
      expect(result?.error).toBe('Failed to compile');
    });

    it('should parse "Failed:" pattern', () => {
      const result = parser.parseLog('Failed: Test assertion');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('decision_failed');
    });

    it('should parse "Exception:" pattern', () => {
      const result = parser.parseLog('Exception: Null pointer');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('decision_failed');
    });

    it('should parse "Fatal:" pattern', () => {
      const result = parser.parseLog('Fatal: Out of memory');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('decision_failed');
    });

    it('should mark parent node as failed', () => {
      // Create a parent node first
      parser.parseLog('Planning: Implement feature');
      const node = parser.getNode('decision-1');
      expect(node?.status).toBe('active');

      // Fail it
      parser.parseLog('Error: Compilation failed');

      // Check parent status
      const updatedNode = parser.getNode('decision-1');
      expect(updatedNode?.status).toBe('failed');
      expect(updatedNode?.error).toBe('Compilation failed');
    });

    it('should parse "build failed" pattern', () => {
      const result = parser.parseLog('Build failed with errors');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('agent_stopped');
    });

    it('should parse "execution failed" pattern', () => {
      const result = parser.parseLog('Execution failed due to timeout');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('agent_stopped');
    });
  });

  describe('updateNodeStatus', () => {
    it('should return undefined for non-existent node', () => {
      const result = parser.updateNodeStatus({
        nodeId: 'nonexistent',
        status: 'completed'
      });

      expect(result).toBeUndefined();
    });

    it('should update node status', () => {
      parser.parseLog('Planning: Create component');

      const result = parser.updateNodeStatus({
        nodeId: 'decision-1',
        status: 'completed'
      });

      expect(result).toBeDefined();
      expect(result?.status).toBe('completed');
    });

    it('should update node result', () => {
      parser.parseLog('Planning: Create component');

      const result = parser.updateNodeStatus({
        nodeId: 'decision-1',
        status: 'completed',
        result: 'Component created successfully'
      });

      expect(result?.result).toBe('Component created successfully');
    });

    it('should update node error', () => {
      parser.parseLog('Planning: Create component');

      const result = parser.updateNodeStatus({
        nodeId: 'decision-1',
        status: 'failed',
        error: 'Missing dependency'
      });

      expect(result?.error).toBe('Missing dependency');
    });

    it('should update edge animation on completion', () => {
      parser.parseLog('Planning: Parent');
      parser.parseLog('Analyzing: Child');

      // Get edge before update
      const edges = parser.getEdges();
      expect(edges[0].animated).toBe(true);

      // Complete the child node
      parser.updateNodeStatus({
        nodeId: 'decision-2',
        status: 'completed'
      });

      // Edge should no longer be animated
      const updatedEdges = parser.getEdges();
      expect(updatedEdges[0].animated).toBe(false);
    });

    it('should pop node from stack when completed', () => {
      parser.parseLog('Planning: First');
      expect(parser.getCurrentDepth()).toBe(1);

      parser.updateNodeStatus({
        nodeId: 'decision-1',
        status: 'completed'
      });

      expect(parser.getCurrentDepth()).toBe(0);
    });

    it('should pop node from stack when failed', () => {
      parser.parseLog('Planning: First');
      expect(parser.getCurrentDepth()).toBe(1);

      parser.updateNodeStatus({
        nodeId: 'decision-1',
        status: 'failed',
        error: 'Some error'
      });

      expect(parser.getCurrentDepth()).toBe(0);
    });
  });

  describe('getActiveNode', () => {
    it('should return undefined when no active node', () => {
      const active = parser.getActiveNode();
      expect(active).toBeUndefined();
    });

    it('should return the current active node', () => {
      parser.parseLog('Planning: Active decision');

      const active = parser.getActiveNode();
      expect(active).toBeDefined();
      expect(active?.id).toBe('decision-1');
    });

    it('should return the most recently pushed node', () => {
      parser.parseLog('Planning: First');
      parser.parseLog('Analyzing: Second');

      const active = parser.getActiveNode();
      expect(active?.id).toBe('decision-2');
    });
  });

  describe('getRootNodes', () => {
    it('should return empty array when no nodes', () => {
      const roots = parser.getRootNodes();
      expect(roots).toEqual([]);
    });

    it('should return only root nodes', () => {
      // Create first root
      parser.parseLog('Planning: Root 1');
      // Complete it to pop from stack
      parser.updateNodeStatus({ nodeId: 'decision-1', status: 'completed' });

      // Create second root (since stack is empty, this becomes a new root)
      parser.parseLog('Planning: Root 2');

      const roots = parser.getRootNodes();
      expect(roots).toHaveLength(2);
      expect(roots.map(r => r.id)).toContain('decision-1');
      expect(roots.map(r => r.id)).toContain('decision-2');
    });
  });

  describe('getChildNodes', () => {
    it('should return empty array for non-existent parent', () => {
      const children = parser.getChildNodes('nonexistent');
      expect(children).toEqual([]);
    });

    it('should return empty array for node with no children', () => {
      parser.parseLog('Planning: Lone node');

      const children = parser.getChildNodes('decision-1');
      expect(children).toEqual([]);
    });

    it('should return child nodes', () => {
      // Create parent
      parser.parseLog('Planning: Parent');
      // Create first child (becomes child of parent)
      parser.parseLog('Analyzing: Child 1');
      // Complete child 1 to pop it from stack
      parser.updateNodeStatus({ nodeId: 'decision-2', status: 'completed' });
      // Now create second child (parent is back at top of stack)
      parser.parseLog('Examining: Child 2');

      const children = parser.getChildNodes('decision-1');
      expect(children).toHaveLength(2);
    });
  });

  describe('getCurrentDepth', () => {
    it('should return 0 when no nodes', () => {
      expect(parser.getCurrentDepth()).toBe(0);
    });

    it('should increase with nested decisions', () => {
      parser.parseLog('Planning: Level 0');
      expect(parser.getCurrentDepth()).toBe(1);

      parser.parseLog('Analyzing: Level 1');
      expect(parser.getCurrentDepth()).toBe(2);

      parser.parseLog('Examining: Level 2');
      expect(parser.getCurrentDepth()).toBe(3);
    });
  });

  describe('hasNodes', () => {
    it('should return false when no nodes', () => {
      expect(parser.hasNodes()).toBe(false);
    });

    it('should return true when has nodes', () => {
      parser.parseLog('Planning: First node');
      expect(parser.hasNodes()).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return zeroed stats when no nodes', () => {
      const stats = parser.getStats();

      expect(stats.totalNodes).toBe(0);
      expect(stats.activeNodes).toBe(0);
      expect(stats.completedNodes).toBe(0);
      expect(stats.failedNodes).toBe(0);
      expect(stats.toolCalls).toBe(0);
      expect(stats.maxDepth).toBe(0);
    });

    it('should count nodes correctly', () => {
      parser.parseLog('Planning: First');
      parser.parseLog('Analyzing: Second');
      parser.parseLog('Using grep to find pattern');

      const stats = parser.getStats();

      expect(stats.totalNodes).toBe(3);
      expect(stats.activeNodes).toBe(3);
      expect(stats.toolCalls).toBe(1);
    });

    it('should count completed nodes', () => {
      parser.parseLog('Planning: First');
      parser.updateNodeStatus({ nodeId: 'decision-1', status: 'completed' });

      const stats = parser.getStats();

      expect(stats.completedNodes).toBe(1);
      expect(stats.activeNodes).toBe(0);
    });

    it('should count failed nodes', () => {
      parser.parseLog('Planning: First');
      parser.updateNodeStatus({ nodeId: 'decision-1', status: 'failed', error: 'Error' });

      const stats = parser.getStats();

      expect(stats.failedNodes).toBe(1);
      expect(stats.activeNodes).toBe(0);
    });

    it('should track max depth', () => {
      parser.parseLog('Planning: Level 0');
      parser.parseLog('Analyzing: Level 1');
      parser.parseLog('Examining: Level 2');

      const stats = parser.getStats();

      expect(stats.maxDepth).toBe(2);
    });
  });

  describe('node creation', () => {
    it('should generate unique node IDs', () => {
      parser.parseLog('Planning: First');
      parser.parseLog('Planning: Second');
      parser.parseLog('Planning: Third');

      const nodes = parser.getNodes();
      const ids = nodes.map(n => n.id);

      expect(new Set(ids).size).toBe(3);
      expect(ids).toContain('decision-1');
      expect(ids).toContain('decision-2');
      expect(ids).toContain('decision-3');
    });

    it('should set correct depth for nested nodes', () => {
      parser.parseLog('Planning: Level 0');
      parser.parseLog('Analyzing: Level 1');
      parser.parseLog('Examining: Level 2');

      expect(parser.getNode('decision-1')?.depth).toBe(0);
      expect(parser.getNode('decision-2')?.depth).toBe(1);
      expect(parser.getNode('decision-3')?.depth).toBe(2);
    });

    it('should set parentId correctly', () => {
      parser.parseLog('Planning: Parent');
      parser.parseLog('Analyzing: Child');

      const child = parser.getNode('decision-2');
      expect(child?.parentId).toBe('decision-1');
    });

    it('should update parent childIds', () => {
      parser.parseLog('Planning: Parent');
      parser.parseLog('Analyzing: Child');

      const parent = parser.getNode('decision-1');
      expect(parent?.childIds).toContain('decision-2');
    });

    it('should create labels with proper truncation', () => {
      const longText = 'This is a very long description that should be truncated';
      parser.parseLog(`Planning: ${longText}`);

      const node = parser.getNode('decision-1');
      expect(node?.label.length).toBeLessThanOrEqual(50);
      expect(node?.label).toContain('...');
    });

    it('should preserve full reasoning text', () => {
      const longText = 'This is a very long description that should not be truncated in the reasoning field';
      parser.parseLog(`Planning: ${longText}`);

      const node = parser.getNode('decision-1');
      expect(node?.reasoning).toBe(longText);
    });

    it('should set initial status to active', () => {
      parser.parseLog('Planning: New decision');

      const node = parser.getNode('decision-1');
      expect(node?.status).toBe('active');
    });

    it('should set timestamp on node creation', () => {
      parser.parseLog('Planning: Timed decision');

      const node = parser.getNode('decision-1');
      expect(node?.timestamp).toBeDefined();
      expect(new Date(node!.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should set childIds to empty array initially', () => {
      parser.parseLog('Planning: New node');

      const node = parser.getNode('decision-1');
      expect(node?.childIds).toEqual([]);
    });
  });

  describe('edge creation', () => {
    it('should create edges with correct IDs', () => {
      parser.parseLog('Planning: Parent');
      parser.parseLog('Analyzing: Child');

      const edges = parser.getEdges();
      expect(edges[0].id).toBe('edge-decision-1-decision-2');
    });

    it('should set edge type to default', () => {
      parser.parseLog('Planning: Parent');
      parser.parseLog('Analyzing: Child');

      const edges = parser.getEdges();
      expect(edges[0].type).toBe('default');
    });

    it('should set edges as animated initially', () => {
      parser.parseLog('Planning: Parent');
      parser.parseLog('Analyzing: Child');

      const edges = parser.getEdges();
      expect(edges[0].animated).toBe(true);
    });

    it('should not create edge for root node', () => {
      parser.parseLog('Planning: Root node');

      const edges = parser.getEdges();
      expect(edges).toHaveLength(0);
    });
  });

  describe('case insensitivity', () => {
    it('should parse PLANNING: pattern', () => {
      const result = parser.parseLog('PLANNING: Uppercase pattern');
      expect(result).not.toBeNull();
      expect(result?.decision?.type).toBe('planning');
    });

    it('should parse Error: pattern', () => {
      const result = parser.parseLog('ERROR: Uppercase error');
      expect(result).not.toBeNull();
      expect(result?.type).toBe('decision_failed');
    });

    it('should parse mixed case patterns', () => {
      const result = parser.parseLog('AnAlYzInG: Mixed case');
      expect(result).not.toBeNull();
      expect(result?.decision?.type).toBe('analysis');
    });
  });

  describe('event taskId', () => {
    it('should include taskId in events', () => {
      const result = parser.parseLog('Planning: With task ID');

      expect(result?.taskId).toBe('test-task-123');
    });

    it('should use "unknown" when no taskId set', () => {
      parser.reset();
      const result = parser.parseLog('Planning: No task ID');

      expect(result?.taskId).toBe('unknown');
    });
  });

  describe('timestamp in events', () => {
    it('should include timestamp in events', () => {
      const before = new Date().toISOString();
      const result = parser.parseLog('Planning: Timestamped event');
      const after = new Date().toISOString();

      expect(result?.timestamp).toBeDefined();
      expect(result?.timestamp! >= before).toBe(true);
      expect(result?.timestamp! <= after).toBe(true);
    });
  });
});
