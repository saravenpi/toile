import type { Note } from "./board.svelte";

// Auto-height notes (text blocks, media cards) render at `height: auto`, so the
// stored `note.h` would otherwise go stale — breaking selection bounds, fit, and
// the minimap. This action mirrors the element's real rendered height back into
// `note.h`. Setting `note.h` never feeds back into layout (height is auto), so
// there is no observer loop.
//
// Images and videos settle their height asynchronously (after decode / metadata),
// which a single mount-time measure misses — hence the load listeners and the
// rAF-deferred measure on top of the ResizeObserver.
export function autoHeight(node: HTMLElement, note: Note) {
  let current = note;
  let raf = 0;
  const measure = () => {
    raf = 0;
    const h = Math.round(node.offsetHeight);
    if (h > 0 && h !== Math.round(current.h)) current.h = h;
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(measure);
  };
  const ro = new ResizeObserver(schedule);
  ro.observe(node);
  // capture phase: <img> fires `load`, <video>/<audio> fire `loadedmetadata`
  node.addEventListener("load", schedule, true);
  node.addEventListener("loadedmetadata", schedule, true);
  schedule();
  return {
    update(n: Note) {
      current = n;
      schedule();
    },
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      node.removeEventListener("load", schedule, true);
      node.removeEventListener("loadedmetadata", schedule, true);
    },
  };
}
