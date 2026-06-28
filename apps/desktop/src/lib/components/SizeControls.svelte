<script lang="ts">
  import { TEXT_SIZE } from "../board.svelte";

  let {
    size = TEXT_SIZE.default,
    onpick,
  }: {
    size?: number;
    onpick: (s: number) => void;
  } = $props();
</script>

<div class="size-slider liquid-glass">
  <span class="cap small">A</span>
  <input
    type="range"
    min={TEXT_SIZE.min}
    max={TEXT_SIZE.max}
    step="1"
    value={size}
    aria-label="Text size"
    oninput={(e) => onpick(Math.round(+e.currentTarget.value))}
  />
  <span class="cap big">A</span>
</div>

<style>
  .size-slider {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 56px;
    padding: 0 16px;
    border-radius: 999px;
  }
  .cap {
    color: var(--ink-soft);
    font-family: "Goga", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-weight: 700;
    line-height: 1;
    user-select: none;
  }
  .cap.small {
    font-size: 13px;
  }
  .cap.big {
    font-size: 23px;
  }
  input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    width: 104px;
    height: 4px;
    border-radius: 999px;
    background: rgba(40, 38, 32, 0.16);
    cursor: pointer;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--ink);
    box-shadow: 0 1px 3px rgba(40, 38, 32, 0.28);
    transition: transform 0.16s var(--ease-soft);
  }
  input[type="range"]::-webkit-slider-thumb:hover {
    transform: scale(1.18);
  }
  input[type="range"]:active::-webkit-slider-thumb {
    transform: scale(1.18);
  }
</style>
