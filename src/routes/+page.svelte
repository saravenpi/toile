<script lang="ts">
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { listen } from "@tauri-apps/api/event";
  import { readImage } from "@tauri-apps/plugin-clipboard-manager";
  import { openPath, openUrl } from "@tauri-apps/plugin-opener";
  import type { Image } from "@tauri-apps/api/image";
  import Postit from "$lib/components/Postit.svelte";
  import Palette from "$lib/components/Palette.svelte";
  import AttachButton from "$lib/components/AttachButton.svelte";
  import ZoomControls from "$lib/components/ZoomControls.svelte";
  import Minimap from "$lib/components/Minimap.svelte";
  import SearchPalette from "$lib/components/SearchPalette.svelte";
  import CircleButton from "$lib/components/CircleButton.svelte";
  import FontControls from "$lib/components/FontControls.svelte";
  import DrawControls from "$lib/components/DrawControls.svelte";
  import DrawLayer from "$lib/components/DrawLayer.svelte";
  import Trash from "$lib/components/Trash.svelte";
  import ContextMenu from "$lib/components/ContextMenu.svelte";
  import PasteMenu from "$lib/components/PasteMenu.svelte";
  import {
    board,
    COLORS,
    MIN_SCALE,
    MAX_SCALE,
    TEXT_COLOR,
    type Note,
    type Camera,
    type FontKey,
  } from "$lib/board.svelte";
  import { smoothPath, simplify, pathBBox } from "$lib/draw";
  import UndoRedo from "$lib/components/UndoRedo.svelte";
  import Cheatsheet from "$lib/components/Cheatsheet.svelte";
  import { assetKind, assetPath, isCardOnly } from "$lib/assets";
  import { links } from "$lib/links.svelte";
  import { safeExternal } from "$lib/links";

  const GRID = 26;

  let trashEl = $state<HTMLDivElement | null>(null);
  let searchOpen = $state(false);
  let helpOpen = $state(false);
  let editingId = $state<string | null>(null);
  let selectedIds = $state(new Set<string>());
  let selectedStrokeIds = $state(new Set<string>());
  let overSel = $state(false);
  let dragId = $state<string | null>(null);
  let dragging = $state(false);
  let trashHot = $state(false);
  let panning = $state(false);
  let marquee = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );
  let spaceHeld = $state(false);
  let attach = $state<{ open: () => void } | null>(null);

  const selectOne = (id: string) => {
    selectedIds = new Set([id]);
    if (selectedStrokeIds.size) selectedStrokeIds = new Set();
  };
  const clearSelection = () => {
    if (selectedIds.size) selectedIds = new Set();
    if (selectedStrokeIds.size) selectedStrokeIds = new Set();
  };

  function selectionBBox(): { x0: number; y0: number; x1: number; y1: number } | null {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const n of board.notes)
      if (selectedIds.has(n.id)) {
        x0 = Math.min(x0, n.x);
        y0 = Math.min(y0, n.y);
        x1 = Math.max(x1, n.x + n.w);
        y1 = Math.max(y1, n.y + n.h);
      }
    for (const s of board.strokes)
      if (selectedStrokeIds.has(s.id)) {
        const b = pathBBox(s.d);
        x0 = Math.min(x0, b.x);
        y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.w);
        y1 = Math.max(y1, b.y + b.h);
      }
    return x0 === Infinity ? null : { x0, y0, x1, y1 };
  }

  const selBBox = $derived.by(() => selectionBBox());

  let mode = $state<"normal" | "draw">("normal");
  let drawTool = $state<"pen" | "eraser">("pen");
  let drawColor = $state("#43413b");
  let drawWidth = $state(5);
  let liveStroke = $state<{ x: number; y: number }[]>([]);
  let drawingPointer: number | null = null;
  let erasePointer: number | null = null;
  let eraseMarks = $state(new Set<string>());
  let eraseLast: { x: number; y: number } | null = null;

  let pressId: string | null = null;
  let pressTarget: HTMLElement | null = null;
  let pressMoved = false;
  let pressStart = { x: 0, y: 0 };

  let menu = $state<{ x: number; y: number; id: string } | null>(null);
  let pasteMenu = $state<{
    x: number;
    y: number;
    wx: number;
    wy: number;
  } | null>(null);
  let pasteImage: Image | null = null;
  let focusedId = $state<string | null>(null);
  let prevCamera: Camera | null = null;
  let editPrevCamera: Camera | null = null;

  let toast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout>;
  function showToast(msg: string) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 4200);
  }

  let dragNotes: Note[] = [];
  let dragStrokeIds: string[] = [];
  let dragIsSingle = false;
  let movedDx = 0;
  let movedDy = 0;
  let suppressClick = false;
  let last = { x: 0, y: 0 };
  let raf: number | null = null;

  const lastSig = new Map<string, string>();
  let writeTimer: ReturnType<typeof setTimeout>;

  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v));

  function toWorld(cx: number, cy: number) {
    return {
      x: (cx - board.camera.x) / board.camera.scale,
      y: (cy - board.camera.y) / board.camera.scale,
    };
  }

  function viewCenterWorld() {
    return toWorld(window.innerWidth / 2, window.innerHeight / 2);
  }

  function animateCamera(target: { x: number; y: number; scale: number }) {
    if (raf) cancelAnimationFrame(raf);
    const start = { ...board.camera };
    const t0 = performance.now();
    const dur = 460;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const k = ease(p);
      board.camera = {
        x: start.x + (target.x - start.x) * k,
        y: start.y + (target.y - start.y) * k,
        scale: start.scale + (target.scale - start.scale) * k,
      };
      raf = p < 1 ? requestAnimationFrame(step) : null;
    };
    raf = requestAnimationFrame(step);
  }

  function stopTween() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  function addNote(color: string) {
    commitEdit();
    const c = viewCenterWorld();
    const note = board.add(color, c.x, c.y);
    focusNote(note);
  }

  function addTextNote() {
    commitEdit();
    const c = viewCenterWorld();
    const note = board.add(TEXT_COLOR, c.x, c.y, "", "sans");
    focusNote(note);
  }

  const editingNote = $derived(
    board.notes.find((n) => n.id === editingId) ?? null,
  );
  const editingTextNote = $derived(editingNote?.color === TEXT_COLOR);
  const editingFont = $derived<FontKey>(editingNote?.font ?? "sans");
  function setEditingFont(f: FontKey) {
    if (editingNote) editingNote.font = f;
  }

  function enterDraw() {
    commitEdit();
    clearSelection();
    menu = null;
    mode = "draw";
  }
  function exitDraw() {
    mode = "normal";
    cancelStroke();
    cancelErase();
  }

  function startStroke(e: PointerEvent) {
    drawingPointer = e.pointerId;
    const w = toWorld(e.clientX, e.clientY);
    liveStroke = [{ x: w.x, y: w.y }];
  }
  function extendStroke(e: PointerEvent) {
    const evs = e.getCoalescedEvents?.() ?? [e];
    for (const ev of evs) {
      const w = toWorld(ev.clientX, ev.clientY);
      liveStroke.push({ x: w.x, y: w.y });
    }
  }
  function finishStroke() {
    drawingPointer = null;
    if (liveStroke.length) {
      const width = drawWidth / board.camera.scale;
      board.addStroke(smoothPath(simplify(liveStroke)), drawColor, width);
    }
    liveStroke = [];
  }
  function cancelStroke() {
    drawingPointer = null;
    liveStroke = [];
  }

  type EraseCand = { id: string; el: SVGPathElement; bb: DOMRect; hw: number };
  let eraseCands: EraseCand[] = [];

  function startErase(e: PointerEvent) {
    erasePointer = e.pointerId;
    eraseMarks = new Set();
    eraseCands = [];
    const layer = document.querySelector(".draw-layer");
    if (layer) {
      for (const el of layer.querySelectorAll<SVGPathElement>(
        "path[data-stroke-id]",
      )) {
        try {
          eraseCands.push({
            id: el.dataset.strokeId!,
            el,
            bb: el.getBBox(),
            hw: parseFloat(el.getAttribute("stroke-width") ?? "0") / 2,
          });
        } catch {}
      }
    }
    const w = toWorld(e.clientX, e.clientY);
    eraseLast = w;
    markErase(w.x, w.y);
  }

  function extendErase(e: PointerEvent) {
    const evs = e.getCoalescedEvents?.() ?? [e];
    for (const ev of evs) {
      const w = toWorld(ev.clientX, ev.clientY);
      if (eraseLast) {
        const dx = w.x - eraseLast.x;
        const dy = w.y - eraseLast.y;
        const step = 6 / board.camera.scale;
        const n = Math.min(48, Math.floor(Math.hypot(dx, dy) / step));
        for (let i = 1; i <= n; i++)
          markErase(eraseLast.x + (dx * i) / n, eraseLast.y + (dy * i) / n);
      }
      markErase(w.x, w.y);
      eraseLast = w;
    }
  }

  function markErase(wx: number, wy: number) {
    const margin = 12 / board.camera.scale;
    let changed = false;
    for (const c of eraseCands) {
      if (eraseMarks.has(c.id)) continue;
      const m = margin + c.hw;
      if (
        wx < c.bb.x - m ||
        wx > c.bb.x + c.bb.width + m ||
        wy < c.bb.y - m ||
        wy > c.bb.y + c.bb.height + m
      )
        continue;
      if (hitsStroke(c.el, wx, wy, margin)) {
        eraseMarks.add(c.id);
        changed = true;
      }
    }
    if (changed) eraseMarks = new Set(eraseMarks);
  }

  function hitsStroke(el: SVGPathElement, wx: number, wy: number, r: number) {
    if (el.isPointInStroke(new DOMPoint(wx, wy))) return true;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (el.isPointInStroke(new DOMPoint(wx + Math.cos(a) * r, wy + Math.sin(a) * r)))
        return true;
    }
    return false;
  }

  function finishErase() {
    erasePointer = null;
    eraseLast = null;
    if (eraseMarks.size) board.commitErase(board.removeStrokes(eraseMarks));
    eraseMarks = new Set();
    eraseCands = [];
  }
  function cancelErase() {
    erasePointer = null;
    eraseLast = null;
    eraseMarks = new Set();
    eraseCands = [];
  }

  function focusNote(note: Note) {
    editPrevCamera = { ...board.camera };
    editingId = note.id;
    selectOne(note.id);
    const targetScale = clamp(
      Math.max(board.camera.scale, 1.3),
      MIN_SCALE,
      MAX_SCALE,
    );
    const cx = note.x + note.w / 2;
    const cy = note.y + note.h / 2;
    animateCamera({
      x: window.innerWidth / 2 - cx * targetScale,
      y: window.innerHeight * 0.44 - cy * targetScale,
      scale: targetScale,
    });
  }

  function discardEmptyText(id: string | null) {
    if (!id) return;
    const n = board.notes.find((x) => x.id === id);
    if (n && n.color === TEXT_COLOR && n.text.trim() === "") board.remove(id);
  }

  function commitEdit() {
    discardEmptyText(editingId);
    editingId = null;
    editPrevCamera = null;
  }

  function exitEdit() {
    if (editingId === null) return;
    discardEmptyText(editingId);
    const back = editPrevCamera;
    editingId = null;
    editPrevCamera = null;
    if (back) animateCamera(back);
  }

  function resetView() {
    commitEdit();
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const w = toWorld(cx, cy);
    animateCamera({ x: cx - w.x, y: cy - w.y, scale: 1 });
  }

  function zoomBy(factor: number) {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const w = toWorld(cx, cy);
    const ns = clamp(board.camera.scale * factor, MIN_SCALE, MAX_SCALE);
    animateCamera({ x: cx - w.x * ns, y: cy - w.y * ns, scale: ns });
  }

  function contentBBox(): { x: number; y: number; w: number; h: number } | null {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of board.notes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + n.w > maxX) maxX = n.x + n.w;
      if (n.y + n.h > maxY) maxY = n.y + n.h;
    }
    const layer = document.querySelector(".draw-layer");
    if (layer) {
      for (const el of layer.querySelectorAll<SVGPathElement>(
        "path[data-stroke-id]",
      )) {
        try {
          const b = el.getBBox();
          if (b.x < minX) minX = b.x;
          if (b.y < minY) minY = b.y;
          if (b.x + b.width > maxX) maxX = b.x + b.width;
          if (b.y + b.height > maxY) maxY = b.y + b.height;
        } catch {
        }
      }
    }
    if (minX === Infinity) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function fitBox(b: { x: number; y: number; w: number; h: number }) {
    const bw = Math.max(b.w, 1);
    const bh = Math.max(b.h, 1);
    const s = clamp(
      Math.min((window.innerWidth * 0.85) / bw, (window.innerHeight * 0.85) / bh),
      MIN_SCALE,
      MAX_SCALE,
    );
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    animateCamera({
      x: window.innerWidth / 2 - cx * s,
      y: window.innerHeight / 2 - cy * s,
      scale: s,
    });
  }

  function fitView() {
    commitEdit();
    const b = contentBBox();
    if (!b) return resetView();
    fitBox(b);
  }

  function fitSelection() {
    const sel = board.notes.filter((n) => selectedIds.has(n.id));
    if (!sel.length) return fitView();
    commitEdit();
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const n of sel) {
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + n.w);
      y1 = Math.max(y1, n.y + n.h);
    }
    fitBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }

  function jumpTo(world: { x: number; y: number }) {
    stopTween();
    const s = board.camera.scale;
    board.camera = {
      x: window.innerWidth / 2 - world.x * s,
      y: window.innerHeight / 2 - world.y * s,
      scale: s,
    };
  }

  function openSearch() {
    if (mode === "draw") exitDraw();
    commitEdit();
    menu = null;
    pasteMenu = null;
    searchOpen = true;
  }

  function flyToNote(id: string) {
    searchOpen = false;
    const n = board.notes.find((x) => x.id === id);
    if (!n) return;
    board.bringToFront(n);
    selectOne(n.id);
    const s = clamp(Math.max(board.camera.scale, 1), MIN_SCALE, MAX_SCALE);
    const cx = n.x + n.w / 2;
    const cy = n.y + n.h / 2;
    animateCamera({
      x: window.innerWidth / 2 - cx * s,
      y: window.innerHeight / 2 - cy * s,
      scale: s,
    });
  }

  function onWheel(e: WheelEvent) {
    if (spotlightId !== null) return;
    e.preventDefault();
    stopTween();
    menu = null;
    pasteMenu = null;
    if (e.ctrlKey || e.metaKey) {
      const ns = clamp(
        board.camera.scale * Math.exp(-e.deltaY * 0.01),
        MIN_SCALE,
        MAX_SCALE,
      );
      const w = toWorld(e.clientX, e.clientY);
      board.camera = {
        x: e.clientX - w.x * ns,
        y: e.clientY - w.y * ns,
        scale: ns,
      };
    } else {
      board.camera = {
        ...board.camera,
        x: board.camera.x - e.deltaX,
        y: board.camera.y - e.deltaY,
      };
    }
  }

  const randomColor =() => COLORS[Math.floor(Math.random() * COLORS.length)];

  const MAX_ASSET_BYTES =100 * 1024 * 1024;
  const MB = (n: number) => Math.round(n / (1024 * 1024));

  function acceptable(files: File[]): File[] {
    const tooBig = files.filter((f) => f.size > MAX_ASSET_BYTES);
    if (tooBig.length) {
      const list = tooBig.map((f) => `${f.name} (${MB(f.size)} MB)`).join(", ");
      showToast(`Too large to add — max ${MB(MAX_ASSET_BYTES)} MB: ${list}`);
    }
    return files.filter((f) => f.size <= MAX_ASSET_BYTES);
  }

  function extOf(file: File): string {
    const dot = file.name.lastIndexOf(".");
    if (dot > 0) return file.name.slice(dot + 1);
    return file.type.split("/")[1] ?? "bin";
  }

  async function storeAsset(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const path = await board.saveAsset(bytes, extOf(file));
    const name = (file.name || path.split("/").pop() || "file").replace(
      /[\[\]\n]/g,
      " ",
    );
    return assetKind(path) === "file" ? `[${name}](${path})` : `![${name}](${path})`;
  }

  function appendAssets(note: Note, md: string) {
    note.text = note.text ? `${note.text}\n${md}` : md;
  }

  async function addAssetNotes(input: File[]) {
    const files = acceptable(input);
    if (!files.length) return;
    const refs = await Promise.all(files.map(storeAsset));
    commitEdit();
    const c = viewCenterWorld();
    refs.forEach((md, i) =>
      board.add(randomColor(), c.x + i * 24, c.y + i * 24, md),
    );
  }

  async function clipboardImage(): Promise<Image | null> {
    try {
      return await readImage();
    } catch {
      return null;
    }
  }

  async function pasteHere() {
    const img = pasteImage;
    const at = pasteMenu;
    pasteMenu = null;
    pasteImage = null;
    if (!img || !at) return;
    const { width, height } = await img.size();
    const rgba = await img.rgba();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(rgba), width, height),
      0,
      0,
    );
    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob((b) => res(b), "image/png"),
    );
    if (!blob) return;
    const md = await storeAsset(
      new File([blob], "pasted.png", { type: "image/png" }),
    );
    board.add(randomColor(), at.wx, at.wy, md);
  }

  async function onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of items) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (!files.length) return;
    e.preventDefault();
    const ok = acceptable(files);
    if (!ok.length) return;
    const md = (await Promise.all(ok.map(storeAsset))).join("\n");
    const editing = editingId && board.notes.find((n) => n.id === editingId);
    if (editing) {
      appendAssets(editing, md);
    } else {
      const c = viewCenterWorld();
      board.add(randomColor(), c.x, c.y, md);
    }
  }

  function onDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }

  async function onDrop(e: DragEvent) {
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    if (!dropped.length) return;
    e.preventDefault();
    const files = acceptable(dropped);
    if (!files.length) return;
    const world = toWorld(e.clientX, e.clientY);
    const noteEl = (e.target as HTMLElement).closest(
      "[data-note]",
    ) as HTMLElement | null;
    const refs = await Promise.all(files.map(storeAsset));
    const onto = noteEl && board.notes.find((n) => n.id === noteEl.dataset.note);
    if (onto) {
      appendAssets(onto, refs.join("\n"));
      board.bringToFront(onto);
    } else {
      commitEdit();
      refs.forEach((md, i) =>
        board.add(randomColor(), world.x + i * 24, world.y + i * 24, md),
      );
    }
  }

  async function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    const noteEl = (e.target as HTMLElement).closest(
      "[data-note]",
    ) as HTMLElement | null;

    if (!noteEl) {
      menu = null;
      pasteMenu = null;
      const cx = e.clientX;
      const cy = e.clientY;
      const world = toWorld(cx, cy);
      const img = await clipboardImage();
      if (!img) return;
      pasteImage = img;
      pasteMenu = {
        x: Math.min(cx, window.innerWidth - 168),
        y: Math.min(cy, window.innerHeight - 54),
        wx: world.x,
        wy: world.y,
      };
      return;
    }

    pasteMenu = null;
    pasteImage = null;
    const id = noteEl.dataset.note!;
    const note = board.notes.find((n) => n.id === id);
    if (!note) return;
    board.bringToFront(note);
    const mw = 232;
    const mh = 104;
    menu = {
      x: Math.min(e.clientX, window.innerWidth - mw - 8),
      y: Math.min(e.clientY, window.innerHeight - mh - 8),
      id,
    };
  }

  function setColor(id: string, color: string) {
    const note = board.notes.find((n) => n.id === id);
    if (note) note.color = color;
    menu = null;
  }

  function deleteFromMenu(id: string) {
    if (editingId === id) editingId = null;
    board.remove(id);
    menu = null;
  }

  function onClickCapture(e: MouseEvent) {
    if (suppressClick) {
      e.stopPropagation();
      e.preventDefault();
      suppressClick = false;
    }
  }

  function onPointerDown(e: PointerEvent) {
    suppressClick = false;
    if (e.button === 1) {
      e.preventDefault();
      menu = null;
      pasteMenu = null;
      commitEdit();
      stopTween();
      panning = true;
      last = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    menu = null;
    pasteMenu = null;
    const target = e.target as HTMLElement;
    const noteEl = target.closest("[data-note]") as HTMLElement | null;

    if (target.closest("[data-interactive]")) return;

    if (mode === "draw") {
      if (target.closest("[data-ui]")) return;
      if (drawTool === "eraser") startErase(e);
      else startStroke(e);
      return;
    }

    if (focusedId) {
      if (noteEl?.dataset.note !== focusedId) unfocusMedia();
      return;
    }

    if (editingId) {
      if (noteEl?.dataset.note !== editingId) {
        exitEdit();
        clearSelection();
      }
      return;
    }

    if (spaceHeld) {
      commitEdit();
      stopTween();
      panning = true;
      last = { x: e.clientX, y: e.clientY };
      return;
    }

    if (noteEl) {
      const id = noteEl.dataset.note!;
      if (id === editingId) return;
      if (target.closest(".audio-ctl, .vid-ctl")) {
        const note = board.notes.find((n) => n.id === id);
        if (note) board.bringToFront(note);
        return;
      }
      if (id !== editingId) commitEdit();
      const note = board.notes.find((n) => n.id === id);
      if (!note) return;
      board.bringToFront(note);
      board.bringToFront(note);
      dragId = id;
      dragging = true;
      const grouped =
        selectedIds.has(id) &&
        (selectedIds.size > 1 || selectedStrokeIds.size > 0);
      dragNotes = grouped
        ? board.notes.filter((n) => selectedIds.has(n.id))
        : [note];
      dragStrokeIds = grouped ? [...selectedStrokeIds] : [];
      dragIsSingle = !grouped;
      pressId = id;
      pressTarget = target;
      pressMoved = false;
      movedDx = 0;
      movedDy = 0;
      pressStart = { x: e.clientX, y: e.clientY };
      last = { x: e.clientX, y: e.clientY };
    } else if (!target.closest("[data-ui]")) {
      commitEdit();
      stopTween();
      const w = toWorld(e.clientX, e.clientY);
      const bb = selBBox;
      if (bb && w.x >= bb.x0 && w.x <= bb.x1 && w.y >= bb.y0 && w.y <= bb.y1) {
        dragId = null;
        dragging = true;
        dragNotes = board.notes.filter((n) => selectedIds.has(n.id));
        dragStrokeIds = [...selectedStrokeIds];
        dragIsSingle = false;
        pressMoved = false;
        movedDx = 0;
        movedDy = 0;
        pressStart = { x: e.clientX, y: e.clientY };
        last = { x: e.clientX, y: e.clientY };
      } else {
        clearSelection();
        marquee = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
        last = { x: e.clientX, y: e.clientY };
      }
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (drawingPointer !== null) {
      if (e.buttons === 0) {
        finishStroke();
        return;
      }
      extendStroke(e);
      return;
    }
    if (erasePointer !== null) {
      if (e.buttons === 0) {
        finishErase();
        return;
      }
      extendErase(e);
      return;
    }
    if (
      (dragId ||
        panning ||
        marquee ||
        dragNotes.length ||
        dragStrokeIds.length) &&
      e.buttons === 0
    ) {
      endInteraction();
      return;
    }
    if (dragNotes.length || dragStrokeIds.length) {
      if (
        !pressMoved &&
        Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 4
      ) {
        pressMoved = true;
        if (dragIsSingle && dragId) selectOne(dragId);
        last = { x: e.clientX, y: e.clientY };
      }
      if (!pressMoved) return;
      const dx = (e.clientX - last.x) / board.camera.scale;
      const dy = (e.clientY - last.y) / board.camera.scale;
      for (const n of dragNotes) {
        n.x += dx;
        n.y += dy;
      }
      if (dragStrokeIds.length)
        board.translateStrokes(new Set(dragStrokeIds), dx, dy);
      movedDx += dx;
      movedDy += dy;
      last = { x: e.clientX, y: e.clientY };
      trashHot = overTrash(e.clientX, e.clientY);
    } else if (marquee) {
      marquee = { ...marquee, x1: e.clientX, y1: e.clientY };
      const a = toWorld(marquee.x0, marquee.y0);
      const b = toWorld(e.clientX, e.clientY);
      const rx0 = Math.min(a.x, b.x);
      const ry0 = Math.min(a.y, b.y);
      const rx1 = Math.max(a.x, b.x);
      const ry1 = Math.max(a.y, b.y);
      const hit = new Set<string>();
      for (const n of board.notes) {
        if (n.x < rx1 && n.x + n.w > rx0 && n.y < ry1 && n.y + n.h > ry0)
          hit.add(n.id);
      }
      selectedIds = hit;
      const hitStrokes = new Set<string>();
      for (const s of board.strokes) {
        const sb = pathBBox(s.d);
        if (sb.x < rx1 && sb.x + sb.w > rx0 && sb.y < ry1 && sb.y + sb.h > ry0)
          hitStrokes.add(s.id);
      }
      selectedStrokeIds = hitStrokes;
    } else if (panning) {
      board.camera = {
        ...board.camera,
        x: board.camera.x + (e.clientX - last.x),
        y: board.camera.y + (e.clientY - last.y),
      };
      last = { x: e.clientX, y: e.clientY };
    } else if (
      e.buttons === 0 &&
      drawingPointer === null &&
      erasePointer === null
    ) {
      const bb = selBBox;
      if (bb) {
        const w = toWorld(e.clientX, e.clientY);
        overSel = w.x >= bb.x0 && w.x <= bb.x1 && w.y >= bb.y0 && w.y <= bb.y1;
      } else if (overSel) {
        overSel = false;
      }
    }
  }

  function endInteraction() {
    dragId = null;
    dragging = false;
    dragNotes = [];
    dragStrokeIds = [];
    dragIsSingle = false;
    pressId = null;
    pressTarget = null;
    pressMoved = false;
    trashHot = false;
    panning = false;
    marquee = null;
  }

  function onPointerUp() {
    if (drawingPointer !== null) {
      finishStroke();
      return;
    }
    if (erasePointer !== null) {
      finishErase();
      return;
    }
    const dragging = dragNotes.length > 0 || dragStrokeIds.length > 0;
    if (dragging && pressMoved) suppressClick = true;
    if (dragging && trashHot) {
      if (dragNotes.length)
        board.deleteNotes(new Set(dragNotes.map((n) => n.id)));
      if (dragStrokeIds.length) {
        const removed = board.removeStrokes(new Set(dragStrokeIds));
        board.commitErase(removed);
      }
      selectedIds = new Set();
      selectedStrokeIds = new Set();
    } else if (dragging && pressMoved) {
      board.pushMove(
        dragNotes.map((n) => n.id),
        dragStrokeIds,
        movedDx,
        movedDy,
      );
    } else if (dragId && !pressMoved) {
      activate(dragId, pressTarget);
    }
    endInteraction();
  }

  function activate(id: string, target: HTMLElement | null) {
    const wasSelected = selectedIds.has(id) && selectedIds.size === 1;
    selectOne(id);
    if (!wasSelected) return;

    const note = board.notes.find((n) => n.id === id);
    if (!note) return;

    const chip = target?.closest(".note-file") as HTMLElement | null;
    if (chip?.dataset.asset) return openAsset(chip.dataset.asset);

    if (target?.closest(".link")) return;

    const media = target?.closest(
      ".note-img, .note-media, .note-audio",
    ) as HTMLElement | null;
    if (media) return focusMedia(note, media);

    if (isCardOnly(note.text)) return;

    board.bringToFront(note);
    focusNote(note);
  }

  function overTrash(cx: number, cy: number): boolean {
    if (!trashEl) return false;
    const r = trashEl.getBoundingClientRect();
    const pad = 22;
    return (
      cx >= r.left - pad &&
      cx <= r.right + pad &&
      cy >= r.top - pad &&
      cy <= r.bottom + pad
    );
  }

  function openAsset(raw: string) {
    const isUrl = /^[a-z][a-z0-9+.-]*:/i.test(raw);
    if (isUrl) {
      if (safeExternal(raw)) openUrl(raw).catch(() => {});
      return;
    }
    openPath(assetPath(raw)).catch(() => {});
  }

  function focusMedia(note: Note, el: HTMLElement) {
    prevCamera = { ...board.camera };
    board.bringToFront(note);
    selectOne(note.id);
    focusedId = note.id;

    let cx = note.x + note.w / 2;
    let cy = note.y + note.h / 2;
    let ww = note.w;
    let wh = note.h;
    const r = el.getBoundingClientRect();
    if (r.width && r.height) {
      const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
      cx = c.x;
      cy = c.y;
      ww = r.width / board.camera.scale;
      wh = r.height / board.camera.scale;
    }
    const bar = el.tagName === "VIDEO" ? 96 : 0;
    const margin = 0.84;
    const s = clamp(
      Math.min(
        (window.innerWidth * margin) / ww,
        (window.innerHeight * margin) / (wh + bar),
      ),
      MIN_SCALE,
      MAX_SCALE,
    );
    animateCamera({
      x: window.innerWidth / 2 - cx * s,
      y: window.innerHeight / 2 - (cy + bar / 2) * s,
      scale: s,
    });
  }

  function unfocusMedia() {
    if (!focusedId) return;
    document
      .querySelector(`[data-note="${focusedId}"]`)
      ?.querySelectorAll("video, audio")
      .forEach((m) => (m as HTMLMediaElement).pause());
    focusedId = null;
    if (prevCamera) animateCamera(prevCamera);
    prevCamera = null;
  }

  function onKeyDown(e: KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey;
    if (searchOpen) {
      if (meta && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        searchOpen = false;
      }
      return;
    }
    if (helpOpen) {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        helpOpen = false;
      }
      return;
    }
    if (e.key === "?" && editingId === null) {
      e.preventDefault();
      helpOpen = true;
      return;
    }
    if (meta && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      openSearch();
      return;
    }
    if (editingId === null && meta && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      if (e.shiftKey) board.redo();
      else board.undo();
      return;
    }
    if (editingId === null && meta && (e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      board.redo();
      return;
    }
    if (e.code === "Space" && editingId === null && !e.repeat) {
      spaceHeld = true;
    }
    if (editingId === null && e.shiftKey && e.code === "Digit1") {
      e.preventDefault();
      fitView();
      return;
    }
    if (editingId === null && e.shiftKey && e.code === "Digit2") {
      e.preventDefault();
      fitSelection();
      return;
    }
    if (
      (e.key === "Backspace" || e.key === "Delete") &&
      editingId === null &&
      focusedId === null &&
      mode === "normal" &&
      (selectedIds.size || selectedStrokeIds.size)
    ) {
      e.preventDefault();
      if (selectedIds.size) board.deleteNotes(selectedIds);
      if (selectedStrokeIds.size)
        board.commitErase(board.removeStrokes(selectedStrokeIds));
      selectedIds = new Set();
      selectedStrokeIds = new Set();
      return;
    }
    if (editingId === null && focusedId === null && !meta) {
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomBy(1.25);
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomBy(1 / 1.25);
        return;
      }
      if (!e.repeat && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        if (mode === "draw") exitDraw();
        else enterDraw();
        return;
      }
      if (!e.repeat && mode === "normal") {
        if (e.key === "t" || e.key === "T") {
          e.preventDefault();
          addTextNote();
          return;
        }
        if (e.key === "f" || e.key === "F") {
          e.preventDefault();
          attach?.open();
          return;
        }
        const swatch = !e.shiftKey && /^(?:Digit|Numpad)([1-6])$/.exec(e.code);
        if (swatch) {
          e.preventDefault();
          addNote(COLORS[Number(swatch[1]) - 1]);
          return;
        }
      }
    }
    if (mode === "draw") {
      if (e.key === "Escape") {
        if (erasePointer !== null || drawingPointer !== null) {
          cancelErase();
          cancelStroke();
        } else {
          exitDraw();
        }
        return;
      }
    }
    if (e.key === "Escape") {
      if (focusedId) {
        unfocusMedia();
        return;
      }
      if (pasteMenu) {
        pasteMenu = null;
        return;
      }
      exitEdit();
      menu = null;
      clearSelection();
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.code === "Space") spaceHeld = false;
  }

  onMount(() => {
    let unlisten: Array<() => void> = [];
    (async () => {
      await board.init();
      await links.init(board.unfurl);
      for (const n of board.notes) lastSig.set(n.id, JSON.stringify(n));

      unlisten.push(
        await listen<Note>("note-changed", (e) => {
          const inc = e.payload;
          if (inc.id === editingId || inc.id === dragId) return;
          const existing = board.notes.find((n) => n.id === inc.id);
          if (existing) {
            existing.x = inc.x;
            existing.y = inc.y;
            existing.w = inc.w;
            existing.h = inc.h;
            existing.color = inc.color;
            existing.text = inc.text;
            existing.z = inc.z;
            board.noteZTop(inc.z);
            lastSig.set(inc.id, JSON.stringify(existing));
          } else {
            board.notes.push(inc);
            board.noteZTop(inc.z);
            lastSig.set(inc.id, JSON.stringify(inc));
          }
        }),
      );

      unlisten.push(
        await listen<{ id: string }>("note-removed", (e) => {
          const id = e.payload.id;
          if (id === editingId) editingId = null;
          board.notes = board.notes.filter((n) => n.id !== id);
          lastSig.delete(id);
        }),
      );
    })();
    return () => unlisten.forEach((u) => u());
  });

  $effect(() => {
    const snap = board.notes.map(
      (n) => [n.id, JSON.stringify(n)] as [string, string],
    );
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      for (const [id, sig] of snap) {
        if (lastSig.get(id) !== sig) {
          lastSig.set(id, sig);
          board.writeNote(id);
        }
      }
      board.saveCamera();
    }, 300);
  });

  let gridCanvas =$state<HTMLCanvasElement | null>(null);
  let gridCtx: CanvasRenderingContext2D | null = null;
  let dotTile: HTMLCanvasElement | null = null;
  let dotPattern: CanvasPattern | null = null;
  let dpr = 1;

  function buildDotTile() {
    const size = Math.max(1, Math.round(GRID * dpr));
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d")!;
    const r = 1.4 * dpr;
    const cx = size / 2;
    const grad = g.createRadialGradient(cx, cx, 0, cx, cx, r + dpr);
    grad.addColorStop(0, "rgba(40, 38, 32, 0.13)");
    grad.addColorStop(r / (r + dpr), "rgba(40, 38, 32, 0.13)");
    grad.addColorStop(1, "rgba(40, 38, 32, 0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cx, r + dpr, 0, Math.PI * 2);
    g.fill();
    dotTile = c;
    dotPattern = null;
  }

  function resizeGrid() {
    if (!gridCanvas) return;
    dpr = window.devicePixelRatio || 1;
    gridCanvas.width = Math.round(window.innerWidth * dpr);
    gridCanvas.height = Math.round(window.innerHeight * dpr);
    gridCanvas.style.width = window.innerWidth + "px";
    gridCanvas.style.height = window.innerHeight + "px";
    gridCtx = gridCanvas.getContext("2d");
    buildDotTile();
    drawGrid();
  }

  function drawGrid() {
    const ctx = gridCtx;
    if (!ctx || !gridCanvas || !dotTile) return;
    if (!dotPattern) dotPattern = ctx.createPattern(dotTile, "repeat");
    if (!dotPattern) return;
    const w = gridCanvas.width;
    const h = gridCanvas.height;
    const s = board.camera.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(s, 0, 0, s, board.camera.x * dpr, board.camera.y * dpr);
    ctx.fillStyle = dotPattern;
    ctx.fillRect(
      (-board.camera.x * dpr) / s,
      (-board.camera.y * dpr) / s,
      w / s,
      h / s,
    );
  }

  $effect(() => {
    board.camera.x;
    board.camera.y;
    board.camera.scale;
    if (gridCanvas) drawGrid();
  });

  onMount(() => {
    resizeGrid();
    window.addEventListener("resize", resizeGrid);
    return () => window.removeEventListener("resize", resizeGrid);
  });

  const panStyle = $derived(
    `transform:translate(${board.camera.x}px,${board.camera.y}px);`,
  );
  const worldStyle = $derived(`transform:scale(${board.camera.scale});`);
  const zoomPct = $derived(Math.round(board.camera.scale * 100));
  const spotlightId =$derived(focusedId ?? editingId);
  const menuAssetOnly = $derived(
    !!menu &&
      isCardOnly(board.notes.find((n) => n.id === menu!.id)?.text ?? ""),
  );
</script>

<svelte:window
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={endInteraction}
  onclickcapture={onClickCapture}
  onkeydown={onKeyDown}
  onkeyup={onKeyUp}
  onblur={() => (spaceHeld = false)}
  onpaste={onPaste}
/>

<div class="titlebar" data-ui data-tauri-drag-region></div>

<main
  class="viewport"
  class:panning
  class:moving={dragging}
  class:grabsel={overSel && !dragging && !panning && !spaceHeld && mode === "normal"}
  class:space={spaceHeld && !panning}
  class:drawing={mode === "draw"}
  onwheel={onWheel}
  onpointerdown={onPointerDown}
  oncontextmenu={onContextMenu}
  ondragover={onDragOver}
  ondrop={onDrop}
>
  <canvas bind:this={gridCanvas} class="grid"></canvas>
  {#if spotlightId !== null}
    <div class="dim" transition:fade={{ duration: 300 }}></div>
  {/if}
  <div class="pan" style={panStyle}>
    <div class="world" style={worldStyle}>
      <DrawLayer
        live={liveStroke}
        liveColor={drawColor}
        liveWidth={drawWidth / board.camera.scale}
        marks={eraseMarks}
        selected={selectedStrokeIds}
      />
      {#each board.notes as note (note.id)}
        <Postit
          {note}
          editing={editingId === note.id}
          selected={selectedIds.has(note.id) && focusedId !== note.id}
          dragging={dragId === note.id}
          doomed={dragId === note.id && trashHot}
          dimmed={spotlightId !== null && spotlightId !== note.id}
          focused={focusedId === note.id}
        />
      {/each}
    </div>
  </div>

  {#if marquee}
    <div
      class="marquee"
      style="left:{Math.min(marquee.x0, marquee.x1)}px; top:{Math.min(
        marquee.y0,
        marquee.y1,
      )}px; width:{Math.abs(marquee.x1 - marquee.x0)}px; height:{Math.abs(
        marquee.y1 - marquee.y0,
      )}px"
    ></div>
  {/if}

  {#if board.notes.length === 0}
    <div class="hint" transition:fade={{ duration: 300 }}>
      <div class="hint-title">Toile</div>
      <div class="hint-sub">Pick a color below to drop your first note</div>
    </div>
  {/if}

  <Trash bind:el={trashEl} hot={trashHot} armed={dragging} />

  <div class="dock" class:concealed={focusedId !== null} data-ui>
    {#if mode === "draw"}
      <CircleButton title="Pen" active={drawTool === "pen"} onclick={() => (drawTool = "pen")}>
        <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      </CircleButton>
      <CircleButton title="Eraser" active={drawTool === "eraser"} onclick={() => (drawTool = "eraser")}>
        <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m7 21-4.3-4.3a1.7 1.7 0 0 1 0-2.4l9.6-9.6a1.7 1.7 0 0 1 2.4 0l5.3 5.3a1.7 1.7 0 0 1 0 2.4L13 21" />
          <path d="M22 21H8" />
          <path d="m5.5 11.5 6 6" />
        </svg>
      </CircleButton>
      {#if drawTool === "pen"}
        <DrawControls
          color={drawColor}
          width={drawWidth}
          oncolor={(c) => (drawColor = c)}
          onwidth={(w) => (drawWidth = w)}
        />
      {/if}
      <CircleButton title="Done" kbd="Esc" onclick={exitDraw}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </CircleButton>
    {:else if editingTextNote}
      <FontControls font={editingFont} onpick={setEditingFont} />
    {:else}
      <Palette colors={COLORS} onpick={addNote} />
      <CircleButton title="Add text" kbd="T" onclick={addTextNote}>
        <span class="tt">T</span>
      </CircleButton>
      <CircleButton title="Draw" kbd="D" onclick={enterDraw}>
        <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      </CircleButton>
      <AttachButton kbd="F" onfiles={addAssetNotes} bind:this={attach} />
    {/if}
  </div>

  <ZoomControls
    zoom={zoomPct}
    onZoomIn={() => zoomBy(1.25)}
    onZoomOut={() => zoomBy(1 / 1.25)}
    onReset={resetView}
    onFit={fitView}
    hidden={focusedId !== null}
  />

  <Minimap
    notes={board.notes}
    camera={board.camera}
    onJump={jumpTo}
    hidden={spotlightId !== null}
  />

  <UndoRedo
    canUndo={board.canUndo}
    canRedo={board.canRedo}
    onundo={() => board.undo()}
    onredo={() => board.redo()}
    shifted={dragging}
    hidden={focusedId !== null}
  />
</main>

{#if helpOpen}
  <Cheatsheet onclose={() => (helpOpen = false)} />
{/if}

{#if searchOpen}
  <SearchPalette notes={board.notes} onpick={flyToNote} onclose={() => (searchOpen = false)} />
{/if}

{#if menu}
  <ContextMenu
    x={menu.x}
    y={menu.y}
    colors={COLORS}
    showColors={!menuAssetOnly}
    oncolor={(c) => setColor(menu!.id, c)}
    ondelete={() => deleteFromMenu(menu!.id)}
    onclose={() => (menu = null)}
  />
{/if}

{#if pasteMenu}
  <PasteMenu
    x={pasteMenu.x}
    y={pasteMenu.y}
    onpaste={pasteHere}
    onclose={() => {
      pasteMenu = null;
      pasteImage = null;
    }}
  />
{/if}

{#if toast}
  <div class="toast liquid-glass" data-ui transition:fade={{ duration: 180 }}>
    {toast}
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    left: 50%;
    bottom: 32px;
    transform: translateX(-50%);
    z-index: 120;
    max-width: min(78vw, 560px);
    padding: 12px 18px;
    border-radius: 14px;
    font-size: 15px;
    font-weight: 600;
    color: var(--ink);
    text-align: center;
    box-shadow: 0 10px 30px rgba(40, 38, 32, 0.18);
  }

  .titlebar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 30px;
    z-index: 50;
  }

  .viewport {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background-color: var(--paper);
    cursor: default;
  }
  .grid {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
    pointer-events: none;
  }
  .viewport.panning,
  .viewport.moving {
    cursor: grabbing;
  }
  .viewport.space,
  .viewport.grabsel {
    cursor: grab;
  }
  .viewport.drawing {
    cursor: crosshair;
  }
  .marquee {
    position: absolute;
    z-index: 5;
    pointer-events: none;
    border: 1px solid var(--ink);
    background: rgba(67, 65, 59, 0.08);
    border-radius: 3px;
  }
  .tt {
    font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    font-size: 27px;
    font-weight: 600;
    line-height: 1;
  }
  .dim {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
  }
  .pan {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
    transform-origin: 0 0;
    will-change: transform;
  }
  .world {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
  }

  .hint {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    pointer-events: none;
    text-align: center;
  }
  .hint-title {
    font-size: 40px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: rgba(67, 65, 59, 0.32);
  }
  .hint-sub {
    font-size: 15px;
    font-weight: 500;
    color: rgba(67, 65, 59, 0.28);
  }

  .dock {
    position: fixed;
    left: 50%;
    bottom: 24px;
    z-index: 40;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    transition:
      opacity 0.3s var(--ease-soft),
      transform 0.3s var(--ease-soft);
  }
  .dock.concealed {
    opacity: 0;
    transform: translateX(-50%) translateY(16px);
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    * {
      animation: none !important;
      transition: none !important;
    }
  }
</style>
