import { useState, useEffect } from 'react';
import type { Variants, Transition } from 'motion/react';

/**
 * Hook to detect user's reduced motion preference.
 * Listens for changes to the prefers-reduced-motion media query.
 * SSR-safe with proper initial state handling.
 */
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() => {
    // Check if window is available (for SSR safety)
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const handleChange = (event: MediaQueryListEvent) => {
      setReducedMotion(event.matches);
    };

    // Add listener for changes
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  return reducedMotion;
}

/**
 * Spring transition configuration for interactive elements.
 * Provides a natural, responsive feel for buttons and toggles.
 */
export const springTransition: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 17,
};

/**
 * Smooth spring transition for dialogs and overlays.
 * Slightly softer than button springs for a more elegant feel.
 */
export const dialogSpringTransition: Transition = {
  type: 'spring',
  duration: 0.3,
  bounce: 0.2,
};

/**
 * Button animation configuration for whileHover and whileTap states.
 * Use with motion.button or motion component wrapping a button.
 *
 * @example
 * ```tsx
 * const reducedMotion = useReducedMotion();
 * <motion.button
 *   whileHover={reducedMotion ? undefined : buttonAnimations.hover}
 *   whileTap={reducedMotion ? undefined : buttonAnimations.tap}
 *   transition={springTransition}
 * >
 *   Click me
 * </motion.button>
 * ```
 */
export const buttonAnimations = {
  /** Subtle scale up on hover */
  hover: { scale: 1.02 },
  /** Subtle scale down on click/tap for physical press feel */
  tap: { scale: 0.98 },
} as const;

/**
 * Motion variants for dialog/modal enter and exit animations.
 * Combines opacity, scale, and vertical slide for a polished effect.
 *
 * @example
 * ```tsx
 * <AnimatePresence>
 *   {isOpen && (
 *     <motion.div
 *       variants={dialogVariants}
 *       initial="hidden"
 *       animate="visible"
 *       exit="exit"
 *     >
 *       Dialog content
 *     </motion.div>
 *   )}
 * </AnimatePresence>
 * ```
 */
export const dialogVariants: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.95,
    y: -10,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: dialogSpringTransition,
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: -10,
    transition: { duration: 0.15, ease: 'easeOut' },
  },
};

/**
 * Motion variants for dialog overlay/backdrop.
 * Simple fade in/out effect.
 */
export const dialogOverlayVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.2, ease: 'easeOut' },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.15, ease: 'easeIn' },
  },
};

/**
 * Motion variants for popover enter and exit animations.
 * Uses spring physics for a natural pop effect.
 */
export const popoverVariants: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.96,
    y: -4,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: 'spring',
      duration: 0.25,
      bounce: 0.15,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    y: -4,
    transition: { duration: 0.1, ease: 'easeOut' },
  },
};

/**
 * Card hover animation configuration.
 * Provides a subtle lift effect with shadow enhancement.
 *
 * @example
 * ```tsx
 * const reducedMotion = useReducedMotion();
 * <motion.div
 *   whileHover={reducedMotion ? undefined : cardAnimations.hover}
 *   transition={springTransition}
 * >
 *   Card content
 * </motion.div>
 * ```
 */
export const cardAnimations = {
  /** Subtle lift on hover */
  hover: { y: -2, scale: 1.01 },
} as const;

/**
 * Motion variants for toast notifications.
 * Slides in from the right edge with spring physics.
 */
export const toastVariants: Variants = {
  hidden: {
    opacity: 0,
    x: 100,
    scale: 0.95,
  },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: {
      type: 'spring',
      stiffness: 350,
      damping: 25,
    },
  },
  exit: {
    opacity: 0,
    x: 100,
    scale: 0.95,
    transition: { duration: 0.2, ease: 'easeIn' },
  },
};

/**
 * Container variants for staggered children animations.
 * Use on the parent element containing items to animate.
 *
 * @example
 * ```tsx
 * <motion.ul
 *   variants={staggerContainerVariants}
 *   initial="hidden"
 *   animate="visible"
 * >
 *   {items.map(item => (
 *     <motion.li key={item.id} variants={staggerItemVariants}>
 *       {item.content}
 *     </motion.li>
 *   ))}
 * </motion.ul>
 * ```
 */
export const staggerContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

/**
 * Fast stagger variants for menus and dropdowns.
 * Uses shorter delays for snappier feel.
 */
export const fastStaggerContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.03,
      delayChildren: 0.05,
    },
  },
};

/**
 * Item variants for staggered children animations.
 * Fades in with horizontal slide from the left.
 */
export const staggerItemVariants: Variants = {
  hidden: {
    opacity: 0,
    x: -10,
  },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 20,
    },
  },
};

/**
 * Vertical stagger item variants.
 * Fades in with vertical slide from above.
 */
export const staggerItemVerticalVariants: Variants = {
  hidden: {
    opacity: 0,
    y: -10,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 20,
    },
  },
};

/**
 * Focus ring animation configuration.
 * Use for animated focus states on form inputs.
 */
export const focusRingAnimations = {
  /** Initial unfocused state */
  unfocused: { opacity: 0, scale: 0.95 },
  /** Animated focused state */
  focused: {
    opacity: 1,
    scale: 1,
    transition: {
      type: 'spring',
      stiffness: 400,
      damping: 25,
    },
  },
} as const;

/**
 * Switch thumb animation configuration.
 * Spring-based movement for toggle switches.
 */
export const switchThumbTransition: Transition = {
  type: 'spring',
  stiffness: 500,
  damping: 30,
};

/**
 * Tab indicator animation configuration.
 * Use with layoutId for smooth position transitions.
 */
export const tabIndicatorTransition: Transition = {
  type: 'spring',
  stiffness: 350,
  damping: 30,
};

/**
 * Helper to conditionally apply animations based on reduced motion preference.
 * Returns undefined when reduced motion is enabled, allowing Motion to skip animations.
 *
 * @param animation The animation to apply
 * @param reducedMotion Whether reduced motion is preferred
 * @returns The animation or undefined if reduced motion is enabled
 *
 * @example
 * ```tsx
 * const reducedMotion = useReducedMotion();
 * <motion.button
 *   whileHover={getAnimationWithReducedMotion(buttonAnimations.hover, reducedMotion)}
 *   whileTap={getAnimationWithReducedMotion(buttonAnimations.tap, reducedMotion)}
 * >
 *   Click me
 * </motion.button>
 * ```
 */
export function getAnimationWithReducedMotion<T>(
  animation: T,
  reducedMotion: boolean
): T | undefined {
  return reducedMotion ? undefined : animation;
}

/**
 * Helper to get transition with instant duration for reduced motion.
 * Returns a zero-duration transition when reduced motion is enabled.
 *
 * @param transition The transition to apply
 * @param reducedMotion Whether reduced motion is preferred
 * @returns The transition or instant transition if reduced motion is enabled
 */
export function getTransitionWithReducedMotion(
  transition: Transition,
  reducedMotion: boolean
): Transition {
  return reducedMotion ? { duration: 0 } : transition;
}
