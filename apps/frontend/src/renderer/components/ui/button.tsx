import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { motion, type HTMLMotionProps } from 'motion/react';
import { cn } from '../../lib/utils';
import {
  useReducedMotion,
  buttonAnimations,
  springTransition,
} from '../../lib/animation-utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline:
          'border border-border bg-transparent hover:bg-accent hover:text-accent-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost:
          'hover:bg-accent hover:text-accent-foreground',
        link:
          'text-primary underline-offset-4 hover:underline',
        success:
          'bg-[var(--success)] text-[var(--success-foreground)] hover:bg-[var(--success)]/90',
        warning:
          'bg-warning text-warning-foreground hover:bg-warning/90',
        info:
          'bg-info text-info-foreground hover:bg-info/90',
      },
      size: {
        default: 'h-10 px-4 py-2 text-sm rounded-lg',
        sm: 'h-8 px-3 text-xs rounded-md',
        lg: 'h-12 px-6 text-base rounded-lg',
        icon: 'h-10 w-10 rounded-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

// Base button props with motion support
type MotionButtonProps = HTMLMotionProps<'button'>;

export interface ButtonProps
  extends Omit<MotionButtonProps, 'ref'>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const reducedMotion = useReducedMotion();

    // When asChild is true, use Slot without motion (Slot doesn't support motion props)
    if (asChild) {
      // Extract only the HTML button props for Slot
      const {
        whileHover,
        whileTap,
        whileFocus,
        whileDrag,
        whileInView,
        animate,
        initial,
        exit,
        variants,
        transition,
        ...htmlProps
      } = props;

      return (
        <Slot
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          {...(htmlProps as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        />
      );
    }

    // Use motion.button with hover and tap animations
    return (
      <motion.button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        whileHover={reducedMotion ? undefined : buttonAnimations.hover}
        whileTap={reducedMotion ? undefined : buttonAnimations.tap}
        transition={springTransition}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
