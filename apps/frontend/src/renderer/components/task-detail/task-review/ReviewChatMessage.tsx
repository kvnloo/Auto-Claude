import { User, Bot } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { InsightsChatMessage } from '../../../../shared/types';

interface ReviewChatMessageProps {
  message: InsightsChatMessage;
}

/**
 * Renders an individual chat message in the review chat.
 * Simpler than the Insights MessageBubble - no task suggestion cards.
 *
 * User messages: muted background with User icon
 * Assistant messages: primary/10 background with Bot icon
 */
export function ReviewChatMessage({ message }: ReviewChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className="flex gap-3">
      {/* Avatar */}
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

      {/* Message content */}
      <div className="flex-1 space-y-1">
        <div className="text-sm font-medium text-foreground">
          {isUser ? 'You' : 'Assistant'}
        </div>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    </div>
  );
}
