import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';
import {
  useReducedMotion,
  tabIndicatorTransition,
  getTransitionWithReducedMotion,
} from '../../lib/animation-utils';

/**
 * Context to provide a unique layout ID for animated tab indicators.
 * Each TabsList should have its own unique ID to prevent cross-list animations.
 */
const TabsIndicatorContext = React.createContext<string | null>(null);

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
  // Generate a unique ID for this tabs list to scope the animated indicator
  const indicatorId = React.useId();

  return (
    <TabsIndicatorContext.Provider value={indicatorId}>
      <TabsPrimitive.List
        ref={ref}
        className={cn(
          'inline-flex h-10 items-center justify-center rounded-lg bg-secondary p-1 text-muted-foreground',
          className
        )}
        {...props}
      />
    </TabsIndicatorContext.Provider>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
    /** Internal ref for tracking active state */
    'data-state'?: 'active' | 'inactive';
  }
>(({ className, children, ...props }, ref) => {
  const reducedMotion = useReducedMotion();
  const indicatorId = React.useContext(TabsIndicatorContext);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const [isActive, setIsActive] = React.useState(false);

  // Merge refs
  const mergedRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref]
  );

  // Observe data-state changes to track active state
  React.useEffect(() => {
    const node = triggerRef.current;
    if (!node) return;

    // Check initial state
    setIsActive(node.getAttribute('data-state') === 'active');

    // Use MutationObserver to watch for data-state changes
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'data-state') {
          setIsActive(node.getAttribute('data-state') === 'active');
        }
      }
    });

    observer.observe(node, { attributes: true, attributeFilter: ['data-state'] });

    return () => observer.disconnect();
  }, []);

  return (
    <TabsPrimitive.Trigger
      ref={mergedRef}
      className={cn(
        'relative inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium',
        'transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        'data-[state=active]:text-foreground',
        'data-[state=inactive]:hover:text-foreground/80',
        // Remove the static background from active state since we use animated indicator
        className
      )}
      {...props}
    >
      {/* Animated background indicator */}
      {isActive && indicatorId && (
        <motion.span
          layoutId={`tab-indicator-${indicatorId}`}
          className="absolute inset-0 rounded-md bg-card"
          transition={getTransitionWithReducedMotion(
            tabIndicatorTransition,
            reducedMotion
          )}
          style={{ zIndex: 0 }}
        />
      )}
      {/* Content sits above the indicator */}
      <span className="relative z-10">{children}</span>
    </TabsPrimitive.Trigger>
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
