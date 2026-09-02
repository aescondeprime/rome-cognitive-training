/**
 * Analysis State — a document, centred, and a way to cut pieces out of it.
 *
 * Sources used to be corpora: text extracted, digested by a model, and never
 * looked at again. They are documents now, so the Forge shows them the way a
 * document viewer does — pages at their own aspect ratio, continuous scroll,
 * zoom, nothing between you and the page.
 *
 * **Everything renders through pdf.js**, including what arrived as .docx or
 * .pptx: those are converted to PDF once, at import. One rendering path is
 * what makes a capture exact — a crop of the same canvas the page was drawn
 * into, at the scale it was drawn at — where an HTML approximation of a slide
 * would have produced an annotation of something that is not quite the
 * document.
 *
 * Pages render lazily. A two-hundred-page PDF drawn in full on open would
 * freeze the renderer for several seconds, so an IntersectionObserver draws
 * only the pages near the viewport and everything else stays a correctly
 * shaped placeholder — which is also what stops the column jumping as you
 * scroll.
 *
 * A capture is a region plus, optionally, a sentence about it, and it goes
 * straight to a caseboard as a pin. The board is chosen before capturing
 * rather than after, because choosing is the slow part and the capture itself
 * should be select, type, send.
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  Crop, FileText, Loader2, Minus, Plus, Send, SquareDashed, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import type { AcademiaSource } from "@/lib/academiaStore";
import { suppressRay } from "@/lib/lightRayState";
import type { Board } from "@/components/BoardShell";

const CYAN = "hsl(190 72% 60%)";

/** Wider than this and a capture costs more to store than it is worth reading. */
const MAX_CAPTURE_WIDTH = 1400;
/** Above this a PNG is re-encoded as JPEG; text stays readable, rows stay small. */
const PNG_BUDGET_BYTES = 700_000;

interface Selection { page: number; x: number; y: number; w: number; h: number }

interface Props {
  source: AcademiaSource;
  onClose: () => void;
}

export default function AnalysisState({ source, onClose }: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "text" | "failed">("loading");
  const [scale, setScale] = useState(1.1);
  const [capturing, setCapturing] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pending, setPending] = useState<{ image: string; page: number; rect: Selection } | null>(null);
  const [annotation, setAnnotation] = useState("");
  const [sent, setSent] = useState(0);
  const [boardId, setBoardId] = useState<number | null>(() => storedBoard());
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const dragRef = useRef<{ page: number; x: number; y: number } | null>(null);

  const client = useQueryClient();
  const { data: boards = [] } = useQuery<Board[]>({
    queryKey: ["/boards", "component_board"],
    queryFn: () => apiRequest("GET", "/api/boards?type=component_board").then(r => r.json()),
  });

  // A board that has since been deleted must not stay selected, and one board
  // needs no choosing.
  useEffect(() => {
    if (!boards.length) return;
    if (boardId !== null && boards.some(board => board.id === boardId)) return;
    setBoardId(boards[0].id);
  }, [boards, boardId]);
  useEffect(() => { if (boardId !== null) rememberBoard(boardId); }, [boardId]);

  /**
   * The light ray is ambience for the constellation, and it is drawn over
   * everything at z-index 201. On a rendered page that means the source blob
   * sits as a bright smear on white paper — so it is asked to stay off for as
   * long as a document is open, and comes back on its own afterwards.
   */
  useEffect(() => suppressRay(), []);

  /* ── The document ────────────────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setDoc(null);
    setStatus(source.file ? "loading" : "text");
    if (!source.file) return;

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const data = new Uint8Array(await source.file!.arrayBuffer());
        const document = await pdfjs.getDocument({ data }).promise;
        if (cancelled) { void document.destroy(); return; }
        loaded = document;
        setDoc(document);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("failed");
      }
    })();

    return () => { cancelled = true; void loaded?.destroy(); };
  }, [source.id, source.file]);

  /* ── Selecting a region ──────────────────────────────────────────── */

  const onPageMouseDown = useCallback((page: number, event: React.MouseEvent<HTMLDivElement>) => {
    if (!capturing || pending) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    dragRef.current = { page, x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    setSelection({ page, x: dragRef.current.x, y: dragRef.current.y, w: 0, h: 0 });

    const move = (moveEvent: MouseEvent) => {
      const start = dragRef.current;
      if (!start) return;
      const x = moveEvent.clientX - bounds.left;
      const y = moveEvent.clientY - bounds.top;
      setSelection({
        page,
        x: Math.min(start.x, x), y: Math.min(start.y, y),
        w: Math.abs(x - start.x), h: Math.abs(y - start.y),
      });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      const start = dragRef.current;
      dragRef.current = null;
      if (!start) return;
      setSelection(current => {
        // A click rather than a drag is not a capture; anything under a few
        // pixels each way is a slip of the hand.
        if (!current || current.w < 12 || current.h < 12) return null;
        const canvas = canvasRefs.current.get(current.page);
        if (canvas) {
          const image = cropToDataUrl(canvas, current);
          if (image) { setPending({ image, page: current.page, rect: current }); setAnnotation(""); }
        }
        return current;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, [capturing, pending]);

  const discard = () => { setPending(null); setSelection(null); setAnnotation(""); };

  /**
   * Stable by construction, and that matters more than it looks.
   *
   * Selecting a region sets state on every mouse move. An inline callback here
   * would change identity on each of those renders, which is a dependency of
   * every page's render effect — so dragging a rectangle would re-render the
   * whole document underneath it.
   */
  const registerCanvas = useCallback((page: number, canvas: HTMLCanvasElement | null) => {
    if (canvas) canvasRefs.current.set(page, canvas);
    else canvasRefs.current.delete(page);
  }, []);

  const send = useMutation({
    mutationFn: async (text: string) => {
      if (!pending || boardId === null) return;
      await apiRequest("POST", `/api/boards/${boardId}/pins`, {
        content: text.trim(),
        pin_type: "capture",
        image: pending.image,
        source_label: `${source.name} · p${pending.page}`,
        // Staggered so several captures from one document do not land on top
        // of each other; the board is a canvas you arrange afterwards.
        pos_x: 60 + (sent % 5) * 34,
        pos_y: 60 + (sent % 5) * 34,
        width: 260,
        color: "capture",
      });
    },
    onSuccess: () => {
      setSent(value => value + 1);
      client.invalidateQueries({ queryKey: ["/boards", boardId, "pins"] });
      discard();
    },
  });

  const canCapture = status === "ready" && boardId !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-sm border border-[hsl(220_18%_14%)] bg-[hsl(222_18%_6%/.72)]">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[hsl(220_18%_13%)] px-3 py-2">
        <FileText size={13} color={CYAN} />
        <span className="max-w-56 truncate font-display text-xs tracking-wide text-foreground/80">{source.name}</span>
        {source.format && source.format !== "pdf" && source.format !== "text" &&
          <span className="rounded-sm border border-[hsl(190_35%_24%)] px-1.5 py-0.5 text-[7px] font-mono tracking-widest text-[hsl(190_55%_60%)]">
            {source.format.toUpperCase()} → PDF
          </span>}

        <div className="ml-auto flex items-center gap-2">
          {status === "ready" && <>
            <button onClick={() => setScale(value => Math.max(0.5, Number((value - 0.15).toFixed(2))))} title="Zoom out"
              className="text-muted-foreground/40 hover:text-foreground"><Minus size={13} /></button>
            <span className="w-10 text-center text-[8px] font-mono tabular-nums text-muted-foreground/45">{Math.round(scale * 100)}%</span>
            <button onClick={() => setScale(value => Math.min(3, Number((value + 0.15).toFixed(2))))} title="Zoom in"
              className="text-muted-foreground/40 hover:text-foreground"><Plus size={13} /></button>
          </>}

          <select
            value={boardId ?? ""}
            onChange={event => setBoardId(event.target.value ? Number(event.target.value) : null)}
            title="Where annotations go"
            className="max-w-40 rounded-sm border border-[hsl(220_18%_16%)] bg-[hsl(222_20%_4%)] px-2 py-1 text-[9px] text-muted-foreground outline-none focus:border-[hsl(190_45%_30%)]">
            {boards.length === 0 && <option value="">No caseboards</option>}
            {boards.map(board => <option key={board.id} value={board.id}>{board.title}</option>)}
          </select>

          <button
            onClick={() => { setCapturing(value => !value); discard(); }}
            disabled={!canCapture}
            title={canCapture ? "Drag a region of the page to annotate it" : "Needs a rendered document and a caseboard"}
            className={cn("flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[8px] font-mono tracking-[.16em] transition-colors disabled:opacity-25",
              capturing
                ? "border-[hsl(35_60%_45%)] bg-[hsl(35_45%_12%)] text-[hsl(35_85%_70%)]"
                : "border-[hsl(190_40%_24%)] text-[hsl(190_60%_64%)] hover:border-[hsl(190_55%_38%)]")}>
            {capturing ? <SquareDashed size={11} /> : <Crop size={11} />} {capturing ? "CAPTURING" : "CAPTURE"}
          </button>

          <button onClick={onClose} title="Close the document" className="text-muted-foreground/40 hover:text-foreground"><X size={14} /></button>
        </div>
      </div>

      {capturing && <p className="shrink-0 border-b border-[hsl(35_35%_18%)] bg-[hsl(35_30%_7%/.5)] px-3 py-1.5 text-[8px] font-mono tracking-[.16em] text-[hsl(35_70%_66%)]">
        DRAG A REGION · IT GOES TO {boards.find(board => board.id === boardId)?.title?.toUpperCase() ?? "—"}{sent > 0 ? ` · ${sent} SENT` : ""}
      </p>}

      {/* ── The document ────────────────────────────────────────────── */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-[hsl(222_22%_3%)] p-6">
        {status === "loading" && <div className="flex h-full items-center justify-center gap-2 text-[9px] font-mono tracking-widest text-[hsl(190_55%_55%)]">
          <Loader2 size={14} className="animate-spin" /> OPENING DOCUMENT
        </div>}

        {status === "failed" && <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <p className="text-[10px] text-rose-300/70">This document could not be rendered.</p>
          <p className="max-w-sm text-[8px] leading-4 text-muted-foreground/35">
            The file may be encrypted or damaged. Its extracted text is still available to Recall State through a note.
          </p>
        </div>}

        {status === "text" && <div className="mx-auto max-w-3xl whitespace-pre-wrap rounded-sm border border-[hsl(220_18%_14%)] bg-[hsl(222_20%_5%)] p-8 text-[12px] leading-7 text-foreground/70">
          {source.text || "This source has no text."}
        </div>}

        {status === "ready" && doc && <div className="flex flex-col items-center gap-5">
          {Array.from({ length: doc.numPages }, (_, index) => index + 1).map(page => (
            <PageView
              key={page}
              doc={doc}
              page={page}
              scale={scale}
              capturing={capturing}
              selection={selection?.page === page ? selection : null}
              pending={pending?.page === page ? pending.rect : null}
              onMouseDown={onPageMouseDown}
              registerCanvas={registerCanvas}
              annotationBox={pending?.page === page ? (
                <AnnotationBox
                  rect={pending.rect}
                  value={annotation}
                  onChange={setAnnotation}
                  busy={send.isPending}
                  onSend={() => send.mutate(annotation)}
                  onSkip={() => send.mutate("")}
                  onDiscard={discard}
                />
              ) : null}
            />
          ))}
        </div>}
      </div>
    </div>
  );
}

/* ── One page ────────────────────────────────────────────────────────── */

/**
 * A page, drawn only once it is worth drawing.
 *
 * The canvas is kept at device resolution and displayed at CSS size, so a
 * capture is cropped from the sharper bitmap rather than from what fits on
 * screen — which is the difference between an annotation you can read later
 * and a blurred rectangle.
 */
const PageView = memo(function PageView({
  doc, page, scale, capturing, selection, pending, onMouseDown, registerCanvas, annotationBox,
}: {
  doc: PDFDocumentProxy;
  page: number;
  scale: number;
  capturing: boolean;
  selection: Selection | null;
  pending: Selection | null;
  onMouseDown: (page: number, event: React.MouseEvent<HTMLDivElement>) => void;
  registerCanvas: (page: number, canvas: HTMLCanvasElement | null) => void;
  annotationBox: React.ReactNode;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  // Page size is cheap to ask for and is what stops the column from jumping as
  // pages render: the placeholder already has the right shape.
  useEffect(() => {
    let cancelled = false;
    void doc.getPage(page).then(loaded => {
      if (cancelled) return;
      const viewport = loaded.getViewport({ scale });
      setSize({ width: viewport.width, height: viewport.height });
    });
    return () => { cancelled = true; };
  }, [doc, page, scale]);

  useEffect(() => {
    const element = holderRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      entries => setVisible(entries.some(entry => entry.isIntersecting)),
      { rootMargin: "600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !size) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;

    void doc.getPage(page).then(loaded => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const viewport = loaded.getViewport({ scale: scale * ratio });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const render = loaded.render({ canvasContext: context, viewport, canvas });
      task = render;
      void render.promise.then(() => { if (!cancelled) registerCanvas(page, canvas); }, () => { /* superseded */ });
    });

    return () => { cancelled = true; task?.cancel(); };
  }, [doc, page, scale, visible, size, registerCanvas]);

  useEffect(() => () => registerCanvas(page, null), [page, registerCanvas]);

  const marker = pending ?? selection;

  return (
    <div
      ref={holderRef}
      className="relative shadow-[0_2px_24px_hsl(222_40%_2%/.8)]"
      style={{ width: size?.width ?? 620, height: size?.height ?? 800, background: "hsl(0 0% 100%)" }}
      onMouseDown={event => onMouseDown(page, event)}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", cursor: capturing ? "crosshair" : "default" }} />

      <span className="absolute -top-4 left-0 text-[8px] font-mono tracking-widest text-muted-foreground/30">{page}</span>

      {marker && marker.w > 2 && <div
        className="pointer-events-none absolute"
        style={{
          left: marker.x, top: marker.y, width: marker.w, height: marker.h,
          border: `1.5px solid ${pending ? "hsl(35 85% 60%)" : CYAN}`,
          background: pending ? "hsl(35 85% 60% / .12)" : "hsl(190 72% 60% / .12)",
        }} />}

      {annotationBox}
    </div>
  );
});

/* ── The annotation ──────────────────────────────────────────────────── */

/**
 * A sentence about what was just cut out, written where it was cut out.
 *
 * Skipping is a first-class action, not a cancel: a diagram often needs no
 * words, and forcing one would make capturing a page of figures tedious enough
 * to stop doing.
 */
function AnnotationBox({
  rect, value, onChange, busy, onSend, onSkip, onDiscard,
}: {
  rect: Selection;
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  onSend: () => void;
  onSkip: () => void;
  onDiscard: () => void;
}) {
  return (
    <div
      className="absolute z-20 w-64 rounded-sm border border-[hsl(35_50%_34%)] bg-[hsl(222_20%_6%)] p-2 shadow-2xl"
      style={{ left: Math.max(4, rect.x), top: rect.y + rect.h + 8 }}
      onMouseDown={event => event.stopPropagation()}
    >
      <textarea
        autoFocus
        value={value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); onDiscard(); }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onSend(); }
        }}
        rows={3}
        placeholder="What does this show?"
        className="w-full resize-none rounded-sm border border-[hsl(220_18%_16%)] bg-[hsl(222_20%_4%)] p-2 text-[10px] leading-5 text-foreground/80 outline-none focus:border-[hsl(35_50%_38%)] placeholder:text-muted-foreground/25"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button onClick={onDiscard} className="text-[8px] font-mono tracking-widest text-muted-foreground/40 hover:text-foreground">DISCARD</button>
        <button onClick={onSkip} disabled={busy} title="Send the capture with no annotation"
          className="ml-auto flex items-center gap-1 rounded-sm border border-[hsl(220_18%_20%)] px-2 py-1 text-[8px] font-mono tracking-widest text-muted-foreground/60 hover:text-foreground disabled:opacity-30">
          SKIP
        </button>
        <button onClick={onSend} disabled={busy}
          className="flex items-center gap-1 rounded-sm border border-[hsl(35_50%_38%)] bg-[hsl(35_35%_11%)] px-2.5 py-1 text-[8px] font-mono tracking-widest text-[hsl(35_85%_70%)] disabled:opacity-30">
          {busy ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />} SEND
        </button>
      </div>
    </div>
  );
}

/* ── Cropping ────────────────────────────────────────────────────────── */

/**
 * The selected region, as an image small enough to live in a row.
 *
 * The rectangle is in CSS pixels and the canvas is at device resolution, so it
 * is scaled by the ratio between them rather than assumed to match. PNG first,
 * because captures are usually text and diagrams; JPEG only when the PNG is
 * large enough that storing it would be the notable thing about the pin.
 */
function cropToDataUrl(canvas: HTMLCanvasElement, rect: Selection): string | null {
  const displayed = canvas.getBoundingClientRect();
  if (!displayed.width || !displayed.height) return null;
  const ratioX = canvas.width / displayed.width;
  const ratioY = canvas.height / displayed.height;

  const sourceWidth = Math.max(1, Math.round(rect.w * ratioX));
  const sourceHeight = Math.max(1, Math.round(rect.h * ratioY));
  const shrink = Math.min(1, MAX_CAPTURE_WIDTH / sourceWidth);

  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(sourceWidth * shrink));
  out.height = Math.max(1, Math.round(sourceHeight * shrink));
  const context = out.getContext("2d");
  if (!context) return null;
  context.drawImage(
    canvas,
    Math.round(rect.x * ratioX), Math.round(rect.y * ratioY), sourceWidth, sourceHeight,
    0, 0, out.width, out.height,
  );

  const png = out.toDataURL("image/png");
  return png.length > PNG_BUDGET_BYTES ? out.toDataURL("image/jpeg", 0.85) : png;
}

/* ── Which board captures go to ──────────────────────────────────────── */

const BOARD_KEY = "rome.academia.captureBoard";

function storedBoard(): number | null {
  try {
    const raw = window.localStorage.getItem(BOARD_KEY);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function rememberBoard(id: number): void {
  try { window.localStorage.setItem(BOARD_KEY, String(id)); } catch { /* private mode */ }
}
