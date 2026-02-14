import React, { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Line, Rect, Circle, Transformer } from "react-konva";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;


// Minimal takeoff viewer:
// - renders a PDF page to a canvas
// - overlays a Konva stage for drawing
// - supports Pan + Line tool
export default function PdfKonvaViewer({
  pdfUrl,
  pageNumber,
  tool,
  unitSystem = "imperial",
  unitsPerPx = null,
  activeItemId = "unassigned",
  calibrateMode = false,
  strokes,
  selectedId = null,
  onSelect,
  onCommitStrokes,
  onPageInfo,
  onMeasure,
  onCalibrated,
  // PDF text search
  searchQuery = "",
  searchCmd = 0,
  searchDir = null,
  onSearchResults,
  onSearchMatchInfo,
}) {
  const containerRef = useRef(null);
  const pdfCanvasRef = useRef(null);
  const renderTaskRef = useRef(null);

  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageInfo, setPageInfo] = useState({ width: 0, height: 0, scale: 1 });
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });

  // PDF text search highlights for the current page
  const [searchHighlights, setSearchHighlights] = useState([]); // [{x,y,w,h}]
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const searchScanTokenRef = useRef(0);

  // Render quality: we keep zoom smooth by scaling the canvas immediately,
  // then re-render the PDF at higher resolution after zoom settles.
  const fitRef = useRef({ fitScale: 1, cssW: 0, cssH: 0 });
  const lastLoadKeyRef = useRef("");
  const userZoomedRef = useRef(false);
  const lastFitScaleRef = useRef(null);
  const [renderScale, setRenderScale] = useState(1);
  const zoomDebounceRef = useRef(null);


  const [isDragging, setIsDragging] = useState(false);
  const [spacePanActive, setSpacePanActive] = useState(false);

  const effectiveTool = (spacePanActive && tool !== "fit-page" && tool !== "fit-width") ? "pan" : tool;

  // Spacebar = temporary "Hand" tool (pan) like STACK.
  useEffect(() => {
    function isEditableTarget(t) {
      if (!t) return false;
      const tag = (t.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable;
    }

    function onKeyDown(e) {
      if (e.code === "Space" && !isEditableTarget(e.target)) {
        e.preventDefault();
        setSpacePanActive(true);
      }
    }
    function onKeyUp(e) {
      if (e.code === "Space") {
        e.preventDefault();
        setSpacePanActive(false);
      }
    }

    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);


  // Cursor hint
  useEffect(() => {
    if (!containerRef.current) return;
    let cur = "default";
    if (effectiveTool === "pan") cur = isDragging ? "grabbing" : "grab";
    else if (effectiveTool === "select") cur = "default";
    else cur = "crosshair";
    containerRef.current.style.cursor = cur;
  }, [effectiveTool, isDragging]);

  const [dragStart, setDragStart] = useState(null);
  const [draftLine, setDraftLine] = useState(null);
  const [draftPoly, setDraftPoly] = useState(null); // { points: [x,y,...] }
  const [measurePts, setMeasurePts] = useState(null); // { a:{x,y}, b:{x,y}|null }

  const [stageSize, setStageSize] = useState({ width: 100, height: 100 });

  // Track container size (for fit + centering)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setStageSize({ width: el.clientWidth || 100, height: el.clientHeight || 100 });
    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [calibPts, setCalibPts] = useState(null);
  const trRef = useRef(null);
  const shapeRefs = useRef({});

  // Load PDF doc
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const doc = await loadingTask.promise;
        if (!alive) return;
        setPdfDoc(doc);
        onPageInfo?.({ numPages: doc.numPages });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("PDF load error", e);
      }
    })();
    return () => {
      alive = false;
      try { renderTaskRef.current?.cancel?.(); } catch {}
    };
  }, [pdfUrl]);

  // Render page
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!pdfDoc) return;
      const page = await pdfDoc.getPage(pageNumber);
      if (!alive) return;

      // IMPORTANT: keep our "world" coordinates stable across resizes.
      // We treat PDF units at scale=1 as the world space. Zoom/pan is handled by `camera`.
      const baseVp = page.getViewport({ scale: 1 });
      const baseW = baseVp.width;
      const baseH = baseVp.height;

      const el = containerRef.current;
      const cssW = el?.clientWidth || stageSize.width || 800;
      const cssH = el?.clientHeight || stageSize.height || 600;
      const fitToScreen = (cssW / baseW); // FIT WIDTH default (STACK-style)
      // We intentionally do NOT clamp by height; vertical scroll/space is acceptable.

      fitRef.current = { baseW, baseH, fitToScreen };
      setPageInfo({ width: baseW, height: baseH, scale: 1 });
      const loadKey = `${pdfUrl}|${pageNumber}`;
      const isResizeOnly = lastLoadKeyRef.current === loadKey;

      // If this is a new doc/page, reset "user zoom" so we auto-fit again.
      if (!isResizeOnly) {
        userZoomedRef.current = false;
      }

      // FIT WIDTH default (STACK-style) — but do NOT keep re-fitting if the user has manually zoomed.
      // We also avoid scrollbars/resize loops by keeping the container overflow hidden (see JSX).
      const offX = 0;
      const offY = 0;

      setCamera((prev) => {
        const prevScale = prev?.scale ?? 1;
        const wasFit =
          lastFitScaleRef.current != null && Math.abs(prevScale - lastFitScaleRef.current) < 1e-6;

        // Fit on:
        //  - first load of a doc/page
        //  - resize IF user hasn't zoomed/panned
        //  - resize IF we were still at fit scale (so it stays fit-width)
        if (!isResizeOnly || !userZoomedRef.current || wasFit) {
          lastFitScaleRef.current = fitToScreen;
          // keep top-left anchored so the drawing doesn't drift
          setRenderScale(fitToScreen);
          return { x: offX, y: offY, scale: fitToScreen };
        }
        return prev;
      });

      lastLoadKeyRef.current = loadKey;

      onPageInfo?.({ width: baseW, height: baseH });
    })();
    return () => { alive = false; };
  }, [pdfDoc, pageNumber, pdfUrl, stageSize.width, stageSize.height]);

  // SEARCH: scan embedded text (fast path, no OCR)
  useEffect(() => {
    if (!pdfDoc) return;
    const q = (searchQuery || "").trim().toLowerCase();
    const token = ++searchScanTokenRef.current;

    // Clear when empty
    if (!q) {
      setSearchHighlights([]);
      setActiveMatchIdx(0);
      onSearchResults?.([]);
      onSearchMatchInfo?.({ pageNumber, index: 0, total: 0 });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // Scan all pages for counts (for jump dropdown)
        const results = [];
        const num = pdfDoc.numPages || 1;

        for (let p = 1; p <= num; p++) {
          if (cancelled || token !== searchScanTokenRef.current) return;
          const page = await pdfDoc.getPage(p);
          const tc = await page.getTextContent();
          const items = tc?.items || [];
          let count = 0;
          for (const it of items) {
            const s = String(it?.str || "").toLowerCase();
            if (s && s.includes(q)) count++;
          }
          if (count) results.push({ pageNumber: p, count });
        }

        if (cancelled || token !== searchScanTokenRef.current) return;
        onSearchResults?.(results);

        // Build highlights for CURRENT page
        const page = await pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        const items = tc?.items || [];

        const rects = [];
        for (const it of items) {
          const s = String(it?.str || "").toLowerCase();
          if (!s || !s.includes(q)) continue;

          // PDF space coords (origin bottom-left)
          const [a, b, c, d, e, f] = it.transform || [1,0,0,1,0,0];
          const x = e;
          const y = f;
          const w = it.width || 0;
          const h = Math.abs(d) || 10;

          // Convert to viewport (origin top-left)
          const vr = viewport.convertToViewportRectangle([x, y, x + w, y + h]);
          const vx = Math.min(vr[0], vr[2]);
          const vy = Math.min(vr[1], vr[3]);
          const vw = Math.abs(vr[2] - vr[0]);
          const vh = Math.abs(vr[3] - vr[1]);

          rects.push({ x: vx, y: vy - vh, w: vw, h: vh }); // small correction so box sits on text
        }

        setSearchHighlights(rects);
        setActiveMatchIdx(0);
        onSearchMatchInfo?.({ pageNumber, index: rects.length ? 1 : 0, total: rects.length });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("Search scan failed", e);
      }
    })();

    return () => { cancelled = true; };
  }, [pdfDoc, pageNumber, searchQuery]);

  // React to next/prev commands from parent
  useEffect(() => {
    if (!searchHighlights?.length) {
      onSearchMatchInfo?.({ pageNumber, index: 0, total: 0 });
      return;
    }
    if (!searchDir) {
      onSearchMatchInfo?.({ pageNumber, index: activeMatchIdx + 1, total: searchHighlights.length });
      return;
    }

    setActiveMatchIdx((prev) => {
      let next = prev;
      if (searchDir === "next") next = (prev + 1) % searchHighlights.length;
      if (searchDir === "prev") next = (prev - 1 + searchHighlights.length) % searchHighlights.length;
      onSearchMatchInfo?.({ pageNumber, index: next + 1, total: searchHighlights.length });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchCmd]);

  // Debounce expensive PDF re-rendering when zooming. We still zoom instantly via CSS transform,
  // but we re-render the PDF page at a higher resolution once zoom settles so text stays crisp.
  useEffect(() => {
    const z = Math.max(0.25, Math.min(8, camera.scale || 1));
    if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
    zoomDebounceRef.current = setTimeout(() => {
      setRenderScale(z);
    }, 160);
    return () => {
      if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
    };
  }, [camera.scale]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!pdfDoc) return;
      const page = await pdfDoc.getPage(pageNumber);
      if (!alive) return;

      // IMPORTANT: All takeoff points are stored in *base PDF units* (scale=1).
      // That means the PDF canvas element should keep a constant CSS size (baseW/baseH)
      // so drawings never "move" when the browser resizes or fullscreen toggles.
      const { baseW = 0, baseH = 0 } = fitRef.current || {};

      const dpr = Math.max(1, window.devicePixelRatio || 1);
      // Render more pixels when zooming in, but cap it so we don't melt the CPU.
      const pdfScale = Math.min(6, Math.max(1, renderScale || 1));
      const renderVp = page.getViewport({ scale: pdfScale });

      const canvas = pdfCanvasRef.current;
      if (!canvas) return;

      // We draw at (renderVp * dpr) internally, but keep CSS size at base PDF size.
      canvas.width = Math.max(1, Math.floor(renderVp.width * dpr));
      canvas.height = Math.max(1, Math.floor(renderVp.height * dpr));
      canvas.style.width = `${Math.max(1, baseW || (renderVp.width / pdfScale))}px`;
      canvas.style.height = `${Math.max(1, baseH || (renderVp.height / pdfScale))}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Reset transform so pdf.js paints correctly into a HiDPI canvas.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      renderTaskRef.current?.cancel?.();
      const renderTask = page.render({ canvasContext: ctx, viewport: renderVp });
      renderTaskRef.current = renderTask;
      try {
        await renderTask.promise;
      } catch (e) {
        if (!(e && (e.name === "RenderingCancelledException" || String(e).includes("RenderingCancelledException")))) {
          throw e;
        }
      }
    })();
    return () => {
      alive = false;
      try { renderTaskRef.current?.cancel?.(); } catch {}
    };
  }, [pdfDoc, pageNumber, pdfUrl, renderScale]);

  function screenToWorld(pt) {
    return {
      x: (pt.x - camera.x) / camera.scale,
      y: (pt.y - camera.y) / camera.scale,
    };
  }

  function onMouseDown(e) {
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;

    if (effectiveTool === "pan") {
      setIsDragging(true);
      setDragStart({ x: pos.x, y: pos.y, camX: camera.x, camY: camera.y });
      return;
    }

    if (effectiveTool === "count") {
      const w = screenToWorld(pos);
      const next = [
        ...(strokes || []),
        {
          id: String(Date.now()) + "-" + Math.random().toString(16).slice(2),
          type: "count",
          x: w.x,
          y: w.y,
          itemId: activeItemId || "unassigned",
        },
      ];
      onCommitStrokes?.(next);
      return;
    }

    if (effectiveTool === "select") {
      // clicking empty space clears selection
      if (e.target === stage) onSelect?.(null);
      return;
    }

    if (effectiveTool === "measure") {
      const w = screenToWorld(pos);
      if (!measurePts) {
        setMeasurePts({ a: w, b: null });
      } else if (measurePts && !measurePts.b) {
        const a = measurePts.a;
        const b = w;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distPx = Math.sqrt(dx * dx + dy * dy);
        if (typeof unitsPerPx === "number") {
          onMeasure?.({ type: "measure", length: distPx * unitsPerPx });
        } else {
          onMeasure?.({ type: "measure", length: distPx });
        }
        setMeasurePts(null);
      }
      return;
    }

    if (effectiveTool === "calibrate") {
      const w = screenToWorld(pos);
      if (!calibPts) {
        setCalibPts({ a: w, b: null });
      } else if (calibPts && !calibPts.b) {
        const b = w;
        const a = calibPts.a;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distPx = Math.sqrt(dx * dx + dy * dy);
        // Prompt for known distance
        const unitLabel = unitSystem === "imperial" ? "ft" : "m";
        const input = window.prompt(`Enter known distance (${unitLabel}). Example: 3 or 0.9144`, "");
        const num = Number(String(input || "").trim());
        if (Number.isFinite(num) && num > 0 && distPx > 0) {
          const nextUPP = num / distPx;
          onCalibrated?.(nextUPP);
        }
        setCalibPts(null);
      }
      return;
    }

    if (effectiveTool === "line") {
      const w = screenToWorld(pos);
      setDraftLine({ points: [w.x, w.y, w.x, w.y] });
      return;
    }

    if (effectiveTool === "area") {
      const w = screenToWorld(pos);
      if (!draftPoly) {
        setDraftPoly({ points: [w.x, w.y] });
      } else {
        setDraftPoly({ points: [...draftPoly.points, w.x, w.y] });
      }
      return;
    }
  }

  function onMouseMove(e) {
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;

    if (effectiveTool === "pan" && isDragging && dragStart) {
      const dx = pos.x - dragStart.x;
      const dy = pos.y - dragStart.y;
      setCamera({ ...camera, x: dragStart.camX + dx, y: dragStart.camY + dy });
      return;
    }

    if (tool === "line" && draftLine) {
      const w = screenToWorld(pos);
      let x2 = w.x;
      let y2 = w.y;
      // Shift snapping (0/45/90)
      if (e.evt && e.evt.shiftKey) {
        const x1 = draftLine.points[0];
        const y1 = draftLine.points[1];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const ang = Math.atan2(dy, dx);
        const step = Math.PI / 4; // 45 deg
        const snapAng = Math.round(ang / step) * step;
        const len = Math.sqrt(dx * dx + dy * dy);
        x2 = x1 + Math.cos(snapAng) * len;
        y2 = y1 + Math.sin(snapAng) * len;
      }
      setDraftLine({ points: [draftLine.points[0], draftLine.points[1], x2, y2] });
    }

    if (tool === "area" && draftPoly) {
      // show a preview segment from last point to cursor
      const w = screenToWorld(pos);
      const pts = draftPoly.points;
      if (pts.length >= 2) {
        setDraftPoly({ points: [...pts.slice(0, -2), pts[pts.length - 2], pts[pts.length - 1], w.x, w.y] });
      }
    }
  }

  function onMouseUp() {
    if (effectiveTool === "pan") {
      setIsDragging(false);
      setDragStart(null);
      return;
    }
    if (tool === "line" && draftLine) {
      const next = [
        ...(strokes || []),
        {
          id: String(Date.now()) + "-" + Math.random().toString(16).slice(2),
          type: "line",
          points: draftLine.points,
          itemId: activeItemId || "unassigned",
        },
      ];
      // report measurement
      if (typeof unitsPerPx === "number") {
        const [x1,y1,x2,y2] = draftLine.points;
        const dx = x2-x1; const dy = y2-y1;
        const pxLen = Math.sqrt(dx*dx+dy*dy);
        onMeasure?.({ type: "line", length: pxLen * unitsPerPx });
      }
      setDraftLine(null);
      onCommitStrokes?.(next);
    }
  }

  function onDblClick(e) {
    if (tool !== "area" || !draftPoly) return;
    const pts = draftPoly.points;
    if (pts.length < 6) {
      setDraftPoly(null);
      return;
    }
    // Remove trailing preview point if present (we keep last two as cursor preview)
    const cleanPts = pts;
    const next = [
      ...(strokes || []),
      {
        id: String(Date.now()) + "-" + Math.random().toString(16).slice(2),
        type: "area",
        points: cleanPts,
        itemId: activeItemId || "unassigned",
      },
    ];
    if (typeof unitsPerPx === "number") {
      // polygon area (shoelace) in px^2 -> units^2
      let areaPx2 = 0;
      for (let i = 0; i < cleanPts.length; i += 2) {
        const x1 = cleanPts[i];
        const y1 = cleanPts[i + 1];
        const j = (i + 2) % cleanPts.length;
        const x2 = cleanPts[j];
        const y2 = cleanPts[j + 1];
        areaPx2 += x1 * y2 - x2 * y1;
      }
      areaPx2 = Math.abs(areaPx2) / 2;
      onMeasure?.({ type: "area", area: areaPx2 * unitsPerPx * unitsPerPx });
    }
    setDraftPoly(null);
    onCommitStrokes?.(next);
  }

  function clampScale(s) {
    return Math.max(0.25, Math.min(8, s));
  }

  function onWheel(e) {
    userZoomedRef.current = true;
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;

    const scaleBy = 1.05;
    const oldScale = camera.scale;
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = clampScale(direction > 0 ? oldScale * scaleBy : oldScale / scaleBy);
    const worldPos = screenToWorld(pos);

    const newX = pos.x - worldPos.x * newScale;
    const newY = pos.y - worldPos.y * newScale;
    setCamera({ x: newX, y: newY, scale: newScale });
    setRenderScaleDebounced(newScale);
  }


  function applyZoom(newScale, anchorScreen) {
    const stage = stageRef.current;
    if (!stage) return;

    const rect = stage.container().getBoundingClientRect();
    const sx = anchorScreen?.x ?? rect.width / 2;
    const sy = anchorScreen?.y ?? rect.height / 2;

    const worldPos = screenToWorld(sx, sy, camera);
    const newScreen = worldToScreen(worldPos.x, worldPos.y, { ...camera, scale: newScale });

    // Keep the anchor point stable on screen
    const newX = camera.x + (sx - newScreen.x);
    const newY = camera.y + (sy - newScreen.y);

    userZoomedRef.current = true;
    setCamera({ x: newX, y: newY, scale: newScale });
    setRenderScaleDebounced(newScale);
    setRenderScaleDebounced(newScale);
  }

  function zoomIn() {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.container().getBoundingClientRect();
    applyZoom(clampScale(camera.scale * 1.15), { x: rect.width / 2, y: rect.height / 2 });
  }

  function zoomOut() {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.container().getBoundingClientRect();
    applyZoom(clampScale(camera.scale / 1.15), { x: rect.width / 2, y: rect.height / 2 });
  }

  function fitWidth() {
    // "Fit width" (STACK-style): scale so page width matches stage width, anchor top-left.
    const pageW = (cssW || 612) * (pageDpiScale || 1);
    const stageW = stageSize.width || 1;
    const fit = clampScale(stageW / pageW);

    userZoomedRef.current = false;
    lastFitScaleRef.current = fit;
    setCamera({ x: 0, y: 0, scale: fit });
    setRenderScale(fit);
  }

  // Fit helpers triggered from parent by setting tool to fit-page/fit-width.
  useEffect(() => {
    if (!pageInfo.width || !pageInfo.height) return;
    if (tool !== "fit-page" && tool !== "fit-width") return;
    const stageW = stageSize.width || 100;
    const stageH = stageSize.height || 100;
    if (effectiveTool === "fit-width") {
      const s = stageW / pageInfo.width;
      const offY = Math.max(0, Math.floor((stageH - pageInfo.height * s) / 2));
      setCamera({ x: 0, y: offY, scale: s });
    } else {
      const sx = stageW / pageInfo.width;
      const sy = stageH / pageInfo.height;
      const s = Math.min(sx, sy);
      const offX = Math.max(0, Math.floor((stageW - pageInfo.width * s) / 2));
      const offY = Math.max(0, Math.floor((stageH - pageInfo.height * s) / 2));
      setCamera({ x: offX, y: offY, scale: s });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, pageInfo.width, pageInfo.height, stageSize.width, stageSize.height]);

  
useEffect(() => {
  const tr = trRef.current;
  if (!tr) return;
  const node = selectedId ? shapeRefs.current[selectedId] : null;
  if (node) {
    tr.nodes([node]);
  } else {
    tr.nodes([]);
  }
  tr.getLayer()?.batchDraw();
}, [selectedId, strokes]);

return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}>
      <canvas
        ref={pdfCanvasRef}
        style={{
          position: "absolute",
          left: camera.x,
          top: camera.y,
          transform: `scale(${camera.scale})`,
          transformOrigin: "top left",
          boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
          borderRadius: 8,
        }}
      />

      <div
        className="pdf-zoom-controls"
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          zIndex: 5,
          display: "flex",
          gap: 8,
        }}
      >
        <button className="btn small secondary" type="button" onClick={zoomOut} title="Zoom out">−</button>
        <button className="btn small" type="button" onClick={zoomIn} title="Zoom in">+</button>
        <button className="btn small secondary" type="button" onClick={fitWidth} title="Fit width">Fit</button>
      </div>

      <Stage
        width={stageSize.width}
        height={stageSize.height}
        style={{ position: "absolute", left: 0, top: 0 }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onDblClick={onDblClick}
        onWheel={onWheel}
      >
        <Layer x={camera.x} y={camera.y} scaleX={camera.scale} scaleY={camera.scale}>
          {/* Optional page bounds */}
          {pageInfo.width > 0 && pageInfo.height > 0 ? (
            <Rect x={0} y={0} width={pageInfo.width} height={pageInfo.height} stroke="rgba(255,255,255,0.08)" />
          ) : null}

          {/* Search highlights (embedded PDF text only) */}
          {(searchHighlights || []).map((r, idx) => (
            <Rect
              key={`hl_${idx}`}
              x={r.x}
              y={r.y}
              width={Math.max(1, r.w)}
              height={Math.max(1, r.h)}
              fill={idx === activeMatchIdx ? "rgba(255, 214, 10, 0.35)" : "rgba(255, 214, 10, 0.18)"}
              stroke={idx === activeMatchIdx ? "rgba(255, 214, 10, 0.9)" : "rgba(255, 214, 10, 0.35)"}
              strokeWidth={idx === activeMatchIdx ? 1.5 : 1}
              listening={false}
            />
          ))}

          {/* Render committed shapes */}
          
{(strokes || []).map((s) => {
  if (s.type === "area") {
    return (
      <Line
        key={s.id}
        points={s.points || []}
        closed
        stroke={s.id === selectedId ? "#22C55E" : "#A78BFA"}
        draggable={effectiveTool === "select" && s.id === selectedId && !s.locked}
        fill={s.id === selectedId ? "rgba(34,197,94,0.12)" : "rgba(167,139,250,0.12)"}
        strokeWidth={2}
        lineJoin="round"
        onMouseDown={(e) => {
          if (effectiveTool !== "select") return;
          e.cancelBubble = true;
          onSelect?.(s.id);
        }}
        onClick={(e) => {
          if (effectiveTool !== "select") return;
          e.cancelBubble = true;
          onSelect?.(s.id);
        }}
        ref={(node) => { if (node) shapeRefs.current[s.id] = node; }}
        onDragEnd={(e) => {
          if (effectiveTool !== "select") return;
          if (s.locked) return;
          const node = e.target;
          const dx = node.x();
          const dy = node.y();
          node.position({ x: 0, y: 0 });
          const moved = (s.points || []).map((v, i) => v + (i % 2 === 0 ? dx : dy));
          onCommitStrokes?.((strokes || []).map((x) => (x.id === s.id ? { ...x, points: moved } : x)));
        }}
      />
    );
  }
  
  if (s.type === "line") {
    return (
      <Line
        key={s.id}
        points={s.points || []}
        stroke={s.id === selectedId ? "#22C55E" : "#F97316"}
        strokeWidth={4}
        lineCap="round"
        lineJoin="round"
        draggable={effectiveTool === "select" && s.id === selectedId && !s.locked}
        ref={(node) => { if (node) shapeRefs.current[s.id] = node; }}
        onMouseDown={(e) => {
          if (effectiveTool !== "select") return;
          e.cancelBubble = true;
          onSelect?.(s.id);
        }}
        onClick={(e) => {
          if (effectiveTool !== "select") return;
          e.cancelBubble = true;
          onSelect?.(s.id);
        }}
        onTap={(e) => {
          if (effectiveTool !== "select") return;
          e.cancelBubble = true;
          onSelect?.(s.id);
        }}
        onDragEnd={(e) => {
          if (effectiveTool !== "select") return;
          if (s.locked) return;
          const node = e.target;
          const dx = node.x();
          const dy = node.y();
          node.position({ x: 0, y: 0 });
          const moved = (s.points || []).map((v, i) => v + (i % 2 === 0 ? dx : dy));
          onCommitStrokes?.((strokes || []).map((x) => (x.id === s.id ? { ...x, points: moved } : x)));
        }}
      />
    );
  }
if (s.type === "count") {
    return (
      <Circle
        key={s.id}
        x={s.x}
        y={s.y}
        radius={6}
        draggable={effectiveTool === "select" && s.id === selectedId && !s.locked}
        fill={s.id === selectedId ? "#22C55E" : "#2563EB"}
        stroke={s.id === selectedId ? "#FFFFFF" : "#0B1220"}
        strokeWidth={2}
        ref={(node) => { if (node) shapeRefs.current[s.id] = node; }}
        onMouseDown={(e) => {
          if (effectiveTool !== "select") return;
          e.cancelBubble = true;
          onSelect?.(s.id);
        }}
        onClick={(e) => {
          if (effectiveTool !== "select") return;
          e.cancelBubble = true;
          onSelect?.(s.id);
        }}
        onDragEnd={(e) => {
          if (effectiveTool !== "select") return;
          if (s.locked) return;
          const node = e.target;
          const dx = node.x();
          const dy = node.y();
          node.position({ x: 0, y: 0 });
          onCommitStrokes?.((strokes || []).map((x) => (x.id === s.id ? { ...x, x: (x.x || 0) + dx, y: (x.y || 0) + dy } : x)));
        }}
      />
    );
  }
  // default line
  const pts = s.points || [];
  return (
    <Line
      key={s.id}
      points={pts}
      stroke={s.id === selectedId ? "#22C55E" : "#F97316"}
      strokeWidth={3}
      lineCap="round"
      lineJoin="round"
      ref={(node) => { if (node) shapeRefs.current[s.id] = node; }}
      onMouseDown={(evt) => {
        if (effectiveTool === "select") {
          evt.cancelBubble = true;
          onSelect?.(s.id);
        }
      }}
    />
  );
})}
<Transformer
  ref={trRef}
  rotateEnabled={false}
  enabledAnchors={[]}
  boundBoxFunc={(oldBox, newBox) => oldBox}
/>

          {draftLine ? (
            <Line
              points={draftLine.points}
              stroke="#F59E0B"
              strokeWidth={2}
              dash={[6, 6]}
              lineCap="round"
              lineJoin="round"
            />
          ) : null}

          {draftPoly ? (
            <Line
              points={draftPoly.points}
              closed={false}
              stroke="#A78BFA"
              strokeWidth={2}
              dash={[6, 6]}
              lineCap="round"
              lineJoin="round"
            />
          ) : null}

          {measurePts?.a ? (
            <>
              <Circle x={measurePts.a.x} y={measurePts.a.y} radius={5} fill="#F59E0B" />
            </>
          ) : null}
        </Layer>
      </Stage>
    </div>
  );
}