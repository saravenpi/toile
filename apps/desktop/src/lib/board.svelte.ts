import { invoke } from "@tauri-apps/api/core";
import { translatePath } from "./draw";
import { youtubeId } from "./links";

export type Note = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  text: string;
  font?: FontKey;
  size?: number;
  z: number;
};

export type FontKey = "sans" | "serif" | "mono";

export const TEXT_SIZE = { min: 12, max: 80, default: 19 } as const;

export type Stroke = { id: string; color: string; width: number; d: string };

type UndoOp =
  | { kind: "strokeAdd"; strokes: Stroke[] }
  | { kind: "strokeErase"; strokes: Stroke[] }
  | { kind: "noteAdd"; notes: Note[] }
  | { kind: "noteDelete"; notes: Note[] }
  | {
      kind: "resize";
      id: string;
      fromW: number;
      toW: number;
      fromH: number;
      toH: number;
      fromX: number;
      toX: number;
      fromY: number;
      toY: number;
    }
  | {
      kind: "move";
      noteIds: string[];
      strokeIds: string[];
      dx: number;
      dy: number;
    };

export type Camera = { x: number; y: number; scale: number };

export const TEXT_COLOR = "transparent";

export const COLORS = [
  "#ffe8a3",
  "#ffc9c9",
  "#c9e8ca",
  "#bfe0f2",
  "#e2cdf2",
  "#ffd6b0",
];

export const NOTE_SIZE = 224;
export const TEXT_WIDTH = 260;
export const MEDIA_WIDTH = 380;

const ASSET_LIKE = /^\s*(?:!?\[[^\]]*\]\([^)]*\)|https?:\/\/\S+)\s*$/;
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 3;

const CAMERA_KEY = "toile.camera.v1";

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

class Board {
  notes = $state<Note[]>([]);
  strokes = $state<Stroke[]>([]);
  camera = $state<Camera>({ x: 0, y: 0, scale: 1 });
  folder = $state("");
  unfurl = $state(true);
  #zTop = 1;
  #undo = $state<UndoOp[]>([]);
  #redo = $state<UndoOp[]>([]);
  #strokeTimer: ReturnType<typeof setTimeout> | undefined;

  async init(): Promise<void> {
    if (typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem(CAMERA_KEY);
        if (raw) this.camera = JSON.parse(raw);
      } catch {
      }
    }
    try {
      const data = await invoke<{ folder: string; notes: Note[]; unfurl: boolean }>(
        "init_board",
      );
      this.folder = data.folder;
      this.unfurl = data.unfurl ?? true;
      this.notes = data.notes ?? [];
      this.#zTop = this.notes.reduce((m, n) => Math.max(m, n.z), 1);
    } catch (e) {
      console.error("init_board failed", e);
    }
    try {
      const parsed = JSON.parse(await invoke<string>("load_strokes"));
      if (Array.isArray(parsed?.strokes)) this.strokes = parsed.strokes;
    } catch {
    }
  }

  add(color: string, worldX: number, worldY: number, text = "", font?: FontKey): Note {
    const w =
      color === TEXT_COLOR
        ? TEXT_WIDTH
        : ASSET_LIKE.test(text)
          ? MEDIA_WIDTH
          : NOTE_SIZE;
    const h = youtubeId(text) ? Math.round((w * 9) / 16) : NOTE_SIZE;
    const note: Note = {
      id: uid(),
      x: worldX - w / 2,
      y: worldY - h / 2,
      w,
      h,
      color,
      text,
      font,
      z: ++this.#zTop,
    };
    this.notes.push(note);
    this.writeNote(note.id);
    this.#push({ kind: "noteAdd", notes: [note] });
    return note;
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }
  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  #push(op: UndoOp): void {
    this.#undo.push(op);
    this.#redo = [];
  }

  addStroke(d: string, color: string, width: number): void {
    if (!d) return;
    const s: Stroke = { id: uid(), color, width, d };
    this.strokes.push(s);
    this.#push({ kind: "strokeAdd", strokes: [s] });
    this.#saveStrokes();
  }

  translateStrokes(ids: Set<string>, dx: number, dy: number): void {
    if (!ids.size || (!dx && !dy)) return;
    this.strokes = this.strokes.map((s) =>
      ids.has(s.id) ? { ...s, d: translatePath(s.d, dx, dy) } : s,
    );
    this.#saveStrokes();
  }

  pushMove(noteIds: string[], strokeIds: string[], dx: number, dy: number): void {
    if ((!dx && !dy) || (!noteIds.length && !strokeIds.length)) return;
    this.#push({ kind: "move", noteIds, strokeIds, dx, dy });
  }

  pushResize(
    id: string,
    fromW: number,
    toW: number,
    fromH: number,
    toH: number,
    fromX: number,
    toX: number,
    fromY: number,
    toY: number,
  ): void {
    if (fromW === toW && fromH === toH && fromX === toX && fromY === toY) return;
    this.#push({
      kind: "resize",
      id,
      fromW,
      toW,
      fromH,
      toH,
      fromX,
      toX,
      fromY,
      toY,
    });
  }

  deleteNotes(ids: Set<string>): void {
    const notes = this.notes.filter((n) => ids.has(n.id));
    if (!notes.length) return;
    this.notes = this.notes.filter((n) => !ids.has(n.id));
    for (const id of ids) invoke("delete_note", { id }).catch(() => {});
    this.#push({ kind: "noteDelete", notes });
  }

  removeStrokes(ids: Set<string>): Stroke[] {
    if (!ids.size) return [];
    const removed = this.strokes.filter((s) => ids.has(s.id));
    if (removed.length) {
      this.strokes = this.strokes.filter((s) => !ids.has(s.id));
      this.#saveStrokes();
    }
    return removed;
  }

  commitErase(removed: Stroke[]): void {
    if (!removed.length) return;
    this.#push({ kind: "strokeErase", strokes: removed });
  }

  #addStrokes(strokes: Stroke[]): void {
    this.strokes.push(...strokes);
    this.#saveStrokes();
  }
  #dropStrokes(strokes: Stroke[]): void {
    const ids = new Set(strokes.map((s) => s.id));
    this.strokes = this.strokes.filter((s) => !ids.has(s.id));
    this.#saveStrokes();
  }
  #addNotes(notes: Note[]): void {
    this.notes.push(...notes);
    for (const n of notes) this.writeNote(n.id);
  }
  #dropNotes(notes: Note[]): void {
    const ids = new Set(notes.map((n) => n.id));
    this.notes = this.notes.filter((n) => !ids.has(n.id));
    for (const id of ids) invoke("delete_note", { id }).catch(() => {});
  }

  #applyOp(op: UndoOp, forward: boolean): void {
    switch (op.kind) {
      case "strokeAdd":
        forward ? this.#addStrokes(op.strokes) : this.#dropStrokes(op.strokes);
        break;
      case "strokeErase":
        forward ? this.#dropStrokes(op.strokes) : this.#addStrokes(op.strokes);
        break;
      case "noteAdd":
        forward ? this.#addNotes(op.notes) : this.#dropNotes(op.notes);
        break;
      case "noteDelete":
        forward ? this.#dropNotes(op.notes) : this.#addNotes(op.notes);
        break;
      case "resize": {
        const n = this.notes.find((x) => x.id === op.id);
        if (n) {
          n.w = forward ? op.toW : op.fromW;
          n.h = forward ? op.toH : op.fromH;
          n.x = forward ? op.toX : op.fromX;
          n.y = forward ? op.toY : op.fromY;
        }
        break;
      }
      case "move": {
        const sign = forward ? 1 : -1;
        const dx = op.dx * sign;
        const dy = op.dy * sign;
        const nids = new Set(op.noteIds);
        for (const n of this.notes)
          if (nids.has(n.id)) {
            n.x += dx;
            n.y += dy;
          }
        if (op.strokeIds.length)
          this.translateStrokes(new Set(op.strokeIds), dx, dy);
        break;
      }
    }
  }

  undo(): void {
    const op = this.#undo.pop();
    if (!op) return;
    this.#applyOp(op, false);
    this.#redo.push(op);
  }

  redo(): void {
    const op = this.#redo.pop();
    if (!op) return;
    this.#applyOp(op, true);
    this.#undo.push(op);
  }

  #saveStrokes(): void {
    clearTimeout(this.#strokeTimer);
    const snapshot = JSON.stringify({ strokes: this.strokes });
    this.#strokeTimer = setTimeout(() => {
      invoke("save_strokes", { data: snapshot }).catch(() => {});
    }, 400);
  }

  async saveAsset(bytes: Uint8Array, ext: string): Promise<string> {
    return invoke<string>("save_asset", { data: bytes, ext });
  }

  remove(id: string): void {
    this.notes = this.notes.filter((n) => n.id !== id);
    invoke("delete_note", { id }).catch(() => {});
  }

  bringToFront(note: Note): void {
    note.z = ++this.#zTop;
  }

  noteZTop(z: number): void {
    this.#zTop = Math.max(this.#zTop, z);
  }

  writeNote(id: string): void {
    const note = this.notes.find((n) => n.id === id);
    if (!note) return;
    invoke("write_note", { note: { ...note } }).catch(() => {});
  }

  saveCamera(): void {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(CAMERA_KEY, JSON.stringify(this.camera));
  }
}

export const board = new Board();
