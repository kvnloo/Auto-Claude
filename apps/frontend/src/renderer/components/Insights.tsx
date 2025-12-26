import { useState, useEffect, useRef, useCallback, useMemo, type ChangeEvent, type DragEvent } from 'react';
import {
  MessageSquare,
  Send,
  Loader2,
  Plus,
  Sparkles,
  User,
  Bot,
  CheckCircle2,
  AlertCircle,
  Search,
  FileText,
  FolderSearch,
  PanelLeftClose,
  PanelLeft,
  Paperclip,
  File
} from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { ScrollArea } from './ui/scroll-area';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import {
  useInsightsStore,
  loadInsightsSession,
  sendMessage,
  newSession,
  switchSession,
  deleteSession,
  renameSession,
  updateModelConfig,
  createTaskFromSuggestion,
  setupInsightsListeners
} from '../stores/insights-store';
import { loadTasks } from '../stores/task-store';
import { ChatHistorySidebar } from './ChatHistorySidebar';
import { InsightsModelSelector } from './InsightsModelSelector';
import { FileAttachmentList } from './FileAttachmentList';
import { FileChip } from './FileChip';
import type { InsightsChatMessage, InsightsModelConfig } from '../../shared/types';
import {
  TASK_CATEGORY_LABELS,
  TASK_CATEGORY_COLORS,
  TASK_COMPLEXITY_LABELS,
  TASK_COMPLEXITY_COLORS
} from '../../shared/constants';
import {
  validateFiles,
  processFilesToAttachments,
  hasLargeFiles
} from '../utils/fileValidation';

interface InsightsProps {
  projectId: string;
}

export function Insights({ projectId }: InsightsProps) {
  const session = useInsightsStore((state) => state.session);
  const sessions = useInsightsStore((state) => state.sessions);
  const status = useInsightsStore((state) => state.status);
  const streamingContent = useInsightsStore((state) => state.streamingContent);
  const currentTool = useInsightsStore((state) => state.currentTool);
  const isLoadingSessions = useInsightsStore((state) => state.isLoadingSessions);
  const attachedFiles = useInsightsStore((state) => state.attachedFiles);
  const addAttachment = useInsightsStore((state) => state.addAttachment);
  const removeAttachment = useInsightsStore((state) => state.removeAttachment);
  const clearAttachments = useInsightsStore((state) => state.clearAttachments);

  const [inputValue, setInputValue] = useState('');
  const [creatingTask, setCreatingTask] = useState<string | null>(null);
  const [taskCreated, setTaskCreated] = useState<Set<string>>(new Set());
  const [showSidebar, setShowSidebar] = useState(true);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);

  // @ autocomplete state
  const [autocomplete, setAutocomplete] = useState<{
    show: boolean;
    query: string;
    startPos: number;
    position: { top: number; left: number };
  } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const autocompleteListRef = useRef<HTMLDivElement>(null);

  // Load session and set up listeners on mount
  useEffect(() => {
    loadInsightsSession(projectId);
    const cleanup = setupInsightsListeners();
    return cleanup;
  }, [projectId]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.messages, streamingContent]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Reset taskCreated when switching sessions
  useEffect(() => {
    setTaskCreated(new Set());
  }, [session?.id]);

  // Filter attached files based on autocomplete query
  const filteredFiles = useMemo(() => {
    if (!autocomplete?.show || attachedFiles.length === 0) {
      return [];
    }

    const query = autocomplete.query.toLowerCase();
    if (!query) {
      // Show all attached files when no query
      return attachedFiles.slice(0, 10);
    }

    // Score files by match quality
    return attachedFiles
      .map(file => {
        const name = file.name.toLowerCase();
        let score = 0;

        // Exact name match (highest priority)
        if (name === query) {
          score = 1000;
        }
        // Name starts with query
        else if (name.startsWith(query)) {
          score = 100;
        }
        // Name contains query
        else if (name.includes(query)) {
          score = 50;
        }

        return { file, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(item => item.file);
  }, [autocomplete?.show, autocomplete?.query, attachedFiles]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredFiles]);

  // Scroll selected item into view
  useEffect(() => {
    const list = autocompleteListRef.current;
    if (!list) return;

    const selectedElement = list.children[selectedIndex] as HTMLElement;
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  /**
   * Detect @ mention being typed and show autocomplete
   */
  const detectAtMention = useCallback((text: string, cursorPos: number) => {
    const beforeCursor = text.slice(0, cursorPos);
    // Match @ followed by optional word characters, dots, dashes
    const match = beforeCursor.match(/@([\w\-.]*)$/);

    if (match) {
      return {
        query: match[1],
        startPos: cursorPos - match[0].length
      };
    }
    return null;
  }, []);

  /**
   * Handle input change and check for @ mentions
   */
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart || 0;

    setInputValue(newValue);

    // Only show autocomplete if there are attached files
    if (attachedFiles.length === 0) {
      if (autocomplete?.show) {
        setAutocomplete(null);
      }
      return;
    }

    // Check for @ mention at cursor
    const mention = detectAtMention(newValue, cursorPos);

    if (mention) {
      // Calculate popup position based on cursor
      const textarea = textareaRef.current;
      if (textarea) {
        const rect = textarea.getBoundingClientRect();
        const textareaStyle = window.getComputedStyle(textarea);
        const lineHeight = parseFloat(textareaStyle.lineHeight) || 20;
        const paddingTop = parseFloat(textareaStyle.paddingTop) || 8;
        const paddingLeft = parseFloat(textareaStyle.paddingLeft) || 12;

        // Estimate cursor position
        const textBeforeCursor = newValue.slice(0, cursorPos);
        const lines = textBeforeCursor.split('\n');
        const currentLineIndex = lines.length - 1;
        const currentLineLength = lines[currentLineIndex].length;

        // Calculate position relative to textarea
        const charWidth = 8;
        const top = paddingTop + (currentLineIndex + 1) * lineHeight + 4;
        const left = paddingLeft + Math.min(currentLineLength * charWidth, rect.width - 280);

        setAutocomplete({
          show: true,
          query: mention.query,
          startPos: mention.startPos,
          position: { top, left: Math.max(0, left) }
        });
      }
    } else {
      // No @ mention at cursor, close autocomplete
      if (autocomplete?.show) {
        setAutocomplete(null);
      }
    }
  }, [detectAtMention, autocomplete?.show, attachedFiles.length]);

  /**
   * Handle autocomplete selection
   */
  const handleAutocompleteSelect = useCallback((filename: string) => {
    if (!autocomplete) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

    // Replace the @query with @filename
    const beforeMention = inputValue.slice(0, autocomplete.startPos);
    const afterMention = inputValue.slice(autocomplete.startPos + 1 + autocomplete.query.length);
    const newValue = beforeMention + '@' + filename + ' ' + afterMention;

    setInputValue(newValue);
    setAutocomplete(null);

    // Set cursor after the inserted mention
    setTimeout(() => {
      const newCursorPos = autocomplete.startPos + 1 + filename.length + 1;
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  }, [autocomplete, inputValue]);

  /**
   * Close autocomplete
   */
  const handleAutocompleteClose = useCallback(() => {
    setAutocomplete(null);
  }, []);

  /**
   * Handle keyboard navigation in autocomplete
   */
  const handleAutocompleteKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!autocomplete?.show || filteredFiles.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev =>
          prev < filteredFiles.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => prev > 0 ? prev - 1 : prev);
        break;
      case 'Enter':
        if (autocomplete.show) {
          e.preventDefault();
          if (filteredFiles[selectedIndex]) {
            handleAutocompleteSelect(filteredFiles[selectedIndex].name);
          }
        }
        break;
      case 'Escape':
        e.preventDefault();
        handleAutocompleteClose();
        break;
      case 'Tab':
        if (autocomplete.show) {
          e.preventDefault();
          if (filteredFiles[selectedIndex]) {
            handleAutocompleteSelect(filteredFiles[selectedIndex].name);
          }
        }
        break;
    }
  }, [autocomplete?.show, filteredFiles, selectedIndex, handleAutocompleteSelect, handleAutocompleteClose]);

  const handleSend = () => {
    const message = inputValue.trim();
    if (!message || status.phase === 'thinking' || status.phase === 'streaming') return;

    // Clear input and file error state
    setInputValue('');
    setFileError(null);

    // Send message with any attached files (base64 data already embedded when files were added)
    // The sendMessage function in the store will include attachedFiles and clear them after sending
    sendMessage(projectId, message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle autocomplete keyboard navigation first
    if (autocomplete?.show && filteredFiles.length > 0) {
      handleAutocompleteKeyDown(e);
      // If autocomplete handled the key, don't process further
      if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(e.key)) {
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /**
   * Handle file selection from the file input
   */
  const handleFileSelect = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      setFileError(null);

      // Validate files
      const fileArray = Array.from(files);
      const { validFiles, errors } = validateFiles(fileArray, attachedFiles.length);

      // Show first error if any
      if (errors.length > 0) {
        setFileError(errors[0]);
      }

      // Process valid files to attachments
      if (validFiles.length > 0) {
        // Show loading state for large files (>100MB)
        const processingLargeFiles = hasLargeFiles(validFiles);
        if (processingLargeFiles) {
          setIsProcessingFiles(true);
        }

        try {
          const { attachments, errors: processErrors } = await processFilesToAttachments(
            validFiles,
            attachedFiles
          );

          // Add processing errors to display
          if (processErrors.length > 0 && !fileError) {
            setFileError(processErrors[0]);
          }

          // Add each attachment to the store
          for (const attachment of attachments) {
            addAttachment(attachment);
          }
        } finally {
          if (processingLargeFiles) {
            setIsProcessingFiles(false);
          }
        }
      }

      // Reset input to allow selecting the same file again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [attachedFiles, addAttachment, fileError]
  );

  /**
   * Open file picker dialog
   */
  const handlePaperclipClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /**
   * Handle drag enter on the chat input area
   */
  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;

    // Only show drag overlay if files are being dragged
    if (e.dataTransfer?.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  /**
   * Handle drag leave from the chat input area
   */
  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;

    // Only hide overlay when fully leaving the drop zone
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  /**
   * Handle drag over the chat input area
   */
  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /**
   * Handle file drop on the chat input area
   */
  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      // Reset drag state
      dragCounterRef.current = 0;
      setIsDragOver(false);

      // Don't process if loading or already processing files
      if (status.phase === 'thinking' || status.phase === 'streaming' || isProcessingFiles) return;

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      setFileError(null);

      // Validate files
      const fileArray = Array.from(files);
      const { validFiles, errors } = validateFiles(fileArray, attachedFiles.length);

      // Show first error if any
      if (errors.length > 0) {
        setFileError(errors[0]);
      }

      // Process valid files to attachments
      if (validFiles.length > 0) {
        // Show loading state for large files (>100MB)
        const processingLargeFiles = hasLargeFiles(validFiles);
        if (processingLargeFiles) {
          setIsProcessingFiles(true);
        }

        try {
          const { attachments, errors: processErrors } = await processFilesToAttachments(
            validFiles,
            attachedFiles
          );

          // Add processing errors to display
          if (processErrors.length > 0 && !fileError) {
            setFileError(processErrors[0]);
          }

          // Add each attachment to the store
          for (const attachment of attachments) {
            addAttachment(attachment);
          }
        } finally {
          if (processingLargeFiles) {
            setIsProcessingFiles(false);
          }
        }
      }
    },
    [attachedFiles, addAttachment, fileError, status.phase, isProcessingFiles]
  );

  const handleNewSession = async () => {
    await newSession(projectId);
    setTaskCreated(new Set());
    textareaRef.current?.focus();
  };

  const handleSelectSession = async (sessionId: string) => {
    if (sessionId !== session?.id) {
      await switchSession(projectId, sessionId);
    }
  };

  const handleDeleteSession = async (sessionId: string): Promise<boolean> => {
    return await deleteSession(projectId, sessionId);
  };

  const handleRenameSession = async (sessionId: string, newTitle: string): Promise<boolean> => {
    return await renameSession(projectId, sessionId, newTitle);
  };

  const handleCreateTask = async (message: InsightsChatMessage) => {
    if (!message.suggestedTask) return;

    setCreatingTask(message.id);
    try {
      const task = await createTaskFromSuggestion(
        projectId,
        message.suggestedTask.title,
        message.suggestedTask.description,
        message.suggestedTask.metadata
      );

      if (task) {
        setTaskCreated(prev => new Set(prev).add(message.id));
        // Reload tasks to show the new task in the kanban
        loadTasks(projectId);
      }
    } finally {
      setCreatingTask(null);
    }
  };

  const handleModelConfigChange = async (config: InsightsModelConfig) => {
    // If we have a session, persist the config
    if (session?.id) {
      await updateModelConfig(projectId, session.id, config);
    }
  };

  const isLoading = status.phase === 'thinking' || status.phase === 'streaming';
  const messages = session?.messages || [];

  return (
    <div className="flex h-full">
      {/* Chat History Sidebar */}
      {showSidebar && (
        <ChatHistorySidebar
          sessions={sessions}
          currentSessionId={session?.id || null}
          isLoading={isLoadingSessions}
          onNewSession={handleNewSession}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
        />
      )}

      {/* Main Chat Area */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setShowSidebar(!showSidebar)}
              title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
            >
              {showSidebar ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeft className="h-4 w-4" />
              )}
            </Button>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">Insights</h2>
              <p className="text-sm text-muted-foreground">
                Ask questions about your codebase
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <InsightsModelSelector
              currentConfig={session?.modelConfig}
              onConfigChange={handleModelConfigChange}
              disabled={isLoading}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewSession}
            >
              <Plus className="mr-2 h-4 w-4" />
              New Chat
            </Button>
          </div>
        </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-6 py-4">
        {messages.length === 0 && !streamingContent ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <MessageSquare className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-medium text-foreground">
              Start a Conversation
            </h3>
            <p className="max-w-md text-sm text-muted-foreground">
              Ask questions about your codebase, get suggestions for improvements,
              or discuss features you'd like to implement.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {[
                'What is the architecture of this project?',
                'Suggest improvements for code quality',
                'What features could I add next?',
                'Are there any security concerns?'
              ].map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    setInputValue(suggestion);
                    textareaRef.current?.focus();
                  }}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onCreateTask={() => handleCreateTask(message)}
                isCreatingTask={creatingTask === message.id}
                taskCreated={taskCreated.has(message.id)}
              />
            ))}

            {/* Streaming message */}
            {(streamingContent || currentTool) && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="mb-1 text-sm font-medium text-foreground">
                    Assistant
                  </div>
                  {streamingContent && (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <p className="whitespace-pre-wrap">{streamingContent}</p>
                    </div>
                  )}
                  {/* Tool usage indicator */}
                  {currentTool && (
                    <ToolIndicator name={currentTool.name} input={currentTool.input} />
                  )}
                </div>
              </div>
            )}

            {/* Thinking indicator */}
            {status.phase === 'thinking' && !streamingContent && !currentTool && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Thinking...
                </div>
              </div>
            )}

            {/* Error message */}
            {status.phase === 'error' && status.error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {status.error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div
        className={cn(
          "border-t border-border p-4 relative transition-colors",
          isDragOver && "bg-primary/5 border-primary"
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {isDragOver && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-lg pointer-events-none">
            <div className="flex flex-col items-center gap-2 text-primary">
              <Paperclip className="h-8 w-8" />
              <span className="text-sm font-medium">Drop files to attach</span>
            </div>
          </div>
        )}

        {/* Large file processing overlay */}
        {isProcessingFiles && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-lg pointer-events-none">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm font-medium">Processing large files...</span>
            </div>
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          disabled={isLoading || isProcessingFiles}
          className="hidden"
        />

        {/* File error message */}
        {fileError && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{fileError}</span>
            <button
              onClick={() => setFileError(null)}
              className="shrink-0 rounded p-0.5 hover:bg-destructive/20"
            >
              <span className="sr-only">Dismiss</span>
              ×
            </button>
          </div>
        )}

        <div className="flex gap-2">
          {/* Textarea with @ autocomplete */}
          <div className="relative flex-1">
            <Textarea
              ref={textareaRef}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={attachedFiles.length > 0 ? "Ask about your codebase... (type @ to reference attached files)" : "Ask about your codebase..."}
              className="min-h-[80px] resize-none"
              disabled={isLoading || isProcessingFiles}
            />
            {/* @ autocomplete popup for attached files */}
            {autocomplete?.show && filteredFiles.length > 0 && (
              <div
                className="absolute z-50 bg-popover border border-border rounded-md shadow-lg overflow-hidden"
                style={{
                  top: autocomplete.position.top,
                  left: autocomplete.position.left,
                  minWidth: '240px',
                  maxWidth: '320px',
                  maxHeight: '200px'
                }}
              >
                <div
                  ref={autocompleteListRef}
                  className="overflow-y-auto max-h-[160px]"
                >
                  {filteredFiles.map((file, index) => (
                    <button
                      key={file.id}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 text-left text-sm',
                        'hover:bg-accent hover:text-accent-foreground',
                        'focus:outline-none transition-colors',
                        index === selectedIndex && 'bg-accent text-accent-foreground'
                      )}
                      onClick={() => handleAutocompleteSelect(file.name)}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      <File className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{file.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {(file.size / 1024).toFixed(1)} KB
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground bg-muted/30">
                  <span className="font-medium">↑↓</span> navigate · <span className="font-medium">Enter</span> select · <span className="font-medium">Esc</span> close
                </div>
              </div>
            )}
            {/* No files message when typing @ but no files attached */}
            {autocomplete?.show && attachedFiles.length > 0 && filteredFiles.length === 0 && (
              <div
                className="absolute z-50 bg-popover border border-border rounded-md shadow-lg p-3 text-sm text-muted-foreground"
                style={{
                  top: autocomplete.position.top,
                  left: autocomplete.position.left,
                  minWidth: '200px'
                }}
              >
                No matching files
              </div>
            )}
          </div>
          <div className="flex flex-col justify-end gap-1">
            <Button
              variant="outline"
              size="icon"
              disabled={isLoading || isProcessingFiles}
              title={isProcessingFiles ? 'Processing files...' : attachedFiles.length > 0 ? `${attachedFiles.length} file(s) attached` : 'Attach files'}
              onClick={handlePaperclipClick}
              className="relative"
            >
              {isProcessingFiles ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
              {attachedFiles.length > 0 && !isProcessingFiles && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                  {attachedFiles.length > 9 ? '9+' : attachedFiles.length}
                </span>
              )}
            </Button>
            <Button
              onClick={handleSend}
              disabled={!inputValue.trim() || isLoading || isProcessingFiles}
              size="icon"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Attached files list */}
        <FileAttachmentList
          files={attachedFiles}
          onRemove={(file) => removeAttachment(file.id)}
          onClearAll={clearAttachments}
          disabled={isLoading || isProcessingFiles}
          size="sm"
          className="mt-2"
        />

        <p className="mt-2 text-xs text-muted-foreground">
          Press Enter to send, Shift+Enter for new line{attachedFiles.length > 0 ? '. Type @ to reference attached files' : ''}
        </p>
      </div>
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  message: InsightsChatMessage;
  onCreateTask: () => void;
  isCreatingTask: boolean;
  taskCreated: boolean;
}

function MessageBubble({
  message,
  onCreateTask,
  isCreatingTask,
  taskCreated
}: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className="flex gap-3">
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-muted' : 'bg-primary/10'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Bot className="h-4 w-4 text-primary" />
        )}
      </div>
      <div className="flex-1 space-y-2">
        <div className="text-sm font-medium text-foreground">
          {isUser ? 'You' : 'Assistant'}
        </div>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>

        {/* File attachments for user messages */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {message.attachments.map((file) => (
              <FileChip
                key={file.id}
                file={file}
                readOnly
                size="sm"
              />
            ))}
          </div>
        )}

        {/* Tool usage history for assistant messages */}
        {!isUser && message.toolsUsed && message.toolsUsed.length > 0 && (
          <ToolUsageHistory tools={message.toolsUsed} />
        )}

        {/* Task suggestion card */}
        {message.suggestedTask && (
          <Card className="mt-3 border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-primary">
                  Suggested Task
                </span>
              </div>
              <h4 className="mb-2 font-medium text-foreground">
                {message.suggestedTask.title}
              </h4>
              <p className="mb-3 text-sm text-muted-foreground">
                {message.suggestedTask.description}
              </p>
              {message.suggestedTask.metadata && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {message.suggestedTask.metadata.category && (
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-xs',
                        TASK_CATEGORY_COLORS[message.suggestedTask.metadata.category]
                      )}
                    >
                      {TASK_CATEGORY_LABELS[message.suggestedTask.metadata.category] ||
                        message.suggestedTask.metadata.category}
                    </Badge>
                  )}
                  {message.suggestedTask.metadata.complexity && (
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-xs',
                        TASK_COMPLEXITY_COLORS[message.suggestedTask.metadata.complexity]
                      )}
                    >
                      {TASK_COMPLEXITY_LABELS[message.suggestedTask.metadata.complexity] ||
                        message.suggestedTask.metadata.complexity}
                    </Badge>
                  )}
                </div>
              )}
              <Button
                size="sm"
                onClick={onCreateTask}
                disabled={isCreatingTask || taskCreated}
              >
                {isCreatingTask ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : taskCreated ? (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Task Created
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Task
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// Tool usage history component for showing tools used in completed messages
interface ToolUsageHistoryProps {
  tools: Array<{
    name: string;
    input?: string;
    timestamp: Date;
  }>;
}

function ToolUsageHistory({ tools }: ToolUsageHistoryProps) {
  const [expanded, setExpanded] = useState(false);

  if (tools.length === 0) return null;

  // Group tools by name for summary
  const toolCounts = tools.reduce((acc, tool) => {
    acc[tool.name] = (acc[tool.name] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const getToolIcon = (toolName: string) => {
    switch (toolName) {
      case 'Read':
        return FileText;
      case 'Glob':
        return FolderSearch;
      case 'Grep':
        return Search;
      default:
        return FileText;
    }
  };

  const getToolColor = (toolName: string) => {
    switch (toolName) {
      case 'Read':
        return 'text-blue-500';
      case 'Glob':
        return 'text-amber-500';
      case 'Grep':
        return 'text-green-500';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-1">
          {Object.entries(toolCounts).map(([name, count]) => {
            const Icon = getToolIcon(name);
            return (
              <span key={name} className={cn('flex items-center gap-0.5', getToolColor(name))}>
                <Icon className="h-3 w-3" />
                <span>{count}</span>
              </span>
            );
          })}
        </span>
        <span>{tools.length} tool{tools.length !== 1 ? 's' : ''} used</span>
        <span className="text-[10px]">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1 rounded-md border border-border bg-muted/30 p-2">
          {tools.map((tool, index) => {
            const Icon = getToolIcon(tool.name);
            return (
              <div
                key={`${tool.name}-${index}`}
                className="flex items-center gap-2 text-xs"
              >
                <Icon className={cn('h-3 w-3 shrink-0', getToolColor(tool.name))} />
                <span className="font-medium">{tool.name}</span>
                {tool.input && (
                  <span className="text-muted-foreground truncate max-w-[250px]">
                    {tool.input}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Tool indicator component for showing what the AI is currently doing
interface ToolIndicatorProps {
  name: string;
  input?: string;
}

function ToolIndicator({ name, input }: ToolIndicatorProps) {
  // Get friendly name and icon for each tool
  const getToolInfo = (toolName: string) => {
    switch (toolName) {
      case 'Read':
        return {
          icon: FileText,
          label: 'Reading file',
          color: 'text-blue-500 bg-blue-500/10'
        };
      case 'Glob':
        return {
          icon: FolderSearch,
          label: 'Searching files',
          color: 'text-amber-500 bg-amber-500/10'
        };
      case 'Grep':
        return {
          icon: Search,
          label: 'Searching code',
          color: 'text-green-500 bg-green-500/10'
        };
      default:
        return {
          icon: Loader2,
          label: toolName,
          color: 'text-primary bg-primary/10'
        };
    }
  };

  const { icon: Icon, label, color } = getToolInfo(name);

  return (
    <div className={cn(
      'mt-2 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
      color
    )}>
      <Icon className="h-4 w-4 animate-pulse" />
      <span className="font-medium">{label}</span>
      {input && (
        <span className="text-muted-foreground truncate max-w-[300px]">
          {input}
        </span>
      )}
    </div>
  );
}
