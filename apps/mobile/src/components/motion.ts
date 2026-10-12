import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "react-native-reanimated";

import { countUpValue } from "@/ring";
import { motion } from "@/theme";

/** `true` when the person asked the system for less motion. Every animation checks it and jumps to its end value instead. */
export function useReduceMotion(): boolean {
  return useReducedMotion();
}

/**
 * Counts a whole number up (or down) to `target` when it changes, easing out. The first value
 * counts up from 0; later changes start from what is on screen. With reduced motion the target
 * is returned at once.
 */
export function useCountUp(target: number, duration: number = motion.countUp): number {
  const reduce = useReduceMotion();
  const [shown, setShown] = useState(reduce ? target : 0);
  const from = useRef(reduce ? target : 0);

  useEffect(() => {
    if (reduce || duration <= 0) {
      from.current = target;
      setShown(target);
      return;
    }
    const start = from.current;
    const t0 = Date.now();
    let frame = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - t0) / duration);
      const v = countUpValue(start, target, t);
      from.current = v;
      setShown(v);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, reduce]);

  return shown;
}
