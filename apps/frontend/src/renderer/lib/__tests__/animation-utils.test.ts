/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useReducedMotion,
  springTransition,
  dialogSpringTransition,
  buttonAnimations,
  dialogVariants,
  dialogOverlayVariants,
  popoverVariants,
  cardAnimations,
  toastVariants,
  staggerContainerVariants,
  fastStaggerContainerVariants,
  staggerItemVariants,
  staggerItemVerticalVariants,
  focusRingAnimations,
  switchThumbTransition,
  tabIndicatorTransition,
  getAnimationWithReducedMotion,
  getTransitionWithReducedMotion,
} from '../animation-utils';

// Extended matchMedia mock type with test helpers
interface MockMediaQueryListExtended extends MediaQueryList {
  _triggerChange: (newMatches: boolean) => void;
  _listeners: Array<(event: MediaQueryListEvent) => void>;
}

// Create customizable matchMedia mock
const createMatchMediaMock = (initialMatches: boolean): MockMediaQueryListExtended => {
  const listeners: Array<(event: MediaQueryListEvent) => void> = [];

  const mockMediaQueryList = {
    matches: initialMatches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
      listeners.push(listener);
    }) as unknown as MediaQueryList['addListener'],
    removeListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
      const index = listeners.indexOf(listener);
      if (index > -1) listeners.splice(index, 1);
    }) as unknown as MediaQueryList['removeListener'],
    addEventListener: vi.fn((_event: string, listener: EventListener) => {
      listeners.push(listener as (event: MediaQueryListEvent) => void);
    }) as MediaQueryList['addEventListener'],
    removeEventListener: vi.fn((_event: string, listener: EventListener) => {
      const index = listeners.indexOf(listener as (event: MediaQueryListEvent) => void);
      if (index > -1) listeners.splice(index, 1);
    }) as MediaQueryList['removeEventListener'],
    dispatchEvent: vi.fn(() => true) as MediaQueryList['dispatchEvent'],
    _triggerChange: (newMatches: boolean) => {
      mockMediaQueryList.matches = newMatches;
      listeners.forEach((listener) => {
        listener({ matches: newMatches } as MediaQueryListEvent);
      });
    },
    _listeners: listeners,
  };

  return mockMediaQueryList;
};

describe('animation-utils', () => {
  describe('useReducedMotion', () => {
    let mockMediaQueryList: MockMediaQueryListExtended;

    beforeEach(() => {
      // Default to reduced motion OFF
      mockMediaQueryList = createMatchMediaMock(false);
      vi.spyOn(window, 'matchMedia').mockImplementation(() => mockMediaQueryList);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return false when reduced motion is not preferred', () => {
      mockMediaQueryList = createMatchMediaMock(false);
      vi.spyOn(window, 'matchMedia').mockImplementation(() => mockMediaQueryList);

      const { result } = renderHook(() => useReducedMotion());
      expect(result.current).toBe(false);
    });

    it('should return true when reduced motion is preferred', () => {
      mockMediaQueryList = createMatchMediaMock(true);
      vi.spyOn(window, 'matchMedia').mockImplementation(() => mockMediaQueryList);

      const { result } = renderHook(() => useReducedMotion());
      expect(result.current).toBe(true);
    });

    it('should respond to media query changes', async () => {
      mockMediaQueryList = createMatchMediaMock(false);
      vi.spyOn(window, 'matchMedia').mockImplementation(() => mockMediaQueryList);

      const { result } = renderHook(() => useReducedMotion());

      // Initial state: reduced motion off
      expect(result.current).toBe(false);

      // Simulate user enabling reduced motion
      act(() => {
        mockMediaQueryList._triggerChange(true);
      });

      await waitFor(() => {
        expect(result.current).toBe(true);
      });
    });

    it('should clean up event listener on unmount', () => {
      mockMediaQueryList = createMatchMediaMock(false);
      vi.spyOn(window, 'matchMedia').mockImplementation(() => mockMediaQueryList);

      const { unmount } = renderHook(() => useReducedMotion());

      // Verify listener was added
      expect(mockMediaQueryList.addEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function)
      );

      unmount();

      // Verify listener was removed
      expect(mockMediaQueryList.removeEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function)
      );
    });

    it('should add event listener for changes', () => {
      const { unmount } = renderHook(() => useReducedMotion());

      expect(mockMediaQueryList.addEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function)
      );

      unmount();
    });
  });

  describe('springTransition', () => {
    it('should have spring type', () => {
      expect(springTransition.type).toBe('spring');
    });

    it('should have appropriate stiffness value', () => {
      expect(springTransition.stiffness).toBe(400);
    });

    it('should have appropriate damping value', () => {
      expect(springTransition.damping).toBe(17);
    });
  });

  describe('dialogSpringTransition', () => {
    it('should have spring type', () => {
      expect(dialogSpringTransition.type).toBe('spring');
    });

    it('should have duration value', () => {
      expect(dialogSpringTransition.duration).toBe(0.3);
    });

    it('should have bounce value', () => {
      expect(dialogSpringTransition.bounce).toBe(0.2);
    });
  });

  describe('buttonAnimations', () => {
    it('should have hover animation with scale', () => {
      expect(buttonAnimations.hover).toBeDefined();
      expect(buttonAnimations.hover.scale).toBe(1.02);
    });

    it('should have tap animation with scale', () => {
      expect(buttonAnimations.tap).toBeDefined();
      expect(buttonAnimations.tap.scale).toBe(0.98);
    });
  });

  describe('dialogVariants', () => {
    it('should have hidden state', () => {
      expect(dialogVariants.hidden).toBeDefined();
      expect(dialogVariants.hidden).toHaveProperty('opacity', 0);
      expect(dialogVariants.hidden).toHaveProperty('scale', 0.95);
      expect(dialogVariants.hidden).toHaveProperty('y', -10);
    });

    it('should have visible state', () => {
      expect(dialogVariants.visible).toBeDefined();
      expect(dialogVariants.visible).toHaveProperty('opacity', 1);
      expect(dialogVariants.visible).toHaveProperty('scale', 1);
      expect(dialogVariants.visible).toHaveProperty('y', 0);
    });

    it('should have exit state', () => {
      expect(dialogVariants.exit).toBeDefined();
      expect(dialogVariants.exit).toHaveProperty('opacity', 0);
      expect(dialogVariants.exit).toHaveProperty('scale', 0.95);
    });

    it('visible state should include transition', () => {
      expect(dialogVariants.visible).toHaveProperty('transition');
    });
  });

  describe('dialogOverlayVariants', () => {
    it('should have hidden state with zero opacity', () => {
      expect(dialogOverlayVariants.hidden).toHaveProperty('opacity', 0);
    });

    it('should have visible state with full opacity', () => {
      expect(dialogOverlayVariants.visible).toHaveProperty('opacity', 1);
    });

    it('should have exit state', () => {
      expect(dialogOverlayVariants.exit).toBeDefined();
    });
  });

  describe('popoverVariants', () => {
    it('should have hidden state', () => {
      expect(popoverVariants.hidden).toBeDefined();
      expect(popoverVariants.hidden).toHaveProperty('opacity', 0);
      expect(popoverVariants.hidden).toHaveProperty('scale', 0.96);
    });

    it('should have visible state', () => {
      expect(popoverVariants.visible).toBeDefined();
      expect(popoverVariants.visible).toHaveProperty('opacity', 1);
      expect(popoverVariants.visible).toHaveProperty('scale', 1);
    });

    it('should have exit state', () => {
      expect(popoverVariants.exit).toBeDefined();
    });
  });

  describe('cardAnimations', () => {
    it('should have hover animation with lift effect', () => {
      expect(cardAnimations.hover).toBeDefined();
      expect(cardAnimations.hover.y).toBe(-2);
      expect(cardAnimations.hover.scale).toBe(1.01);
    });
  });

  describe('toastVariants', () => {
    it('should have hidden state with offset x', () => {
      expect(toastVariants.hidden).toBeDefined();
      expect(toastVariants.hidden).toHaveProperty('x', 100);
      expect(toastVariants.hidden).toHaveProperty('opacity', 0);
    });

    it('should have visible state at origin', () => {
      expect(toastVariants.visible).toBeDefined();
      expect(toastVariants.visible).toHaveProperty('x', 0);
      expect(toastVariants.visible).toHaveProperty('opacity', 1);
    });

    it('should have exit state with offset', () => {
      expect(toastVariants.exit).toBeDefined();
      expect(toastVariants.exit).toHaveProperty('x', 100);
    });

    it('visible transition should use spring physics', () => {
      const visibleTransition = (toastVariants.visible as { transition?: { type?: string } })
        .transition;
      expect(visibleTransition).toBeDefined();
      expect(visibleTransition?.type).toBe('spring');
    });
  });

  describe('staggerContainerVariants', () => {
    it('should have hidden state', () => {
      expect(staggerContainerVariants.hidden).toBeDefined();
    });

    it('should have visible state with stagger transition', () => {
      expect(staggerContainerVariants.visible).toBeDefined();
      const visibleTransition = (
        staggerContainerVariants.visible as { transition?: { staggerChildren?: number } }
      ).transition;
      expect(visibleTransition?.staggerChildren).toBe(0.05);
    });
  });

  describe('fastStaggerContainerVariants', () => {
    it('should have faster stagger than regular container', () => {
      const fastTransition = (
        fastStaggerContainerVariants.visible as { transition?: { staggerChildren?: number } }
      ).transition;
      const regularTransition = (
        staggerContainerVariants.visible as { transition?: { staggerChildren?: number } }
      ).transition;

      expect(fastTransition?.staggerChildren).toBeLessThan(regularTransition?.staggerChildren || 1);
    });

    it('should have staggerChildren of 0.03', () => {
      const transition = (
        fastStaggerContainerVariants.visible as { transition?: { staggerChildren?: number } }
      ).transition;
      expect(transition?.staggerChildren).toBe(0.03);
    });
  });

  describe('staggerItemVariants', () => {
    it('should have hidden state with horizontal offset', () => {
      expect(staggerItemVariants.hidden).toHaveProperty('x', -10);
      expect(staggerItemVariants.hidden).toHaveProperty('opacity', 0);
    });

    it('should have visible state at origin', () => {
      expect(staggerItemVariants.visible).toHaveProperty('x', 0);
      expect(staggerItemVariants.visible).toHaveProperty('opacity', 1);
    });
  });

  describe('staggerItemVerticalVariants', () => {
    it('should have hidden state with vertical offset', () => {
      expect(staggerItemVerticalVariants.hidden).toHaveProperty('y', -10);
      expect(staggerItemVerticalVariants.hidden).toHaveProperty('opacity', 0);
    });

    it('should have visible state at origin', () => {
      expect(staggerItemVerticalVariants.visible).toHaveProperty('y', 0);
      expect(staggerItemVerticalVariants.visible).toHaveProperty('opacity', 1);
    });
  });

  describe('focusRingAnimations', () => {
    it('should have unfocused state', () => {
      expect(focusRingAnimations.unfocused).toBeDefined();
      expect(focusRingAnimations.unfocused.opacity).toBe(0);
      expect(focusRingAnimations.unfocused.scale).toBe(0.95);
    });

    it('should have focused state', () => {
      expect(focusRingAnimations.focused).toBeDefined();
      expect(focusRingAnimations.focused.opacity).toBe(1);
      expect(focusRingAnimations.focused.scale).toBe(1);
    });

    it('focused state should include spring transition', () => {
      expect(focusRingAnimations.focused.transition).toBeDefined();
      expect(focusRingAnimations.focused.transition.type).toBe('spring');
    });
  });

  describe('switchThumbTransition', () => {
    it('should have spring type', () => {
      expect(switchThumbTransition.type).toBe('spring');
    });

    it('should have high stiffness for snappy feel', () => {
      expect(switchThumbTransition.stiffness).toBe(500);
    });

    it('should have appropriate damping', () => {
      expect(switchThumbTransition.damping).toBe(30);
    });
  });

  describe('tabIndicatorTransition', () => {
    it('should have spring type', () => {
      expect(tabIndicatorTransition.type).toBe('spring');
    });

    it('should have appropriate stiffness', () => {
      expect(tabIndicatorTransition.stiffness).toBe(350);
    });

    it('should have appropriate damping', () => {
      expect(tabIndicatorTransition.damping).toBe(30);
    });
  });

  describe('getAnimationWithReducedMotion', () => {
    it('should return animation when reduced motion is false', () => {
      const animation = { scale: 1.02 };
      const result = getAnimationWithReducedMotion(animation, false);
      expect(result).toBe(animation);
    });

    it('should return undefined when reduced motion is true', () => {
      const animation = { scale: 1.02 };
      const result = getAnimationWithReducedMotion(animation, true);
      expect(result).toBeUndefined();
    });

    it('should work with complex animation objects', () => {
      const complexAnimation = {
        scale: [1, 1.1, 1],
        opacity: [1, 0.8, 1],
        rotate: 360,
      };
      expect(getAnimationWithReducedMotion(complexAnimation, false)).toBe(complexAnimation);
      expect(getAnimationWithReducedMotion(complexAnimation, true)).toBeUndefined();
    });
  });

  describe('getTransitionWithReducedMotion', () => {
    it('should return original transition when reduced motion is false', () => {
      const transition = { type: 'spring' as const, stiffness: 400, damping: 17 };
      const result = getTransitionWithReducedMotion(transition, false);
      expect(result).toBe(transition);
    });

    it('should return instant transition when reduced motion is true', () => {
      const transition = { type: 'spring' as const, stiffness: 400, damping: 17 };
      const result = getTransitionWithReducedMotion(transition, true);
      expect(result).toEqual({ duration: 0 });
    });

    it('should work with complex transitions', () => {
      const complexTransition = {
        type: 'spring' as const,
        stiffness: 500,
        damping: 30,
        mass: 1,
      };
      expect(getTransitionWithReducedMotion(complexTransition, false)).toBe(complexTransition);
      expect(getTransitionWithReducedMotion(complexTransition, true)).toEqual({ duration: 0 });
    });
  });
});
