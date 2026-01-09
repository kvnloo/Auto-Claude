import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';
import {
  useReducedMotion,
  switchThumbTransition,
  getTransitionWithReducedMotion,
} from '../../lib/animation-utils';

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, checked, defaultChecked, onCheckedChange, ...props }, ref) => {
  const reducedMotion = useReducedMotion();

  // Track internal checked state for animation
  const [isChecked, setIsChecked] = React.useState(defaultChecked ?? false);

  // Sync with controlled checked prop
  React.useEffect(() => {
    if (checked !== undefined) {
      setIsChecked(checked);
    }
  }, [checked]);

  const handleCheckedChange = React.useCallback(
    (value: boolean) => {
      if (checked === undefined) {
        // Uncontrolled mode
        setIsChecked(value);
      }
      onCheckedChange?.(value);
    },
    [checked, onCheckedChange]
  );

  // Calculate thumb position: 20px (5 * 4px) travel distance
  const thumbX = isChecked ? 20 : 0;

  return (
    <SwitchPrimitives.Root
      className={cn(
        'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full',
        'border-2 border-transparent transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-border',
        className
      )}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={handleCheckedChange}
      {...props}
      ref={ref}
    >
      <SwitchPrimitives.Thumb asChild>
        <motion.span
          className={cn(
            'pointer-events-none block h-5 w-5 rounded-full shadow-sm ring-0',
            'bg-white dark:bg-foreground',
            'data-[state=checked]:bg-primary-foreground'
          )}
          animate={{ x: thumbX }}
          transition={getTransitionWithReducedMotion(
            switchThumbTransition,
            reducedMotion
          )}
        />
      </SwitchPrimitives.Thumb>
    </SwitchPrimitives.Root>
  );
});
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
