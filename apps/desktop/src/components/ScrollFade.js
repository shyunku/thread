import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./ScrollFade.scss";

const hasMore = (el) => el.scrollTop + el.clientHeight < el.scrollHeight - 2;

// The bottom of a scrolling area fades into the background while there is more below (#104 mock
// .vig-f56). It goes right after the scrolling element and draws over its last 56px; at the end
// of the scroll, or with nothing to scroll, it is gone.
export default function ScrollFade() {
  const ref = useRef(null);
  const [on, setOn] = useState(false);
  // The parent's render may have changed the content.
  useLayoutEffect(() => {
    const el = ref.current?.previousElementSibling;
    if (el) setOn(hasMore(el));
  });
  useEffect(() => {
    const el = ref.current?.previousElementSibling;
    if (!el) return undefined;
    const update = () => setOn(hasMore(el));
    el.addEventListener("scroll", update, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resize?.observe(el);
    // Rows folded, added or grown (a long title wrapping) change the height without a resize.
    const mutation = typeof MutationObserver === "undefined" ? null : new MutationObserver(update);
    mutation?.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", update);
      resize?.disconnect();
      mutation?.disconnect();
    };
  }, []);
  return <div ref={ref} className={"scroll-fade" + (on ? " on" : "")} aria-hidden="true" />;
}
