import { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Send,
  Loader2,
  ChevronDown,
  ChevronRight,
  Bot
} from 'lucide-react';
import { Button } from '../../ui/button';
import { Textarea } from '../../ui/textarea';
import { ScrollArea } from '../../ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '../../ui/collapsible';
import { cn } from '../../../lib/utils';
import { useReviewChat } from '../../../hooks/useReviewChat';
import { ReviewChatMessage } from './ReviewChatMessage';
import type { Task, WorktreeDiff, WorktreeStatus } from '../../../../shared/types';

interface ReviewChatWindowProps {
  projectId: string;
  task: Task;
  worktreeDiff?: WorktreeDiff | null;
  worktreeStatus?: WorktreeStatus | null;
}

/**
 * Collapsible chat window for asking questions about task changes during review.
 * Uses the Insights infrastructure for AI responses with task context.
 */
export function ReviewChatWindow({
  projectId,
  task,
  worktreeDiff,
  worktreeStatus
}: ReviewChatWindowProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Use the review chat hook with task context
  const {
    messages,
    status,
    streamingContent,
    currentTool,
    sendMessage
  } = useReviewChat(projectId, {
    task,
    worktreeDiff,
    worktreeStatus
  });

  // Auto-scroll to bottom when messages change or streaming
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Focus textarea when chat is opened
  useEffect(() => {
    if (isOpen) {
      textareaRef.current?.focus();
    }
  }, [isOpen]);

  const handleSend = () => {
    const message = inputValue.trim();
    if (!message || isLoading) return;

    setInputValue('');
    sendMessage(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isLoading = status.phase === 'thinking' || status.phase === 'streaming';
  const hasMessages = messages.length > 0 || streamingContent;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-xl border border-primary/30 bg-primary/5 overflow-hidden">
        {/* Collapsible Header */}
        <CollapsibleTrigger asChild>
          <button
            className={cn(
              'flex w-full items-center justify-between px-4 py-3',
              'text-left hover:bg-primary/10 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
            )}
            aria-label={isOpen ? 'Collapse chat' : 'Expand chat to ask questions about changes'}
          >
            <span className="flex items-center gap-2 font-medium text-sm text-foreground">
              <MessageSquare className="h-4 w-4 text-primary" />
              Ask About Changes
              {messages.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  ({messages.length} message{messages.length !== 1 ? 's' : ''})
                </span>
              )}
            </span>
            {isOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </CollapsibleTrigger>

        {/* Collapsible Content */}
        <CollapsibleContent>
          <div className="border-t border-primary/20">
            {/* Messages Area */}
            <ScrollArea className="h-64">
              <div className="p-4 space-y-4">
                {/* Empty State */}
                {!hasMessages && (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-3">
                      <Bot className="h-6 w-6 text-primary" />
                    </div>
                    <p className="text-sm text-muted-foreground max-w-[200px]">
                      Ask questions about the changes made in this task
                    </p>
                  </div>
                )}

                {/* Message List */}
                {messages.map((message) => (
                  <ReviewChatMessage key={message.id} message={message} />
                ))}

                {/* Streaming Content */}
                {streamingContent && (
                  <div className="flex gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="text-sm font-medium text-foreground">
                        Assistant
                      </div>
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <p className="whitespace-pre-wrap break-words">
                          {streamingContent}
                          <span className="inline-block w-2 h-4 bg-primary/50 ml-0.5 animate-pulse" />
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Loading/Tool Status */}
                {isLoading && !streamingContent && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>
                      {currentTool
                        ? `Using ${currentTool.name}...`
                        : status.message || 'Thinking...'}
                    </span>
                  </div>
                )}

                {/* Error State */}
                {status.phase === 'error' && status.error && (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                    {status.error}
                  </div>
                )}

                {/* Scroll anchor */}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Input Area */}
            <div className="border-t border-primary/20 p-3">
              <div className="flex gap-2">
                <Textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask a question about the changes..."
                  className="min-h-[60px] max-h-[120px] resize-none text-sm"
                  disabled={isLoading}
                  aria-label="Chat message input"
                />
                <Button
                  variant="default"
                  size="icon"
                  onClick={handleSend}
                  disabled={!inputValue.trim() || isLoading}
                  className="shrink-0 self-end"
                  aria-label="Send message"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Press Enter to send, Shift+Enter for new line
              </p>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
