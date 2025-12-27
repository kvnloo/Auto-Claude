/**
 * Unit tests for Insights Store - Cross-Session Isolation
 * Tests session-scoped state management for proper isolation between conversations
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  useInsightsStore,
  createSessionKey,
  type SessionState
} from '../stores/insights-store';

// Default session state for comparison
function createDefaultSessionState(): SessionState {
  return {
    streamingContent: '',
    currentTool: null,
    status: { phase: 'idle', message: '' },
    toolsUsed: []
  };
}

describe('Insights Store - Cross-Session Isolation', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useInsightsStore.setState({
      session: null,
      sessions: [],
      status: { phase: 'idle', message: '' },
      pendingMessage: '',
      streamingContent: '',
      currentTool: null,
      toolsUsed: [],
      isLoadingSessions: false,
      sessionStates: {},
      activeProjectId: null,
      activeSessionId: null
    });
  });

  afterEach(() => {
    // Clean up any lingering state
    useInsightsStore.setState({
      sessionStates: {},
      activeProjectId: null,
      activeSessionId: null
    });
  });

  describe('createSessionKey', () => {
    it('should create composite key from projectId and sessionId', () => {
      const key = createSessionKey('project-1', 'session-1');
      expect(key).toBe('project-1:session-1');
    });

    it('should create unique keys for different sessions', () => {
      const key1 = createSessionKey('project-1', 'session-1');
      const key2 = createSessionKey('project-1', 'session-2');
      const key3 = createSessionKey('project-2', 'session-1');

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key2).not.toBe(key3);
    });
  });

  describe('setActiveContext', () => {
    it('should set active project and session ids', () => {
      const store = useInsightsStore.getState();
      store.setActiveContext('project-1', 'session-1');

      const state = useInsightsStore.getState();
      expect(state.activeProjectId).toBe('project-1');
      expect(state.activeSessionId).toBe('session-1');
    });

    it('should initialize session state when setting context', () => {
      const store = useInsightsStore.getState();
      store.setActiveContext('project-1', 'session-1');

      const state = useInsightsStore.getState();
      const key = createSessionKey('project-1', 'session-1');
      expect(state.sessionStates[key]).toBeDefined();
      expect(state.sessionStates[key].status.phase).toBe('idle');
    });

    it('should clear global state when setting null context', () => {
      // First set some active state
      const store = useInsightsStore.getState();
      store.setActiveContext('project-1', 'session-1');
      store.appendStreamingContent('some content');
      store.setStatus({ phase: 'streaming', message: 'test' });

      // Now clear context
      store.setActiveContext(null, null);

      const state = useInsightsStore.getState();
      expect(state.activeProjectId).toBeNull();
      expect(state.activeSessionId).toBeNull();
      expect(state.streamingContent).toBe('');
      expect(state.status.phase).toBe('idle');
    });
  });

  describe('getSessionState', () => {
    it('should return default state for non-existent session', () => {
      const store = useInsightsStore.getState();
      const sessionState = store.getSessionState('project-x', 'session-x');

      expect(sessionState.streamingContent).toBe('');
      expect(sessionState.currentTool).toBeNull();
      expect(sessionState.status.phase).toBe('idle');
      expect(sessionState.toolsUsed).toHaveLength(0);
    });

    it('should return existing session state', () => {
      const store = useInsightsStore.getState();
      store.setActiveContext('project-1', 'session-1');
      store.appendToSessionStreamingContent('project-1', 'session-1', 'test content');

      const sessionState = store.getSessionState('project-1', 'session-1');
      expect(sessionState.streamingContent).toBe('test content');
    });
  });

  describe('getActiveSessionState', () => {
    it('should return null when no active context', () => {
      const store = useInsightsStore.getState();
      const activeState = store.getActiveSessionState();

      expect(activeState).toBeNull();
    });

    it('should return active session state', () => {
      const store = useInsightsStore.getState();
      store.setActiveContext('project-1', 'session-1');
      store.appendToSessionStreamingContent('project-1', 'session-1', 'active content');

      const activeState = store.getActiveSessionState();
      expect(activeState).not.toBeNull();
      expect(activeState?.streamingContent).toBe('active content');
    });
  });

  describe('isActiveSession', () => {
    it('should return true for active session', () => {
      const store = useInsightsStore.getState();
      store.setActiveContext('project-1', 'session-1');

      expect(store.isActiveSession('project-1', 'session-1')).toBe(true);
    });

    it('should return false for inactive session', () => {
      const store = useInsightsStore.getState();
      store.setActiveContext('project-1', 'session-1');

      expect(store.isActiveSession('project-1', 'session-2')).toBe(false);
      expect(store.isActiveSession('project-2', 'session-1')).toBe(false);
    });
  });

  describe('Cross-Session State Isolation', () => {
    it('should maintain separate streaming content for different sessions', () => {
      const store = useInsightsStore.getState();

      // Set up session A
      store.setActiveContext('project-1', 'session-A');
      store.appendToSessionStreamingContent('project-1', 'session-A', 'Content for A');

      // Set up session B (without changing active context)
      store.initializeSessionState('project-1', 'session-B');
      store.appendToSessionStreamingContent('project-1', 'session-B', 'Content for B');

      // Verify each session has its own content
      const stateA = store.getSessionState('project-1', 'session-A');
      const stateB = store.getSessionState('project-1', 'session-B');

      expect(stateA.streamingContent).toBe('Content for A');
      expect(stateB.streamingContent).toBe('Content for B');
    });

    it('should maintain separate tool indicators for different sessions', () => {
      const store = useInsightsStore.getState();

      // Set up session A with a tool
      store.setActiveContext('project-1', 'session-A');
      store.setSessionCurrentTool('project-1', 'session-A', {
        name: 'Read',
        input: 'file-A.txt'
      });

      // Set up session B with a different tool
      store.initializeSessionState('project-1', 'session-B');
      store.setSessionCurrentTool('project-1', 'session-B', {
        name: 'Grep',
        input: 'pattern-B'
      });

      // Verify each session has its own tool
      const stateA = store.getSessionState('project-1', 'session-A');
      const stateB = store.getSessionState('project-1', 'session-B');

      expect(stateA.currentTool?.name).toBe('Read');
      expect(stateA.currentTool?.input).toBe('file-A.txt');
      expect(stateB.currentTool?.name).toBe('Grep');
      expect(stateB.currentTool?.input).toBe('pattern-B');
    });

    it('should maintain separate status for different sessions', () => {
      const store = useInsightsStore.getState();

      // Set session A to streaming status
      store.setActiveContext('project-1', 'session-A');
      store.setSessionStatus('project-1', 'session-A', {
        phase: 'streaming',
        message: 'Processing A...'
      });

      // Set session B to idle status
      store.initializeSessionState('project-1', 'session-B');
      store.setSessionStatus('project-1', 'session-B', {
        phase: 'idle',
        message: ''
      });

      // Verify each session has its own status
      const stateA = store.getSessionState('project-1', 'session-A');
      const stateB = store.getSessionState('project-1', 'session-B');

      expect(stateA.status.phase).toBe('streaming');
      expect(stateB.status.phase).toBe('idle');
    });

    it('should not affect session B when session A is loading', () => {
      const store = useInsightsStore.getState();

      // Session A is actively streaming (simulating agent running)
      store.setActiveContext('project-1', 'session-A');
      store.setSessionStatus('project-1', 'session-A', {
        phase: 'streaming',
        message: 'Agent working...'
      });
      store.setSessionCurrentTool('project-1', 'session-A', {
        name: 'Search',
        input: 'finding files'
      });

      // Initialize session B - should be completely independent
      store.initializeSessionState('project-1', 'session-B');
      const stateB = store.getSessionState('project-1', 'session-B');

      // Session B should NOT inherit A's loading state
      expect(stateB.status.phase).toBe('idle');
      expect(stateB.currentTool).toBeNull();
      expect(stateB.streamingContent).toBe('');

      // CRITICAL: This is the core isolation test
      // When user switches to session B, they should see input textbox enabled
      // and no tool indicators from session A
    });
  });

  describe('Session Switching with State Restoration', () => {
    it('should restore session state when switching back to previous session', () => {
      const store = useInsightsStore.getState();

      // Work in session A
      store.setActiveContext('project-1', 'session-A');
      store.appendToSessionStreamingContent('project-1', 'session-A', 'A content');
      store.setSessionStatus('project-1', 'session-A', {
        phase: 'streaming',
        message: 'Working on A'
      });

      // Switch to session B
      store.setActiveContext('project-1', 'session-B');
      store.appendToSessionStreamingContent('project-1', 'session-B', 'B content');

      // Switch back to session A
      store.setActiveContext('project-1', 'session-A');

      // Session A state should be restored to global state
      const state = useInsightsStore.getState();
      expect(state.streamingContent).toBe('A content');
      expect(state.status.phase).toBe('streaming');
    });

    it('should preserve active session state when switching to new session', () => {
      const store = useInsightsStore.getState();

      // Session A has active work
      store.setActiveContext('project-1', 'session-A');
      store.appendToSessionStreamingContent('project-1', 'session-A', 'A has work');

      // Switch to session B (new session)
      store.setActiveContext('project-1', 'session-B');

      // Session A's state should still be preserved
      const stateA = store.getSessionState('project-1', 'session-A');
      expect(stateA.streamingContent).toBe('A has work');

      // Session B should have clean state
      const state = useInsightsStore.getState();
      expect(state.streamingContent).toBe(''); // Global state shows B (clean)
    });
  });

  describe('Cross-Project Isolation', () => {
    it('should maintain separate state for different projects', () => {
      const store = useInsightsStore.getState();

      // Work in Project X
      store.setActiveContext('project-X', 'session-1');
      store.appendToSessionStreamingContent('project-X', 'session-1', 'Project X content');
      store.setSessionStatus('project-X', 'session-1', {
        phase: 'streaming',
        message: 'Working in X'
      });

      // Work in Project Y
      store.setActiveContext('project-Y', 'session-1');
      store.appendToSessionStreamingContent('project-Y', 'session-1', 'Project Y content');

      // Verify isolation
      const stateX = store.getSessionState('project-X', 'session-1');
      const stateY = store.getSessionState('project-Y', 'session-1');

      expect(stateX.streamingContent).toBe('Project X content');
      expect(stateY.streamingContent).toBe('Project Y content');
      expect(stateX.status.phase).toBe('streaming');
      expect(stateY.status.phase).toBe('idle');
    });

    it('should not leak tool indicators between projects', () => {
      const store = useInsightsStore.getState();

      // Project X has active tool
      store.setActiveContext('project-X', 'session-1');
      store.setSessionCurrentTool('project-X', 'session-1', {
        name: 'Read',
        input: 'X-file.txt'
      });

      // Switch to Project Y
      store.setActiveContext('project-Y', 'session-1');

      // Global state (and UI) should show no tool for Project Y
      const state = useInsightsStore.getState();
      expect(state.currentTool).toBeNull();

      // But Project X's tool should still be preserved
      const stateX = store.getSessionState('project-X', 'session-1');
      expect(stateX.currentTool?.name).toBe('Read');
    });
  });

  describe('UI State Derivation (isLoading)', () => {
    it('should derive isLoading correctly for active session', () => {
      const store = useInsightsStore.getState();

      // Session A is loading
      store.setActiveContext('project-1', 'session-A');
      store.setSessionStatus('project-1', 'session-A', {
        phase: 'streaming',
        message: 'Processing...'
      });

      const activeState = store.getActiveSessionState();
      const isLoading =
        activeState?.status.phase === 'thinking' ||
        activeState?.status.phase === 'streaming';

      expect(isLoading).toBe(true);
    });

    it('should show not loading when switching to idle session', () => {
      const store = useInsightsStore.getState();

      // Session A is loading
      store.setActiveContext('project-1', 'session-A');
      store.setSessionStatus('project-1', 'session-A', {
        phase: 'streaming',
        message: 'Processing...'
      });

      // Switch to idle Session B
      store.setActiveContext('project-1', 'session-B');

      // Session B's isLoading should be false
      const activeState = store.getActiveSessionState();
      const isLoading =
        activeState?.status.phase === 'thinking' ||
        activeState?.status.phase === 'streaming';

      expect(isLoading).toBe(false);
    });

    it('Input textbox should be enabled for session B while A is loading', () => {
      const store = useInsightsStore.getState();

      // Session A is actively processing (agent running)
      store.setActiveContext('project-1', 'session-A');
      store.setSessionStatus('project-1', 'session-A', {
        phase: 'streaming',
        message: 'Agent working...'
      });

      // User creates/switches to session B
      store.setActiveContext('project-1', 'session-B');

      // The UI should derive isLoading from session B's status (idle)
      const activeState = store.getActiveSessionState();
      const isLoading =
        activeState?.status.phase === 'thinking' ||
        activeState?.status.phase === 'streaming';

      // CRITICAL: Input textbox should be ENABLED (not disabled)
      expect(isLoading).toBe(false);
    });
  });

  describe('Tool Indicators Isolation', () => {
    it('should not show tool indicators from session A in session B', () => {
      const store = useInsightsStore.getState();

      // Session A has active tool usage
      store.setActiveContext('project-1', 'session-A');
      store.setSessionCurrentTool('project-1', 'session-A', {
        name: 'Searching files',
        input: 'pattern'
      });
      store.addSessionToolUsage('project-1', 'session-A', {
        name: 'Read',
        input: 'file.ts'
      });

      // Switch to session B
      store.setActiveContext('project-1', 'session-B');

      // Session B should have no tool indicators
      const activeState = store.getActiveSessionState();
      expect(activeState?.currentTool).toBeNull();
      expect(activeState?.toolsUsed).toHaveLength(0);

      // Global state should also reflect session B (no tools)
      const state = useInsightsStore.getState();
      expect(state.currentTool).toBeNull();
    });
  });

  describe('Task Suggestions Isolation', () => {
    it('should store task suggestions in session-specific messages', () => {
      const store = useInsightsStore.getState();

      // Set up session A with a session object and finalize with task suggestion
      store.setActiveContext('project-1', 'session-A');
      store.setSession({
        id: 'session-A',
        projectId: 'project-1',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
      store.appendToSessionStreamingContent('project-1', 'session-A', 'Analysis complete');
      store.finalizeSessionStreamingMessage('project-1', 'session-A', {
        title: 'Task from Session A',
        description: 'Description for task A',
        metadata: { category: 'feature' }
      });

      // The session should contain the message with task suggestion
      const state = useInsightsStore.getState();
      expect(state.session?.messages).toHaveLength(1);
      expect(state.session?.messages[0].suggestedTask?.title).toBe('Task from Session A');
    });

    it('should not carry task suggestions when switching sessions', () => {
      const store = useInsightsStore.getState();

      // Set up session A with a task suggestion
      store.setActiveContext('project-1', 'session-A');
      store.setSession({
        id: 'session-A',
        projectId: 'project-1',
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            content: 'Here is a task suggestion',
            timestamp: new Date(),
            suggestedTask: {
              title: 'Task from Session A',
              description: 'Only for session A'
            }
          }
        ],
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Switch to session B with its own session object
      store.setActiveContext('project-1', 'session-B');
      store.setSession({
        id: 'session-B',
        projectId: 'project-1',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Session B should have no messages (and thus no task suggestions)
      const state = useInsightsStore.getState();
      expect(state.session?.id).toBe('session-B');
      expect(state.session?.messages).toHaveLength(0);
    });

    it('should preserve task suggestions when switching back to previous session', () => {
      const store = useInsightsStore.getState();

      // Create session A with task suggestion message
      const sessionA = {
        id: 'session-A',
        projectId: 'project-1',
        messages: [
          {
            id: 'msg-1',
            role: 'assistant' as const,
            content: 'Analysis complete',
            timestamp: new Date(),
            suggestedTask: {
              title: 'Refactor authentication module',
              description: 'Extract auth logic into separate service'
            }
          }
        ],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Create session B without task suggestions
      const sessionB = {
        id: 'session-B',
        projectId: 'project-1',
        messages: [
          {
            id: 'msg-2',
            role: 'assistant' as const,
            content: 'Regular response without task',
            timestamp: new Date()
          }
        ],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Set session A
      store.setActiveContext('project-1', 'session-A');
      store.setSession(sessionA);

      // Switch to session B
      store.setActiveContext('project-1', 'session-B');
      store.setSession(sessionB);

      // Session B should show its own messages without A's task suggestions
      let state = useInsightsStore.getState();
      expect(state.session?.id).toBe('session-B');
      expect(state.session?.messages[0].suggestedTask).toBeUndefined();

      // Switch back to session A
      store.setActiveContext('project-1', 'session-A');
      store.setSession(sessionA);

      // Session A should still have its task suggestion
      state = useInsightsStore.getState();
      expect(state.session?.id).toBe('session-A');
      expect(state.session?.messages[0].suggestedTask?.title).toBe('Refactor authentication module');
    });

    it('should not leak task suggestions between different projects', () => {
      const store = useInsightsStore.getState();

      // Project X has a session with task suggestion
      const sessionProjectX = {
        id: 'session-1',
        projectId: 'project-X',
        messages: [
          {
            id: 'msg-1',
            role: 'assistant' as const,
            content: 'Project X analysis',
            timestamp: new Date(),
            suggestedTask: {
              title: 'Project X Task',
              description: 'Only for project X'
            }
          }
        ],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Project Y has a session without task suggestion
      const sessionProjectY = {
        id: 'session-1',
        projectId: 'project-Y',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Set up Project X
      store.setActiveContext('project-X', 'session-1');
      store.setSession(sessionProjectX);

      // Verify Project X has task suggestion
      let state = useInsightsStore.getState();
      expect(state.session?.messages[0].suggestedTask?.title).toBe('Project X Task');

      // Switch to Project Y
      store.setActiveContext('project-Y', 'session-1');
      store.setSession(sessionProjectY);

      // Project Y should have no messages or task suggestions
      state = useInsightsStore.getState();
      expect(state.session?.projectId).toBe('project-Y');
      expect(state.session?.messages).toHaveLength(0);
    });

    it('should only finalize task suggestion for active session', () => {
      const store = useInsightsStore.getState();

      // Set up session A as active with a session object
      store.setActiveContext('project-1', 'session-A');
      store.setSession({
        id: 'session-A',
        projectId: 'project-1',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Add streaming content for session A
      store.appendToSessionStreamingContent('project-1', 'session-A', 'Content for A');

      // Initialize session B (background session, not active)
      store.initializeSessionState('project-1', 'session-B');
      store.appendToSessionStreamingContent('project-1', 'session-B', 'Content for B');

      // Finalize session A with task suggestion
      store.finalizeSessionStreamingMessage('project-1', 'session-A', {
        title: 'Task for A',
        description: 'Only for session A'
      });

      // Session A should have the message with task suggestion
      const state = useInsightsStore.getState();
      expect(state.session?.messages).toHaveLength(1);
      expect(state.session?.messages[0].suggestedTask?.title).toBe('Task for A');
      expect(state.session?.messages[0].content).toBe('Content for A');

      // Session B's streaming content should be preserved (not finalized)
      const stateB = store.getSessionState('project-1', 'session-B');
      expect(stateB.streamingContent).toBe('Content for B');
    });

    it('should clear streaming content after task suggestion finalization', () => {
      const store = useInsightsStore.getState();

      // Set up session A
      store.setActiveContext('project-1', 'session-A');
      store.setSession({
        id: 'session-A',
        projectId: 'project-1',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Add streaming content
      store.appendToSessionStreamingContent('project-1', 'session-A', 'Analyzing codebase...');

      // Finalize with task suggestion
      store.finalizeSessionStreamingMessage('project-1', 'session-A', {
        title: 'Add unit tests',
        description: 'Improve test coverage'
      });

      // Streaming content should be cleared in session state
      const sessionState = store.getSessionState('project-1', 'session-A');
      expect(sessionState.streamingContent).toBe('');

      // But the message should be added to the session
      const state = useInsightsStore.getState();
      expect(state.session?.messages[0].content).toBe('Analyzing codebase...');
      expect(state.session?.messages[0].suggestedTask?.title).toBe('Add unit tests');
    });
  });
});
