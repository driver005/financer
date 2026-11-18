import { useEffect, useState } from "react";

/** True once the page is scrolled past `offset` px (passive listener, rAF-throttled). */
export function useScrolledPast(offset: () => number): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      setPast(window.scrollY > offset());
    };
    const on = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on, { passive: true });
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      if (frame) cancelAnimationFrame(frame);
    };
    // offset is a pure reader of window size; re-subscribing on identity change is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return past;
}
