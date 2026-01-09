import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { motion, AnimatePresence } from 'motion/react';

import { cn } from '../../lib/utils';
import { useReducedMotion, popoverVariants } from '../../lib/animation-utils';

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

/**
 * PopoverContent with Motion-based spring enter/exit animations.
 * Uses spring physics for a natural pop effect.
 * Respects user's prefers-reduced-motion setting.
 */
const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => {
  const reducedMotion = useReducedMotion();

  return (
    <PopoverPrimitive.Portal forceMount>
      <AnimatePresence mode="wait">
        <PopoverPrimitive.Content
          ref={ref}
          align={align}
          sideOffset={sideOffset}
          asChild
          {...props}
        >
          <motion.div
            className={cn(
              'z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none',
              className
            )}
            variants={reducedMotion ? undefined : popoverVariants}
            initial={reducedMotion ? undefined : 'hidden'}
            animate={reducedMotion ? undefined : 'visible'}
            exit={reducedMotion ? undefined : 'exit'}
          >
            {props.children}
          </motion.div>
        </PopoverPrimitive.Content>
      </AnimatePresence>
    </PopoverPrimitive.Portal>
  );
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
