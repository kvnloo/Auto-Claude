import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import { useReducedMotion, focusRingAnimations } from '../../lib/animation-utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, onFocus, onBlur, ...props }, ref) => {
    const reducedMotion = useReducedMotion();
    const [isFocused, setIsFocused] = React.useState(false);

    const handleFocus = React.useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        setIsFocused(true);
        onFocus?.(e);
      },
      [onFocus]
    );

    const handleBlur = React.useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        setIsFocused(false);
        onBlur?.(e);
      },
      [onBlur]
    );

    return (
      <div className="relative w-full">
        {/* Animated focus ring */}
        <AnimatePresence>
          {isFocused && !reducedMotion && (
            <motion.div
              className="absolute inset-0 rounded-lg ring-2 ring-ring pointer-events-none"
              initial={focusRingAnimations.unfocused}
              animate={focusRingAnimations.focused}
              exit={focusRingAnimations.unfocused}
            />
          )}
        </AnimatePresence>
        <input
          type={type}
          className={cn(
            'flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground',
            'placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:border-primary',
            // Keep static ring for reduced motion or as fallback
            reducedMotion && 'focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'transition-colors duration-200',
            'file:border-0 file:bg-transparent file:text-sm file:font-medium',
            className
          )}
          ref={ref}
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...props}
        />
      </div>
    );
  }
);
Input.displayName = 'Input';

export { Input };
