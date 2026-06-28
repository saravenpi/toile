import { assetKind, resolveAssetSrc, type AssetKind } from "./assets";
import { isBareUrl, youtubeId } from "./links";

export type Segment =
  | { kind: "text"; value: string }
  | { kind: "link"; url: string }
  | { kind: "image"; src: string; alt: string }
  | { kind: Exclude<AssetKind, "image">; raw: string; name: string };

const fileName = (label: string, raw: string) =>
  label.trim() || (raw.split("/").pop() ?? raw);

function pushText(out: Segment[], chunk: string) {
  let buf: string[] = [];
  const flush = () => {
    if (buf.join("\n").trim()) out.push({ kind: "text", value: buf.join("\n") });
    buf = [];
  };
  for (const line of chunk.split(/\r?\n/)) {
    if (isBareUrl(line)) {
      flush();
      out.push({ kind: "link", url: line.trim() });
    } else {
      buf.push(line);
    }
  }
  flush();
}

// Resize behaviour for the sole media segment of a card-only note:
//   number  → fixed height/width ratio, locked on resize (image / video)
//   "free"  → 2D resize with independent width and height (YouTube: the video
//             covers the card, so any box shape is valid and the user can hug
//             non-16:9 content like centred square album art)
//   null    → width-driven, content-determined height (links, files, audio, text)
export function lockedAspect(
  note: { w: number; h: number },
  segs: Segment[],
): number | "free" | null {
  const s = segs[0];
  if (!s) return null;
  const ratio = () => (note.w > 0 ? note.h / note.w : 1);
  if (s.kind === "image" || s.kind === "video") return ratio();
  if (s.kind === "link" && youtubeId(s.url)) return "free";
  return null;
}

export function parseSegments(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) pushText(out, text.slice(last, m.index));
    const raw = m[3].trim();
    const name = fileName(m[2], raw);
    const kind = m[1] === "!" ? assetKind(raw) : "file";
    if (kind === "image") out.push({ kind, src: resolveAssetSrc(raw), alt: name });
    else out.push({ kind, raw, name });
    last = m.index + m[0].length;
  }
  if (last < text.length) pushText(out, text.slice(last));
  return out;
}
