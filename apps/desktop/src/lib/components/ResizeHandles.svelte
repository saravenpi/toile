<script lang="ts">
  import { board, type Note } from "../board.svelte";

  // `aspect`:
  //   number  → locked height/width ratio (corner + edge resize keeps it)
  //   "free"  → 2D resize, width and height move independently (YouTube cards)
  //   null    → width-only (content-driven height) → side handles only
  let {
    note,
    selected = false,
    editing = false,
    aspect = null,
  }: {
    note: Note;
    selected?: boolean;
    editing?: boolean;
    aspect?: number | "free" | null;
  } = $props();

  const free = $derived(aspect === "free");

  type Handle = { hx: -1 | 0 | 1; hy: -1 | 0 | 1 };

  const CORNERS: Handle[] = [
    { hx: -1, hy: -1 },
    { hx: 1, hy: -1 },
    { hx: 1, hy: 1 },
    { hx: -1, hy: 1 },
  ];
  const EDGES_ALL: Handle[] = [
    { hx: 0, hy: -1 },
    { hx: 1, hy: 0 },
    { hx: 0, hy: 1 },
    { hx: -1, hy: 0 },
  ];
  const handles = $derived<Handle[]>(
    aspect != null
      ? [...CORNERS, ...EDGES_ALL]
      : [{ hx: 1, hy: 0 }, { hx: -1, hy: 0 }],
  );

  const MIN_W = 80;
  const MAX_W = 2400;
  const clampW = (v: number) => Math.round(Math.min(MAX_W, Math.max(MIN_W, v)));
  const clampH = clampW;

  function cursorFor(h: Handle): string {
    if (h.hx !== 0 && h.hy !== 0)
      return h.hx === h.hy ? "nwse-resize" : "nesw-resize";
    return h.hx === 0 ? "ns-resize" : "ew-resize";
  }

  // Position each handle on the selection outline rectangle.
  function styleFor(h: Handle): string {
    const corner = h.hx !== 0 && h.hy !== 0;
    const inset = aspect != null ? 13 : 0; // keep edge strips clear of corners
    const cur = `cursor:${cursorFor(h)};`;
    if (corner) {
      return `left:${h.hx < 0 ? "0" : "100%"};top:${h.hy < 0 ? "0" : "100%"};width:16px;height:16px;transform:translate(-50%,-50%);${cur}`;
    }
    if (h.hx === 0) {
      return `left:${inset}px;right:${inset}px;top:${h.hy < 0 ? "0" : "100%"};height:16px;transform:translateY(-50%);${cur}`;
    }
    return `top:${inset}px;bottom:${inset}px;left:${h.hx < 0 ? "0" : "100%"};width:16px;transform:translateX(-50%);${cur}`;
  }

  let active: Handle | null = null;
  let x0 = 0;
  let y0 = 0;
  let w0 = 0;
  let h0 = 0;
  let asp = 1;
  let grabDX = 0;
  let grabDY = 0;
  let startX = 0;
  let startY = 0;
  let moved = false;

  function down(e: PointerEvent, h: Handle) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    active = h;
    x0 = note.x;
    y0 = note.y;
    w0 = note.w;
    h0 = note.h;
    asp =
      typeof aspect === "number"
        ? aspect
        : note.w > 0
          ? note.h / note.w
          : 1;
    // offset between where the cursor grabbed and the dragged edge, so the edge
    // tracks the pointer instead of jumping by the handle's outline offset.
    const px = (e.clientX - board.camera.x) / board.camera.scale;
    const py = (e.clientY - board.camera.y) / board.camera.scale;
    grabDX = px - (h.hx > 0 ? x0 + w0 : x0);
    grabDY = py - (h.hy > 0 ? y0 + h0 : y0);
    startX = e.clientX;
    startY = e.clientY;
    moved = false;
  }

  function move(e: PointerEvent) {
    if (!active) return;
    if (
      !moved &&
      Math.hypot(e.clientX - startX, e.clientY - startY) < 3
    )
      return;
    moved = true;
    const h = active;
    const px = (e.clientX - board.camera.x) / board.camera.scale - grabDX;
    const py = (e.clientY - board.camera.y) / board.camera.scale - grabDY;
    const right = x0 + w0;
    const bottom = y0 + h0;
    const awx = h.hx > 0 ? x0 : right;
    const ahy = h.hy > 0 ? y0 : bottom;
    if (free) {
      if (h.hx !== 0) {
        const nw = clampW(Math.abs(px - awx));
        note.w = nw;
        if (h.hx < 0) note.x = Math.round(right - nw);
      }
      if (h.hy !== 0) {
        const nh = clampH(Math.abs(py - ahy));
        note.h = nh;
        if (h.hy < 0) note.y = Math.round(bottom - nh);
      }
      return;
    }
    let candW = 0;
    let has = false;
    if (h.hx !== 0) {
      candW = Math.abs(px - awx);
      has = true;
    }
    if (h.hy !== 0) {
      const c = Math.abs(py - ahy) / asp;
      candW = has ? Math.max(candW, c) : c;
      has = true;
    }
    if (!has) return;
    const newW = clampW(candW);
    note.w = newW;
    if (h.hx < 0) note.x = Math.round(right - newW);
    if (h.hy < 0) note.y = Math.round(bottom - newW * asp);
  }

  function up(e: PointerEvent) {
    if (!active) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    active = null;
    if (moved)
      board.pushResize(
        note.id,
        w0,
        note.w,
        h0,
        note.h,
        x0,
        note.x,
        y0,
        note.y,
      );
  }
</script>

{#if selected || editing}
  <div class="frame">
    {#each handles as h (`${h.hx},${h.hy}`)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="handle"
        data-interactive
        style={styleFor(h)}
        onpointerdown={(e) => down(e, h)}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={up}
      >
        {#if !editing}<span class="dot"></span>{/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .frame {
    position: absolute;
    inset: calc(-1 * var(--sel-offset));
    pointer-events: none;
    z-index: 4;
  }
  .handle {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
    touch-action: none;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 2px;
    background: #fff;
    border: 1.5px solid var(--ink-soft);
    box-shadow: 0 1px 2px rgba(40, 38, 32, 0.25);
    transition: transform 0.12s var(--ease-soft);
  }
  .handle:hover .dot {
    transform: scale(1.2);
  }
</style>
