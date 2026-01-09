import * as React from 'react';
import { motion, type HTMLMotionProps } from 'motion/react';
import { cn } from '../../lib/utils';
import {
  useReducedMotion,
  cardAnimations,
  springTransition,
} from '../../lib/animation-utils';

// Motion div props for Card
type MotionDivProps = HTMLMotionProps<'div'>;

export interface CardProps
  extends Omit<MotionDivProps, 'ref'> {
  /**
   * Enable interactive hover effects (lift and glow).
   * When true, the card will lift and show a subtle glow on hover.
   * @default false
   */
  interactive?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive = false, ...props }, ref) => {
    const reducedMotion = useReducedMotion();

    // Base card styles
    const baseStyles = 'rounded-xl border border-border bg-card text-card-foreground transition-shadow duration-200';

    // Interactive styles for glow effect (CSS-based, respects reduced motion via transition)
    const interactiveStyles = interactive
      ? 'hover:shadow-lg hover:shadow-primary/10 hover:border-primary/20'
      : '';

    // Use motion.div for interactive cards, regular div otherwise
    if (interactive) {
      return (
        <motion.div
          ref={ref}
          className={cn(baseStyles, interactiveStyles, className)}
          whileHover={reducedMotion ? undefined : cardAnimations.hover}
          transition={springTransition}
          {...props}
        />
      );
    }

    // Non-interactive cards use regular div for performance
    // Extract motion-specific props to avoid passing them to regular div
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
      onAnimationStart,
      onAnimationComplete,
      ...htmlProps
    } = props;

    return (
      <div
        ref={ref}
        className={cn(baseStyles, 'transition-all duration-200', className)}
        {...(htmlProps as React.HTMLAttributes<HTMLDivElement>)}
      />
    );
  }
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
  )
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-xl font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  )
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  )
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
  )
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
