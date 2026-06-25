<script lang="ts">
  import { scale } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import AssetTile from "./AssetTile.svelte";
  import {
    assetKind,
    isAssetOnly,
    resolveAssetSrc,
    type AssetKind,
  } from "../assets";
  import { renderMarkdown, toggleTask } from "../markdown";
  import type { Note } from "../board.svelte";

  let {
    note,
    editing = false,
    selected = false,
    dragging = false,
    doomed = false,
    dimmed = false,
    focused = false,
  }: {
    note: Note;
    editing?: boolean;
    selected?: boolean;
    dragging?: boolean;
    doomed?: boolean;
    dimmed?: boolean;
    focused?: boolean;
  } = $props();

  let textarea = $state<HTMLTextAreaElement | null>(null);
  let textEl = $state<HTMLDivElement | null>(null);

  // A checkbox toggle in the rendered markdown flips the matching `[ ]`/`[x]` in
  // the raw note text. The clicked box's position among all checkboxes maps 1:1
  // to the task markers in source order; mutating note.text auto-persists.
  function onToggle(e: Event) {
    const box = e.target as HTMLElement;
    if (!(box instanceof HTMLInputElement) || box.type !== "checkbox") return;
    const boxes = [...(textEl?.querySelectorAll("input.md-task") ?? [])];
    const i = boxes.indexOf(box);
    if (i >= 0) note.text = toggleTask(note.text, i);
  }

  // Split the body into text + asset segments. `![alt](path)` embeds carry media
  // (image inline, video/audio via AssetTile); `[name](path)` links render as a
  // click-to-open file tile. Everything else stays plain text, so a note still
  // reads as a sticky — it just pins whatever you dropped on it.
  type Segment =
    | { kind: "text"; value: string }
    | { kind: "image"; src: string; alt: string }
    | { kind: Exclude<AssetKind, "image">; raw: string; name: string };

  // A note that is nothing but asset refs sheds the colored card and renders as
  // its own asset component. Notes with prose keep the sticky card.
  const assetOnly = $derived(isAssetOnly(note.text));

  const fileName = (label: string, raw: string) =>
    label.trim() || (raw.split("/").pop() ?? raw);

  const segments = $derived.by<Segment[]>(() => {
    const out: Segment[] = [];
    const re = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(note.text))) {
      if (m.index > last)
        out.push({ kind: "text", value: note.text.slice(last, m.index) });
      const raw = m[3].trim();
      const name = fileName(m[2], raw);
      const kind = m[1] === "!" ? assetKind(raw) : "file";
      if (kind === "image")
        out.push({ kind, src: resolveAssetSrc(raw), alt: name });
      else out.push({ kind, raw, name });
      last = m.index + m[0].length;
    }
    if (last < note.text.length)
      out.push({ kind: "text", value: note.text.slice(last) });
    return out;
  });

  $effect(() => {
    if (editing && textarea) {
      textarea.focus();
      const len = textarea.value.length;
      textarea.setSelectionRange(len, len);
    }
  });
</script>

<div
  class="note"
  class:editing
  class:selected={selected && !editing}
  class:dragging
  class:doomed
  class:dimmed
  class:focused
  class:asset-only={assetOnly && !editing}
  data-note={note.id}
  style="left:{note.x}px; top:{note.y}px; width:{note.w}px; height:{note.h}px; z-index:{note.z}; --bg:{note.color}"
  in:scale={{ duration: 280, start: 0.82, opacity: 0, easing: cubicOut }}
  out:scale={{ duration: 200, start: 0.78, opacity: 0, easing: cubicOut }}
>
  <div class="inner">
    {#if editing}
      <textarea
        bind:this={textarea}
        bind:value={note.text}
        placeholder="Write something…"
        spellcheck="false"
      ></textarea>
    {:else}
      <div
        class="text"
        class:empty={!note.text}
        bind:this={textEl}
        onchange={onToggle}
      >
        {#if note.text}
          {#each segments as seg}
            {#if seg.kind === "image"}
              <img class="note-img" src={seg.src} alt={seg.alt} draggable="false" />
            {:else if seg.kind === "text"}{@html renderMarkdown(seg.value)}{:else}
              <AssetTile kind={seg.kind} raw={seg.raw} name={seg.name} {focused} />
            {/if}
          {/each}
        {:else}
          Write something…
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .note {
    position: absolute;
    border-radius: 14px;
  }

  .inner {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    background: var(--bg);
    padding: 18px;
    box-shadow:
      0 1px 2px rgba(40, 38, 32, 0.08),
      0 8px 18px rgba(40, 38, 32, 0.1);
    transition:
      transform 0.28s var(--ease-soft),
      box-shadow 0.28s var(--ease-soft),
      filter 0.34s var(--ease-soft),
      opacity 0.34s var(--ease-soft);
    cursor: grab;
    overflow: hidden;
  }

  .note:hover .inner {
    transform: translateY(-3px);
    box-shadow:
      0 2px 4px rgba(40, 38, 32, 0.1),
      0 14px 30px rgba(40, 38, 32, 0.16);
  }

  .note.dragging .inner {
    cursor: grabbing;
    transform: translateY(-4px) scale(1.02) rotate(-1.2deg);
    box-shadow:
      0 4px 8px rgba(40, 38, 32, 0.14),
      0 26px 50px rgba(40, 38, 32, 0.24);
  }

  .note.editing .inner {
    transform: scale(1.015);
    cursor: text;
    box-shadow:
      0 3px 6px rgba(40, 38, 32, 0.12),
      0 22px 46px rgba(40, 38, 32, 0.2);
  }

  .note.doomed .inner {
    transform: scale(0.82) rotate(-3deg);
    opacity: 0.55;
  }

  /* a media note is "focused" the way a postit enters edit mode: the camera
     zooms to it while every other note recedes — blurred and dimmed — so the
     focused element reads as lifted out of the board without leaving it. */
  .note.dimmed {
    pointer-events: none;
  }
  .note.dimmed .inner {
    filter: blur(5px);
  }
  .note.focused .inner {
    filter: drop-shadow(0 22px 48px rgba(40, 38, 32, 0.34));
  }


  .text,
  textarea {
    width: 100%;
    height: 100%;
    font-family: inherit;
    font-size: 19px;
    line-height: 1.45;
    font-weight: 500;
    color: var(--ink);
    word-break: break-word;
    overflow-wrap: break-word;
  }

  textarea {
    white-space: pre-wrap;
  }

  .text.empty {
    color: rgba(67, 65, 59, 0.38);
  }

  /* rendered markdown — scoped to .text so the {@html} output stays tidy */
  .text :global(p),
  .text :global(ul),
  .text :global(ol),
  .text :global(pre),
  .text :global(blockquote) {
    margin: 0 0 0.5em;
  }
  .text :global(*:last-child) {
    margin-bottom: 0;
  }
  .text :global(h1),
  .text :global(h2),
  .text :global(h3),
  .text :global(h4) {
    margin: 0.3em 0 0.35em;
    line-height: 1.2;
    font-weight: 700;
  }
  .text :global(h1) {
    font-size: 1.4em;
  }
  .text :global(h2) {
    font-size: 1.2em;
  }
  .text :global(h3),
  .text :global(h4) {
    font-size: 1.05em;
  }
  .text :global(strong) {
    font-weight: 700;
  }
  .text :global(em) {
    font-style: italic;
  }
  .text :global(del) {
    opacity: 0.6;
  }
  .text :global(ul),
  .text :global(ol) {
    padding-left: 1.3em;
  }
  .text :global(li) {
    margin: 0.12em 0;
  }
  .text :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.86em;
    background: rgba(40, 38, 32, 0.08);
    padding: 0.08em 0.34em;
    border-radius: 5px;
  }
  .text :global(pre) {
    background: rgba(40, 38, 32, 0.08);
    padding: 10px 12px;
    border-radius: 10px;
    overflow-x: auto;
  }
  .text :global(pre code) {
    background: none;
    padding: 0;
  }
  .text :global(blockquote) {
    padding-left: 0.8em;
    border-left: 3px solid rgba(40, 38, 32, 0.22);
    color: var(--ink-soft);
  }
  .text :global(a) {
    color: inherit;
    text-decoration: underline;
  }
  .text :global(hr) {
    border: none;
    border-top: 1px solid rgba(40, 38, 32, 0.18);
    margin: 0.6em 0;
  }

  /* task lists: drop the bullet, sit the live checkbox beside its line */
  .text :global(li:has(.md-task)) {
    list-style: none;
    display: flex;
    align-items: flex-start;
    gap: 0.5em;
    margin-left: -1.05em;
  }
  .text :global(.md-task) {
    flex: 0 0 auto;
    margin: 0.26em 0 0;
    width: 0.95em;
    height: 0.95em;
    cursor: pointer;
    accent-color: var(--ink);
  }
  .text :global(li:has(.md-task:checked)) {
    color: var(--ink-soft);
    text-decoration: line-through;
  }

  .note-img {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 6px 0;
    border-radius: 8px;
    user-select: none;
    -webkit-user-drag: none;
  }

  /* asset-only note: no card, the asset renders as its own component */
  .note.asset-only {
    height: auto !important;
  }
  .note.asset-only .inner {
    height: auto;
    padding: 0;
    background: transparent;
    box-shadow: none;
    overflow: visible;
  }
  .note.asset-only:hover .inner,
  .note.asset-only.selected:hover .inner {
    box-shadow: none;
    transform: none;
  }
  .note.asset-only .note-img {
    width: 100%;
    margin: 0;
    border-radius: 14px;
  }
  .note.asset-only .note-img + .note-img {
    margin-top: 6px;
  }

  textarea {
    border: none;
    outline: none;
    resize: none;
    background: transparent;
    user-select: text;
    -webkit-user-select: text;
  }

  textarea::placeholder {
    color: rgba(67, 65, 59, 0.38);
  }
</style>
