/**
 * Unit tests for Insights Store
 * Tests Zustand store for insights chat state management, including file attachments
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useInsightsStore, sendMessage } from '../stores/insights-store';
import type { AttachedFile, InsightsChatMessage, InsightsSession } from '../../shared/types';

// Mock the window.electronAPI
const mockSendInsightsMessage = vi.fn();
vi.stubGlobal('window', {
  electronAPI: {
    sendInsightsMessage: mockSendInsightsMessage
  }
});

// Helper to create test attached file
function createTestAttachment(overrides: Partial<AttachedFile> = {}): AttachedFile {
  return {
    id: `file-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    filename: 'test-file.txt',
    mimeType: 'text/plain',
    size: 1024,
    data: 'dGVzdCBjb250ZW50', // base64 for "test content"
    status: 'ready',
    ...overrides
  };
}

// Helper to create test message
function createTestMessage(overrides: Partial<InsightsChatMessage> = {}): InsightsChatMessage {
  return {
    id: `msg-${Date.now()}`,
    role: 'user',
    content: 'Test message',
    timestamp: new Date(),
    ...overrides
  };
}

// Helper to create test session
function createTestSession(overrides: Partial<InsightsSession> = {}): InsightsSession {
  return {
    id: `session-${Date.now()}`,
    projectId: 'test-project',
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    title: 'Test Session',
    ...overrides
  };
}

describe('Insights Store', () => {
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
      attachedFiles: [],
      isDragging: false
    });

    // Clear mock calls
    mockSendInsightsMessage.mockClear();
  });

  describe('Attachment State Management', () => {
    it('should add attachment to state', () => {
      const store = useInsightsStore.getState();
      const attachment = createTestAttachment();

      store.addAttachment(attachment);

      const state = useInsightsStore.getState();
      expect(state.attachedFiles).toHaveLength(1);
      expect(state.attachedFiles[0]).toEqual(attachment);
    });

    it('should add multiple attachments', () => {
      const store = useInsightsStore.getState();
      const attachment1 = createTestAttachment({ filename: 'file1.txt' });
      const attachment2 = createTestAttachment({ filename: 'file2.txt' });

      store.addAttachment(attachment1);
      store.addAttachment(attachment2);

      const state = useInsightsStore.getState();
      expect(state.attachedFiles).toHaveLength(2);
      expect(state.attachedFiles[0].filename).toBe('file1.txt');
      expect(state.attachedFiles[1].filename).toBe('file2.txt');
    });

    it('should remove attachment by id', () => {
      const store = useInsightsStore.getState();
      const attachment1 = createTestAttachment({ id: 'file-1', filename: 'file1.txt' });
      const attachment2 = createTestAttachment({ id: 'file-2', filename: 'file2.txt' });

      store.addAttachment(attachment1);
      store.addAttachment(attachment2);
      store.removeAttachment('file-1');

      const state = useInsightsStore.getState();
      expect(state.attachedFiles).toHaveLength(1);
      expect(state.attachedFiles[0].id).toBe('file-2');
    });

    it('should clear all attachments', () => {
      const store = useInsightsStore.getState();
      store.addAttachment(createTestAttachment());
      store.addAttachment(createTestAttachment());

      store.clearAttachments();

      const state = useInsightsStore.getState();
      expect(state.attachedFiles).toHaveLength(0);
    });

    it('should set dragging state', () => {
      const store = useInsightsStore.getState();

      expect(store.isDragging).toBe(false);
      store.setDragging(true);
      expect(useInsightsStore.getState().isDragging).toBe(true);
      store.setDragging(false);
      expect(useInsightsStore.getState().isDragging).toBe(false);
    });

    it('should clear attachments on clearSession', () => {
      const store = useInsightsStore.getState();
      store.addAttachment(createTestAttachment());
      store.setDragging(true);

      store.clearSession();

      const state = useInsightsStore.getState();
      expect(state.attachedFiles).toHaveLength(0);
      expect(state.isDragging).toBe(false);
    });
  });

  describe('sendMessage with Attachments', () => {
    it('should pass attachments to IPC when sending message', () => {
      const store = useInsightsStore.getState();
      const attachment = createTestAttachment();

      // Setup session
      store.setSession(createTestSession());
      store.addAttachment(attachment);

      // Send message
      sendMessage('test-project', 'Hello with attachment');

      // Verify IPC was called with attachments
      expect(mockSendInsightsMessage).toHaveBeenCalledTimes(1);
      expect(mockSendInsightsMessage).toHaveBeenCalledWith(
        'test-project',
        'Hello with attachment',
        undefined, // modelConfig
        [attachment] // attachments array
      );
    });

    it('should include attachments in user message added to session', () => {
      const store = useInsightsStore.getState();
      const attachment = createTestAttachment();

      // Setup session
      store.setSession(createTestSession());
      store.addAttachment(attachment);

      // Send message
      sendMessage('test-project', 'Hello with attachment');

      // Verify message was added with attachments
      const state = useInsightsStore.getState();
      const messages = state.session?.messages || [];
      expect(messages).toHaveLength(1);
      expect(messages[0].attachments).toBeDefined();
      expect(messages[0].attachments).toHaveLength(1);
      expect(messages[0].attachments![0]).toEqual(attachment);
    });

    it('should clear attachments after sending message', () => {
      const store = useInsightsStore.getState();
      const attachment = createTestAttachment();

      // Setup session
      store.setSession(createTestSession());
      store.addAttachment(attachment);
      expect(useInsightsStore.getState().attachedFiles).toHaveLength(1);

      // Send message
      sendMessage('test-project', 'Hello with attachment');

      // Verify attachments are cleared
      const state = useInsightsStore.getState();
      expect(state.attachedFiles).toHaveLength(0);
    });

    it('should send empty array when no attachments', () => {
      const store = useInsightsStore.getState();

      // Setup session without attachments
      store.setSession(createTestSession());

      // Send message
      sendMessage('test-project', 'Hello without attachment');

      // Verify IPC was called with empty attachments array
      expect(mockSendInsightsMessage).toHaveBeenCalledWith(
        'test-project',
        'Hello without attachment',
        undefined,
        [] // empty attachments array
      );
    });

    it('should not include attachments property in message when array is empty', () => {
      const store = useInsightsStore.getState();

      // Setup session without attachments
      store.setSession(createTestSession());

      // Send message
      sendMessage('test-project', 'Hello without attachment');

      // Verify message was added without attachments property
      const state = useInsightsStore.getState();
      const messages = state.session?.messages || [];
      expect(messages).toHaveLength(1);
      expect(messages[0].attachments).toBeUndefined();
    });
  });

  describe('Message with Attachments Display', () => {
    it('should store message with attachments in session', () => {
      const store = useInsightsStore.getState();
      const attachment = createTestAttachment();

      const message = createTestMessage({
        attachments: [attachment]
      });

      store.setSession(createTestSession());
      store.addMessage(message);

      const state = useInsightsStore.getState();
      expect(state.session?.messages[0].attachments).toHaveLength(1);
      expect(state.session?.messages[0].attachments![0]).toEqual(attachment);
    });
  });

  describe('Session Management', () => {
    it('should set session correctly', () => {
      const store = useInsightsStore.getState();
      const session = createTestSession();

      store.setSession(session);

      const state = useInsightsStore.getState();
      expect(state.session).toEqual(session);
    });

    it('should add message to session', () => {
      const store = useInsightsStore.getState();
      const session = createTestSession();
      const message = createTestMessage();

      store.setSession(session);
      store.addMessage(message);

      const state = useInsightsStore.getState();
      expect(state.session?.messages).toHaveLength(1);
      expect(state.session?.messages[0]).toEqual(message);
    });

    it('should create session when adding message without existing session', () => {
      const store = useInsightsStore.getState();
      const message = createTestMessage();

      store.addMessage(message);

      const state = useInsightsStore.getState();
      expect(state.session).not.toBeNull();
      expect(state.session?.messages).toHaveLength(1);
    });
  });

  describe('Streaming Content', () => {
    it('should append streaming content', () => {
      const store = useInsightsStore.getState();

      store.appendStreamingContent('Hello ');
      store.appendStreamingContent('World');

      const state = useInsightsStore.getState();
      expect(state.streamingContent).toBe('Hello World');
    });

    it('should clear streaming content', () => {
      const store = useInsightsStore.getState();
      store.appendStreamingContent('Some content');

      store.clearStreamingContent();

      const state = useInsightsStore.getState();
      expect(state.streamingContent).toBe('');
    });

    it('should finalize streaming message and add to session', () => {
      const store = useInsightsStore.getState();
      store.setSession(createTestSession());
      store.appendStreamingContent('Final message');

      store.finalizeStreamingMessage();

      const state = useInsightsStore.getState();
      expect(state.streamingContent).toBe('');
      expect(state.session?.messages).toHaveLength(1);
      expect(state.session?.messages[0].role).toBe('assistant');
      expect(state.session?.messages[0].content).toBe('Final message');
    });
  });

  describe('Tool Usage', () => {
    it('should set and clear current tool', () => {
      const store = useInsightsStore.getState();

      store.setCurrentTool({ name: 'Read', input: 'test.txt' });
      expect(useInsightsStore.getState().currentTool).toEqual({ name: 'Read', input: 'test.txt' });

      store.setCurrentTool(null);
      expect(useInsightsStore.getState().currentTool).toBeNull();
    });

    it('should add tool usage', () => {
      const store = useInsightsStore.getState();

      store.addToolUsage({ name: 'Read', input: 'test.txt' });
      store.addToolUsage({ name: 'Grep', input: 'pattern' });

      const state = useInsightsStore.getState();
      expect(state.toolsUsed).toHaveLength(2);
    });

    it('should clear tools used', () => {
      const store = useInsightsStore.getState();
      store.addToolUsage({ name: 'Read' });

      store.clearToolsUsed();

      const state = useInsightsStore.getState();
      expect(state.toolsUsed).toHaveLength(0);
    });
  });
});
