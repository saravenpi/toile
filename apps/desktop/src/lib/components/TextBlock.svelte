<script lang="ts">
  import { scale } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import AssetTile from "./AssetTile.svelte";
  import LinkCard from "./LinkCard.svelte";
  import ResizeHandles from "./ResizeHandles.svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { isCardOnly } from "../assets";
  import { safeExternal } from "../links";
  import { renderMarkdown, toggleTask } from "../markdown";
  import { FONT_STACKS } from "../fonts";
  import { TEXT_SIZE, type Note } from "../board.svelte";
  import { parseSegments, lockedAspect } from "../segments";
  import { autoHeight } from "../autoheight";

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

  const cardOnly = $derived(isCardOnly(note.text));
  const fontFamily = $derived(FONT_STACKS[note.font ?? "sans"] ?? FONT_STACKS.sans);
  const fontSize = $derived(note.size ?? TEXT_SIZE.default);
  const segments = $derived(parseSegments(note.text));
  const mediaAspect = $derived(lockedAspect(note, segments));

  function onToggle(e: Event) {
    const box = e.target as HTMLElement;
    if (!(box instanceof HTMLInputElement) || box.type !== "checkbox") return;
    const boxes = [...(textEl?.querySelectorAll("input.md-task") ?? [])];
    const i = boxes.indexOf(box);
    if (i >= 0) note.text = toggleTask(note.text, i);
  }

  function onLinkClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest("a.md-link") as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    const href = a.getAttribute("href") ?? "";
    if (safeExternal(href)) openUrl(href).catch(() => {});
  }

  $effect(() => {
    if (editing && textarea) {
      textarea.focus();
      const len = textarea.value.length;
      textarea.setSelectionRange(len, len);
    }
  });
</script>

<div
  class="note text-note"
  class:asset-only={cardOnly && !editing}
  class:square={mediaAspect !== null && !editing}
  class:editing
  class:selected={selected && !editing}
  class:dragging
  class:doomed
  class:dimmed
  class:focused
  data-note={note.id}
  style="left:{note.x}px; top:{note.y}px; width:{note.w}px; height:{note.h}px; z-index:{note.z}; --family:{fontFamily}; --size:{fontSize}px; --maxw:{note.w}px"
  use:autoHeight={note}
  in:scale={{ duration: 280, start: 0.82, opacity: 0, easing: cubicOut }}
  out:scale={{ duration: 200, start: 0.78, opacity: 0, easing: cubicOut }}
>
  <div class="inner">
    {#if editing}
      <div class="grow">
        <div class="ghost" aria-hidden="true">{(note.text || "Write something…") + " "}</div>
        <textarea
          bind:this={textarea}
          bind:value={note.text}
          placeholder="Write something…"
          spellcheck="false"
        ></textarea>
      </div>
    {:else}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="text"
        class:empty={!note.text}
        bind:this={textEl}
        onchange={onToggle}
        onclick={onLinkClick}
      >
        {#if note.text}
          {#each segments as seg}
            {#if seg.kind === "image"}
              <img class="note-img" src={seg.src} alt={seg.alt} draggable="false" />
            {:else if seg.kind === "link"}
              <LinkCard url={seg.url} />
            {:else if seg.kind === "text"}{@html renderMarkdown(seg.value)}{:else}
              <AssetTile kind={seg.kind} raw={seg.raw} name={seg.name} {focused} />
            {/if}
          {/each}
        {:else}
          Write something…
        {/if}
      </div>
    {/if}

    <ResizeHandles
      {note}
      {selected}
      {editing}
      aspect={mediaAspect}
    />
  </div>
</div>

<style>
  .note {
    position: absolute;
    height: auto !important;
    border-radius: 14px;
  }
  .inner {
    position: relative;
    width: 100%;
    height: auto;
    border-radius: inherit;
    background: transparent;
    cursor: grab;
    overflow: visible;
    transition:
      transform 0.28s var(--ease-soft),
      filter 0.34s var(--ease-soft),
      opacity 0.34s var(--ease-soft);
  }
  .note.dragging .inner {
    cursor: grabbing;
    transform: translateY(-4px) rotate(-1.1deg);
  }
  .note.editing .inner {
    cursor: text;
  }
  .note.doomed .inner {
    transform: scale(0.82) rotate(-3deg);
    opacity: 0.55;
  }
  .note.dimmed {
    pointer-events: none;
  }
  .note.dimmed .inner {
    filter: blur(5px);
  }
  .note.focused .inner {
    filter: drop-shadow(0 22px 48px rgba(40, 38, 32, 0.34));
  }

  .text {
    position: relative;
    width: 100%;
    height: auto;
    padding: 14px 18px;
    border-radius: 14px;
  }
  .note.selected .text {
    outline: 2px solid var(--ink-soft);
    outline-offset: var(--sel-offset);
  }
  /* media-only transparent notes (a lone image/video/link) sit flush, like cards */
  .note.asset-only .text {
    padding: 0;
  }
  /* square selection ring for square media (image / video / youtube) */
  .note.square .text {
    border-radius: 0;
  }

  .grow {
    position: relative;
    width: 100%;
    padding: 14px 18px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.45);
    box-shadow: 0 10px 28px rgba(40, 38, 32, 0.14);
  }
  .grow .ghost,
  .grow > textarea {
    margin: 0;
    font-family: var(--family, inherit);
    font-size: var(--size, 19px);
    line-height: 1.45;
    font-weight: 500;
    color: var(--ink);
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: break-word;
  }
  .grow .ghost {
    padding: 0;
    min-height: 1.45em;
    visibility: hidden;
  }
  .grow > textarea {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 14px 18px;
    box-sizing: border-box;
    overflow: hidden;
    resize: none;
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
