<script lang="ts">
  import { onMount } from "svelte";
  import { board } from "$lib/board.svelte";

  const GRID = 26;

  let gridCanvas = $state<HTMLCanvasElement | null>(null);
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
</script>

<canvas bind:this={gridCanvas} class="grid"></canvas>

<style>
  .grid {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
    pointer-events: none;
  }
</style>
