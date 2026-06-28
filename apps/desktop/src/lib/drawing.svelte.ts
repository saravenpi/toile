import { board } from "./board.svelte";
import { smoothPath, simplify } from "./draw";

type EraseCand = { id: string; el: SVGPathElement; bb: DOMRect; hw: number };

// Pen + eraser tool: owns draw-mode state and the live stroke / erase gesture.
// Self-contained — it reads the camera off `board` and writes strokes through it.
class DrawTool {
  mode = $state<"normal" | "draw">("normal");
  tool = $state<"pen" | "eraser">("pen");
  color = $state("#43413b");
  width = $state(5);
  live = $state<{ x: number; y: number }[]>([]);
  marks = $state(new Set<string>());

  #drawingPointer: number | null = null;
  #erasePointer: number | null = null;
  #eraseLast: { x: number; y: number } | null = null;
  #eraseCands: EraseCand[] = [];

  get drawing(): boolean {
    return this.#drawingPointer !== null;
  }
  get erasing(): boolean {
    return this.#erasePointer !== null;
  }

  #toWorld(cx: number, cy: number) {
    return {
      x: (cx - board.camera.x) / board.camera.scale,
      y: (cy - board.camera.y) / board.camera.scale,
    };
  }

  enter(): void {
    this.mode = "draw";
    this.cancelStroke();
    this.cancelErase();
  }
  exit(): void {
    this.mode = "normal";
    this.cancelStroke();
    this.cancelErase();
  }

  startStroke(e: PointerEvent): void {
    this.#drawingPointer = e.pointerId;
    const w = this.#toWorld(e.clientX, e.clientY);
    this.live = [{ x: w.x, y: w.y }];
  }
  extendStroke(e: PointerEvent): void {
    const evs = e.getCoalescedEvents?.() ?? [e];
    for (const ev of evs) {
      const w = this.#toWorld(ev.clientX, ev.clientY);
      this.live.push({ x: w.x, y: w.y });
    }
  }
  finishStroke(): void {
    this.#drawingPointer = null;
    if (this.live.length) {
      const width = this.width / board.camera.scale;
      board.addStroke(smoothPath(simplify(this.live)), this.color, width);
    }
    this.live = [];
  }
  cancelStroke(): void {
    this.#drawingPointer = null;
    this.live = [];
  }

  startErase(e: PointerEvent): void {
    this.#erasePointer = e.pointerId;
    this.marks = new Set();
    this.#eraseCands = [];
    const layer = document.querySelector(".draw-layer");
    if (layer) {
      for (const el of layer.querySelectorAll<SVGPathElement>(
        "path[data-stroke-id]",
      )) {
        try {
          this.#eraseCands.push({
            id: el.dataset.strokeId!,
            el,
            bb: el.getBBox(),
            hw: parseFloat(el.getAttribute("stroke-width") ?? "0") / 2,
          });
        } catch {}
      }
    }
    const w = this.#toWorld(e.clientX, e.clientY);
    this.#eraseLast = w;
    this.#markErase(w.x, w.y);
  }
  extendErase(e: PointerEvent): void {
    const evs = e.getCoalescedEvents?.() ?? [e];
    for (const ev of evs) {
      const w = this.#toWorld(ev.clientX, ev.clientY);
      if (this.#eraseLast) {
        const dx = w.x - this.#eraseLast.x;
        const dy = w.y - this.#eraseLast.y;
        const step = 6 / board.camera.scale;
        const n = Math.min(48, Math.floor(Math.hypot(dx, dy) / step));
        for (let i = 1; i <= n; i++)
          this.#markErase(
            this.#eraseLast.x + (dx * i) / n,
            this.#eraseLast.y + (dy * i) / n,
          );
      }
      this.#markErase(w.x, w.y);
      this.#eraseLast = w;
    }
  }
  #markErase(wx: number, wy: number): void {
    const margin = 12 / board.camera.scale;
    let changed = false;
    for (const c of this.#eraseCands) {
      if (this.marks.has(c.id)) continue;
      const m = margin + c.hw;
      if (
        wx < c.bb.x - m ||
        wx > c.bb.x + c.bb.width + m ||
        wy < c.bb.y - m ||
        wy > c.bb.y + c.bb.height + m
      )
        continue;
      if (this.#hitsStroke(c.el, wx, wy, margin)) {
        this.marks.add(c.id);
        changed = true;
      }
    }
    if (changed) this.marks = new Set(this.marks);
  }
  #hitsStroke(el: SVGPathElement, wx: number, wy: number, r: number): boolean {
    if (el.isPointInStroke(new DOMPoint(wx, wy))) return true;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (
        el.isPointInStroke(new DOMPoint(wx + Math.cos(a) * r, wy + Math.sin(a) * r))
      )
        return true;
    }
    return false;
  }
  finishErase(): void {
    this.#erasePointer = null;
    this.#eraseLast = null;
    if (this.marks.size) board.commitErase(board.removeStrokes(this.marks));
    this.marks = new Set();
    this.#eraseCands = [];
  }
  cancelErase(): void {
    this.#erasePointer = null;
    this.#eraseLast = null;
    this.marks = new Set();
    this.#eraseCands = [];
  }
}

export const draw = new DrawTool();
