/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for useXterm keyboard handlers
 * Tests terminal copy/paste keyboard shortcuts and platform detection
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { renderHook, act, render } from '@testing-library/react';
import React from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { useXterm } from '../useXterm';

// Mock xterm.js
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    loadAddon: vi.fn(),
    attachCustomKeyEventHandler: vi.fn(),
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ''),
    paste: vi.fn(),
    input: vi.fn(),
    onData: vi.fn(),
    onResize: vi.fn(),
    dispose: vi.fn(),
    cols: 80,
    rows: 24
  }))
}));

// Mock xterm addons
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn()
  }))
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn()
}));

vi.mock('@xterm/addon-serialize', () => ({
  SerializeAddon: vi.fn().mockImplementation(() => ({
    serialize: vi.fn(() => ''),
    dispose: vi.fn()
  }))
}));

// Mock terminal buffer manager
vi.mock('../../../../lib/terminal-buffer-manager', () => ({
  terminalBufferManager: {
    get: vi.fn(() => ''),
    set: vi.fn(),
    clear: vi.fn()
  }
}));

// Mock navigator.platform for platform detection
const originalNavigatorPlatform = navigator.platform;

// Mock requestAnimationFrame for jsdom environment (not provided by default)
global.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number);

/**
 * Helper function to set up XTerm mocks and render the hook
 * Reduces test boilerplate from ~100 lines to ~20 lines per test
 */
async function setupMockXterm(overrides: {
  hasSelection?: () => boolean;
  getSelection?: () => string;
  paste?: ReturnType<typeof vi.fn>;
  input?: ReturnType<typeof vi.fn>;
} = {}) {
  let keyEventHandler: ((event: KeyboardEvent) => boolean) | null = null;

  // Override XTerm mock to be constructable
  (XTerm as unknown as Mock).mockImplementation(function() {
    return {
      open: vi.fn(),
      loadAddon: vi.fn(),
      attachCustomKeyEventHandler: vi.fn((handler: (event: KeyboardEvent) => boolean) => {
        keyEventHandler = handler;
      }),
      hasSelection: overrides.hasSelection ?? vi.fn(() => false),
      getSelection: overrides.getSelection ?? vi.fn(() => ''),
      paste: overrides.paste ?? vi.fn(),
      input: overrides.input ?? vi.fn(),
      onData: vi.fn(),
      onResize: vi.fn(),
      dispose: vi.fn(),
      write: vi.fn(),
      cols: 80,
      rows: 24
    };
  });

  // Setup addon mocks
  const { FitAddon } = await import('@xterm/addon-fit');
  (FitAddon as unknown as Mock).mockImplementation(function() {
    return { fit: vi.fn() };
  });

  const { WebLinksAddon } = await import('@xterm/addon-web-links');
  (WebLinksAddon as unknown as Mock).mockImplementation(function() {
    return {};
  });

  const { SerializeAddon } = await import('@xterm/addon-serialize');
  (SerializeAddon as unknown as Mock).mockImplementation(function() {
    return {
      serialize: vi.fn(() => ''),
      dispose: vi.fn()
    };
  });

  // Mock ResizeObserver
  global.ResizeObserver = vi.fn().mockImplementation(function() {
    return {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn()
    };
  });

  // Create and render test wrapper component
  const TestWrapper = () => {
    const { terminalRef } = useXterm({ terminalId: 'test-terminal' });
    return React.createElement('div', { ref: terminalRef });
  };

  render(React.createElement(TestWrapper));

  // After rendering, keyEventHandler is guaranteed to be set by attachCustomKeyEventHandler
  // Use non-null assertion since we know the hook will set it
  return {
    keyEventHandler: keyEventHandler!,
    mockInstance: {
      hasSelection: overrides.hasSelection,
      getSelection: overrides.getSelection,
      paste: overrides.paste,
      input: overrides.input
    }
  };
}

describe('useXterm keyboard handlers', () => {
  let mockClipboard: {
    writeText: ReturnType<typeof vi.fn>;
    readText: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Ensure window and navigator exist in test environment
    if (typeof window === 'undefined') {
      (global as { window: unknown }).window = {};
    }
    if (typeof navigator === 'undefined') {
      (global as { navigator: unknown }).navigator = {};
    }

    // Mock navigator.clipboard
    mockClipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue('test clipboard content')
    };

    Object.defineProperty(global.navigator, 'clipboard', {
      value: mockClipboard,
      writable: true,
      configurable: true
    });

    // Mock window.electronAPI
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      sendTerminalInput: vi.fn()
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Reset navigator.platform to original value
    Object.defineProperty(navigator, 'platform', {
      value: originalNavigatorPlatform,
      writable: true
    });
  });

  describe('Platform detection', () => {
    it('should enable paste shortcuts on Windows (CTRL+V)', async () => {
      const mockPaste = vi.fn();

      // Mock Windows platform
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({ paste: mockPaste });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'v',
          ctrlKey: true,
          shiftKey: false
        });

        keyEventHandler(event);
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      // Windows should enable CTRL+V paste
      expect(mockPaste).toHaveBeenCalledWith('test clipboard content');
    });

    it('should enable paste shortcuts on Linux (both CTRL+V and CTRL+SHIFT+V)', async () => {
      const mockPaste = vi.fn();

      // Mock Linux platform
      Object.defineProperty(navigator, 'platform', {
        value: 'Linux',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({ paste: mockPaste });

      // Test CTRL+V
      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'v',
          ctrlKey: true,
          shiftKey: false
        });

        keyEventHandler(event);
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(mockPaste).toHaveBeenCalledTimes(1);

      // Test CTRL+SHIFT+V (Linux-specific)
      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'V',
          ctrlKey: true,
          shiftKey: true
        });

        keyEventHandler(event);
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(mockPaste).toHaveBeenCalledTimes(2);
    });

    it('should enable copy shortcuts on Linux (both CTRL+C and CTRL+SHIFT+C)', async () => {
      const mockHasSelection = vi.fn(() => true);
      const mockGetSelection = vi.fn(() => 'selected text');

      // Mock Linux platform
      Object.defineProperty(navigator, 'platform', {
        value: 'Linux',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({
        hasSelection: mockHasSelection,
        getSelection: mockGetSelection
      });

      // Test CTRL+C (should copy)
      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'c',
          ctrlKey: true,
          shiftKey: false
        });

        keyEventHandler(event);
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(mockClipboard.writeText).toHaveBeenCalledTimes(1);

      // Test CTRL+SHIFT+C (Linux-specific, should also copy)
      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'C',
          ctrlKey: true,
          shiftKey: true
        });

        keyEventHandler(event);
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(mockClipboard.writeText).toHaveBeenCalledTimes(2);
    });

    it('should NOT enable custom paste handler on macOS (uses system Cmd+V)', async () => {
      const mockPaste = vi.fn();

      // Mock macOS platform
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({ paste: mockPaste });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'v',
          ctrlKey: true,
          shiftKey: false
        });

        keyEventHandler(event);
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      // macOS should NOT use custom CTRL+V handler (uses system Cmd+V instead)
      expect(mockPaste).not.toHaveBeenCalled();
    });
  });

  describe('Smart CTRL+C behavior', () => {
    it('should copy to clipboard when text is selected', async () => {
      // Create mock functions that will be shared between the mock instance and our assertions
      const mockHasSelection = vi.fn(() => true);
      const mockGetSelection = vi.fn(() => 'selected text');

      const { keyEventHandler } = await setupMockXterm({
        hasSelection: mockHasSelection,
        getSelection: mockGetSelection
      });

      await act(async () => {
        // Simulate CTRL+C keydown event
        const event = new KeyboardEvent('keydown', {
          key: 'c',
          ctrlKey: true,
          metaKey: false
        });

        const handled = keyEventHandler(event);
        expect(handled).toBe(false); // Should prevent xterm handling

        // Wait for clipboard write
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      // Verify the xterm instance methods were called
      expect(mockHasSelection).toHaveBeenCalled();
      expect(mockGetSelection).toHaveBeenCalled();

      // Verify clipboard.writeText was called with selected text
      expect(mockClipboard.writeText).toHaveBeenCalledWith('selected text');
    });

    it('should send ^C interrupt when no text is selected', async () => {
      const mockHasSelection = vi.fn(() => false);
      const mockGetSelection = vi.fn(() => '');

      const { keyEventHandler } = await setupMockXterm({
        hasSelection: mockHasSelection,
        getSelection: mockGetSelection
      });

      await act(async () => {
        // Simulate CTRL+C keydown event with no selection
        const event = new KeyboardEvent('keydown', {
          key: 'c',
          ctrlKey: true,
          metaKey: false
        });

        const handled = keyEventHandler(event);
        expect(handled).toBe(true); // Should let ^C pass through to terminal
      });

      // Verify clipboard.writeText was NOT called
      expect(mockClipboard.writeText).not.toHaveBeenCalled();
    });

    it('should handle both ctrlKey (Windows/Linux) and metaKey (Mac)', async () => {
      const mockHasSelection = vi.fn(() => true);
      const mockGetSelection = vi.fn(() => 'selected text');

      const { keyEventHandler } = await setupMockXterm({
        hasSelection: mockHasSelection,
        getSelection: mockGetSelection
      });

      // Test ctrlKey (Windows/Linux)
      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'c',
          ctrlKey: true,
          metaKey: false
        });

        if (keyEventHandler) {
          keyEventHandler!(event);
          // Wait for clipboard write
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      });

      // Test metaKey (Mac)
      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'c',
          ctrlKey: false,
          metaKey: true
        });

        if (keyEventHandler) {
          keyEventHandler!(event);
          // Wait for clipboard write
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      });

      // Both should trigger clipboard write
      expect(mockClipboard.writeText).toHaveBeenCalledTimes(2);
    });
  });

  describe('CTRL+V paste behavior', () => {
    it('should paste clipboard content on Windows', async () => {
      const mockPaste = vi.fn();

      // Mock Windows platform (navigator)
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({ paste: mockPaste });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'v',
          ctrlKey: true
        });

        if (keyEventHandler) {
          const handled = keyEventHandler!(event);
          expect(handled).toBe(false); // Should prevent literal ^V

          // Wait for clipboard read and paste
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      });

      // Verify clipboard read and paste
      expect(mockClipboard.readText).toHaveBeenCalled();
      expect(mockPaste).toHaveBeenCalledWith('test clipboard content');
    });

    it('should paste clipboard content on Linux', async () => {
      const mockPaste = vi.fn();

      // Mock Linux platform (navigator)
      Object.defineProperty(navigator, 'platform', {
        value: 'Linux',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({ paste: mockPaste });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'v',
          ctrlKey: true
        });

        const handled = keyEventHandler(event);
        expect(handled).toBe(false);

        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(mockClipboard.readText).toHaveBeenCalled();
      expect(mockPaste).toHaveBeenCalledWith('test clipboard content');
    });

    it('should NOT paste on macOS (Cmd+V should work through existing handlers)', async () => {
      const mockPaste = vi.fn();

      // Mock macOS platform (navigator)
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({ paste: mockPaste });

      await act(async () => {
        // On Mac, this would be Cmd+V which is metaKey
        const event = new KeyboardEvent('keydown', {
          key: 'v',
          ctrlKey: true, // ctrlKey, not metaKey
          metaKey: false
        });

        // On Mac, ctrlKey+V should NOT trigger paste (only Cmd+V works)
        keyEventHandler(event);
      });

      // Should not paste for ctrlKey+V on Mac
      expect(mockClipboard.readText).not.toHaveBeenCalled();
      expect(mockPaste).not.toHaveBeenCalled();
    });
  });

  describe('Linux CTRL+SHIFT+C copy shortcut', () => {
    it('should copy on Linux when CTRL+SHIFT+C is pressed', async () => {
      const mockHasSelection = vi.fn(() => true);
      const mockGetSelection = vi.fn(() => 'selected text');

      // Mock Linux platform (navigator)
      Object.defineProperty(navigator, 'platform', {
        value: 'Linux',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({
        hasSelection: mockHasSelection,
        getSelection: mockGetSelection
      });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'C',
          ctrlKey: true,
          shiftKey: true
        });

        const handled = keyEventHandler(event);
        expect(handled).toBe(false);

        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(mockClipboard.writeText).toHaveBeenCalledWith('selected text');
    });

    it('should not trigger CTRL+SHIFT+C on Windows', async () => {
      // Mock Windows platform (navigator)
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({
        hasSelection: vi.fn(() => false),
        getSelection: vi.fn(() => '')
      });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'C',
          ctrlKey: true,
          shiftKey: true
        });

        if (keyEventHandler) {
          keyEventHandler!(event);
        }
      });

      // Should not copy on Windows
      expect(mockClipboard.writeText).not.toHaveBeenCalled();
    });
  });

  describe('Linux CTRL+SHIFT+V paste shortcut', () => {
    it('should paste on Linux when CTRL+SHIFT+V is pressed', async () => {
      const mockPaste = vi.fn();

      // Mock Linux platform (navigator)
      Object.defineProperty(navigator, 'platform', {
        value: 'Linux',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({ paste: mockPaste });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'V',
          ctrlKey: true,
          shiftKey: true
        });

        const handled = keyEventHandler(event);
        expect(handled).toBe(false);

        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(mockClipboard.readText).toHaveBeenCalled();
      expect(mockPaste).toHaveBeenCalledWith('test clipboard content');
    });
  });

  describe('Clipboard error handling', () => {
    it('should handle clipboard write errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockHasSelection = vi.fn(() => true);
      const mockGetSelection = vi.fn(() => 'selected text');

      // Mock clipboard write failure
      mockClipboard.writeText = vi.fn().mockRejectedValue(new Error('Clipboard write failed'));

      const { keyEventHandler } = await setupMockXterm({
        hasSelection: mockHasSelection,
        getSelection: mockGetSelection
      });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'c',
          ctrlKey: true
        });

        keyEventHandler(event);
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      // Should log error but not throw
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[useXterm] Failed to copy selection:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle clipboard read errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockPaste = vi.fn();

      // Mock Windows platform to enable custom paste handler
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        writable: true
      });

      // Mock clipboard read failure
      mockClipboard.readText = vi.fn().mockRejectedValue(new Error('Clipboard read failed'));

      const { keyEventHandler } = await setupMockXterm({ paste: mockPaste });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'v',
          ctrlKey: true
        });

        keyEventHandler(event);
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      // Should log error but not throw
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[useXterm] Failed to read clipboard:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Existing shortcuts preservation', () => {
    it('should let SHIFT+Enter pass through', async () => {
      const mockInput = vi.fn();

      const { keyEventHandler } = await setupMockXterm({ input: mockInput });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'Enter',
          shiftKey: true,
          ctrlKey: false,
          metaKey: false
        });

        if (keyEventHandler) {
          keyEventHandler!(event);
        }
      });

      // Should send ESC+newline for multi-line input
      expect(mockInput).toHaveBeenCalledWith('\x1b\n');
    });

    it('should let Ctrl+Backspace pass through', async () => {
      const mockInput = vi.fn();

      const { keyEventHandler } = await setupMockXterm({ input: mockInput });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'Backspace',
          ctrlKey: true,
          metaKey: false
        });

        if (keyEventHandler) {
          keyEventHandler!(event);
        }
      });

      // Should send Ctrl+U for delete line
      expect(mockInput).toHaveBeenCalledWith('\x15');
    });

    it('should let Ctrl+1-9 pass through for project tab switching', async () => {
      const { keyEventHandler } = await setupMockXterm();

      // Test all number keys 1-9
      for (let i = 1; i <= 9; i++) {
        act(() => {
          const event = new KeyboardEvent('keydown', {
            key: i.toString(),
            ctrlKey: true
          });

          if (keyEventHandler) {
            const handled = keyEventHandler!(event);
            expect(handled).toBe(false); // Should bubble to window handler
          }
        });
      }
    });

    it('should let Ctrl+T and Ctrl+W pass through', async () => {
      const { keyEventHandler } = await setupMockXterm();

      // Test Ctrl+T
      act(() => {
        const event = new KeyboardEvent('keydown', {
          key: 't',
          ctrlKey: true
        });

        const handled = keyEventHandler(event);
        expect(handled).toBe(false);
      });

      // Test Ctrl+W
      act(() => {
        const event = new KeyboardEvent('keydown', {
          key: 'w',
          ctrlKey: true
        });

        const handled = keyEventHandler(event);
        expect(handled).toBe(false);
      });
    });
  });

  describe('Event type checking', () => {
    it('should only handle keydown events, not keyup', async () => {
      const { keyEventHandler } = await setupMockXterm({
        hasSelection: vi.fn(() => true),
        getSelection: vi.fn(() => 'selected text')
      });

      act(() => {
        // Test keyup event (should be ignored)
        const keyupEvent = new KeyboardEvent('keyup', {
          key: 'c',
          ctrlKey: true
        });

        keyEventHandler(keyupEvent);
      });

      // Clipboard should not be called for keyup events
      expect(mockClipboard.writeText).not.toHaveBeenCalled();
    });
  });
});

describe('useXterm debounced write functionality', () => {
  let rafCallbacks: Array<FrameRequestCallback>;
  let rafId: number;
  let mockWrite: Mock;
  let mockWriteln: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // Track RAF callbacks so we can manually execute them
    rafCallbacks = [];
    rafId = 0;

    // Mock requestAnimationFrame to capture callbacks instead of executing immediately
    global.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      rafId++;
      rafCallbacks.push(cb);
      return rafId;
    });

    // Mock cancelAnimationFrame
    global.cancelAnimationFrame = vi.fn((id: number) => {
      // Find and remove the callback from the queue
      const index = id - 1;
      if (index >= 0 && index < rafCallbacks.length) {
        rafCallbacks.splice(index, 1);
      }
    });

    // Ensure window and navigator exist
    if (typeof window === 'undefined') {
      (global as { window: unknown }).window = {};
    }
    if (typeof navigator === 'undefined') {
      (global as { navigator: unknown }).navigator = {};
    }

    // Mock window.electronAPI
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      sendTerminalInput: vi.fn()
    };

    // Mock ResizeObserver
    global.ResizeObserver = vi.fn().mockImplementation(function() {
      return {
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn()
      };
    });

    // Create mock write/writeln functions
    mockWrite = vi.fn();
    mockWriteln = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Helper to setup xterm mocks for debouncing tests
   */
  async function setupDebounceTest() {
    let hookResult: ReturnType<typeof useXterm> | null = null;

    // Override XTerm mock
    (XTerm as unknown as Mock).mockImplementation(function() {
      return {
        open: vi.fn(),
        loadAddon: vi.fn(),
        attachCustomKeyEventHandler: vi.fn(),
        hasSelection: vi.fn(() => false),
        getSelection: vi.fn(() => ''),
        paste: vi.fn(),
        input: vi.fn(),
        onData: vi.fn((cb: (data: string) => void) => ({ dispose: vi.fn() })),
        onResize: vi.fn((cb: (size: { cols: number; rows: number }) => void) => ({ dispose: vi.fn() })),
        dispose: vi.fn(),
        focus: vi.fn(),
        write: mockWrite,
        writeln: mockWriteln,
        cols: 80,
        rows: 24
      };
    });

    // Setup addon mocks
    const { FitAddon } = await import('@xterm/addon-fit');
    (FitAddon as unknown as Mock).mockImplementation(function() {
      return { fit: vi.fn() };
    });

    const { WebLinksAddon } = await import('@xterm/addon-web-links');
    (WebLinksAddon as unknown as Mock).mockImplementation(function() {
      return {};
    });

    const { SerializeAddon } = await import('@xterm/addon-serialize');
    (SerializeAddon as unknown as Mock).mockImplementation(function() {
      return {
        serialize: vi.fn(() => ''),
        dispose: vi.fn()
      };
    });

    // Create and render test wrapper component
    const TestWrapper = () => {
      hookResult = useXterm({ terminalId: 'test-terminal' });
      return React.createElement('div', { ref: hookResult.terminalRef });
    };

    const { unmount } = render(React.createElement(TestWrapper));

    // Wait for xterm initialization
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    if (!hookResult) {
      throw new Error('Hook result not captured');
    }

    return {
      result: { current: hookResult },
      unmount
    };
  }

  /**
   * Helper to flush all pending RAF callbacks
   */
  function flushRAF() {
    const callbacks = [...rafCallbacks];
    rafCallbacks = [];
    callbacks.forEach(cb => cb(performance.now()));
  }

  it('should batch multiple rapid write() calls into a single xterm.write()', async () => {
    const { result } = await setupDebounceTest();

    await act(async () => {
      // Make multiple rapid write calls
      result.current.write('chunk1');
      result.current.write('chunk2');
      result.current.write('chunk3');

      // At this point, no actual write should have happened yet
      expect(mockWrite).not.toHaveBeenCalled();

      // Flush the RAF queue
      flushRAF();
    });

    // Should have batched all writes into a single call
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith('chunk1chunk2chunk3');
  });

  it('should preserve data chunks in the correct order', async () => {
    const { result } = await setupDebounceTest();

    await act(async () => {
      // Write chunks in specific order
      result.current.write('first');
      result.current.write('second');
      result.current.write('third');
      result.current.write('fourth');

      flushRAF();
    });

    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith('firstsecondthirdfourth');
  });

  it('should schedule only one RAF callback for multiple writes', async () => {
    const { result } = await setupDebounceTest();

    // Clear RAF calls from setup
    vi.mocked(global.requestAnimationFrame).mockClear();

    await act(async () => {
      result.current.write('a');
      result.current.write('b');
      result.current.write('c');
      result.current.write('d');
      result.current.write('e');
    });

    // Should have scheduled only one RAF callback despite 5 writes
    expect(global.requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it('should flush buffer on component unmount', async () => {
    const { result } = await setupDebounceTest();

    await act(async () => {
      // Write some data
      result.current.write('pending data');

      // Dispose without flushing RAF
      result.current.dispose();
    });

    // Should have written the pending data on dispose
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith('pending data');
  });

  it('should cancel pending RAF on unmount', async () => {
    const { result } = await setupDebounceTest();

    await act(async () => {
      result.current.write('data');

      // Dispose should cancel the RAF
      result.current.dispose();
    });

    // cancelAnimationFrame should have been called
    expect(global.cancelAnimationFrame).toHaveBeenCalled();
  });

  it('should handle writeln() with immediate write', async () => {
    const { result } = await setupDebounceTest();

    await act(async () => {
      // Buffer some data first
      result.current.write('buffered');

      // writeln should flush buffer and write immediately
      result.current.writeln('immediate line');
    });

    // Should have flushed buffer first, then written the line
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith('buffered');
    expect(mockWriteln).toHaveBeenCalledTimes(1);
    expect(mockWriteln).toHaveBeenCalledWith('immediate line');

    // RAF should have been canceled
    expect(global.cancelAnimationFrame).toHaveBeenCalled();
  });

  it('should handle writeln() when buffer is empty', async () => {
    const { result } = await setupDebounceTest();

    await act(async () => {
      // writeln with no buffered data
      result.current.writeln('only line');
    });

    // Should write the line immediately without touching write()
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockWriteln).toHaveBeenCalledTimes(1);
    expect(mockWriteln).toHaveBeenCalledWith('only line');
  });

  it('should handle empty write calls', async () => {
    const { result } = await setupDebounceTest();

    await act(async () => {
      result.current.write('');
      result.current.write('actual data');
      result.current.write('');

      flushRAF();
    });

    // Empty strings should still be accumulated
    expect(mockWrite).toHaveBeenCalledWith('actual data');
  });

  it('should handle very large writes', async () => {
    const { result } = await setupDebounceTest();

    // Create a large chunk of data (simulate npm install output)
    const largeChunk = 'x'.repeat(10000);

    await act(async () => {
      result.current.write(largeChunk);
      result.current.write('more');

      flushRAF();
    });

    expect(mockWrite).toHaveBeenCalledWith(largeChunk + 'more');
  });

  it('should handle multiple RAF cycles', async () => {
    const { result } = await setupDebounceTest();

    // First batch
    await act(async () => {
      result.current.write('batch1a');
      result.current.write('batch1b');
      flushRAF();
    });

    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith('batch1a' + 'batch1b');

    mockWrite.mockClear();

    // Second batch
    await act(async () => {
      result.current.write('batch2a');
      result.current.write('batch2b');
      flushRAF();
    });

    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith('batch2a' + 'batch2b');
  });

  it('should not write after dispose', async () => {
    const { result } = await setupDebounceTest();

    await act(async () => {
      result.current.write('before dispose');
      flushRAF();
    });

    expect(mockWrite).toHaveBeenCalledTimes(1);
    mockWrite.mockClear();

    await act(async () => {
      result.current.dispose();

      // Attempt to write after dispose (should be no-op)
      result.current.write('after dispose');
      flushRAF();
    });

    // No additional writes should occur
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('should handle rapid write-flush-write cycles', async () => {
    const { result } = await setupDebounceTest();

    await act(async () => {
      // Write and flush
      result.current.write('cycle1');
      flushRAF();

      // Immediately write again
      result.current.write('cycle2');
      flushRAF();

      // And again
      result.current.write('cycle3');
      flushRAF();
    });

    expect(mockWrite).toHaveBeenCalledTimes(3);
    expect(mockWrite).toHaveBeenNthCalledWith(1, 'cycle1');
    expect(mockWrite).toHaveBeenNthCalledWith(2, 'cycle2');
    expect(mockWrite).toHaveBeenNthCalledWith(3, 'cycle3');
  });

  it('should handle interleaved write() and writeln() calls', async () => {
    const { result } = await setupDebounceTest();

    await act(async () => {
      result.current.write('buffered1');
      result.current.write('buffered2');
      result.current.writeln('line1');

      // Write more after writeln
      result.current.write('buffered3');
      result.current.writeln('line2');
    });

    // First batch should be flushed before first writeln
    expect(mockWrite).toHaveBeenNthCalledWith(1, 'buffered1buffered2');
    expect(mockWriteln).toHaveBeenNthCalledWith(1, 'line1');

    // Second batch should be flushed before second writeln
    expect(mockWrite).toHaveBeenNthCalledWith(2, 'buffered3');
    expect(mockWriteln).toHaveBeenNthCalledWith(2, 'line2');
  });

  it('should clear buffer after flushing', async () => {
    const { result } = await setupDebounceTest();

    await act(async () => {
      result.current.write('first batch');
      flushRAF();
    });

    mockWrite.mockClear();

    await act(async () => {
      result.current.write('second batch');
      flushRAF();
    });

    // Second call should only have second batch data, not accumulated
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith('second batch');
  });

  it('should handle writes with special characters and ANSI codes', async () => {
    const { result } = await setupDebounceTest();

    await act(async () => {
      result.current.write('\x1b[31m'); // Red color ANSI code
      result.current.write('Error: ');
      result.current.write('Something went wrong\n');
      result.current.write('\x1b[0m'); // Reset ANSI code

      flushRAF();
    });

    expect(mockWrite).toHaveBeenCalledWith('\x1b[31mError: Something went wrong\n\x1b[0m');
  });

  it('should handle unicode and emoji in writes', async () => {
    const { result } = await setupDebounceTest();

    await act(async () => {
      result.current.write('✓ Success ');
      result.current.write('🚀 Deployed ');
      result.current.write('你好');

      flushRAF();
    });

    expect(mockWrite).toHaveBeenCalledWith('✓ Success 🚀 Deployed 你好');
  });
});
