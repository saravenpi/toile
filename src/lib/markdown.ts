import { marked } from "marked";

// One-time config. GFM so task lists work; `breaks` so a lone newline becomes a
// line break (notes are written line-by-line, like the old pre-wrap textarea);
// tables disabled — the tokenizer bails, so `| a | b |` just renders as text.
// Task checkboxes render live and interactive instead of marked's default
// disabled inputs, tagged so the board's pointer layer leaves their clicks alone.
marked.use({
  gfm: true,
  breaks: true,
  tokenizer: {
    table() {
      return undefined;
    },
  },
  renderer: {
    checkbox({ checked }) {
      return `<input type="checkbox" class="md-task" data-interactive${
        checked ? " checked" : ""
      } />`;
    },
  },
});

export function renderMarkdown(src: string): string {
  return marked.parse(src) as string;
}

const TASK_RE = /^([ \t]*[-*+] +)\[([ xX])\]/gm;

// Flip the Nth task checkbox in the raw markdown. Source order matches the DOM
// render order, so the index from the clicked checkbox lands on the right marker.
export function toggleTask(text: string, index: number): string {
  let i = -1;
  return text.replace(TASK_RE, (full, prefix: string, mark: string) => {
    i += 1;
    if (i !== index) return full;
    return `${prefix}[${mark.toLowerCase() === "x" ? " " : "x"}]`;
  });
}
