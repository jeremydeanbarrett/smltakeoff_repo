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
}) {
  const containerRef = useRef(null);
  const pdfCanvasRef = useRef(null);
  const renderTaskRef = useRef(null);

  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageInfo, setPageInfo] = useState({ width: 0, height: 0, scale: 1 });
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });

  // Render quality: we keep zoom smooth by scaling the canvas immediately,
  // then re-render the PDF at higher resolution after zoom settles.
  const fitRef = useRef({ fitScale: 1, cssW: 0, cssH: 0 });
  const lastLoadKeyRef = useRef("");
  const [renderScale, setRenderScale] = useState(1);
  const zoomDebounceRef = useRef(null);


  const [isDragging, setIsDragging] = useState(false);
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
      const fitToScreen = Math.min(cssW / baseW, cssH / baseH);

      fitRef.current = { baseW, baseH, fitToScreen };
      setPageInfo({ width: baseW, height: baseH, scale: 1 });

      const loadKey = `${pdfUrl}|${pageNumber}`;
      const isResizeOnly = lastLoadKeyRef.current === loadKey;

      // Fit + center the page in the available stage area.
      const stageW = stageSize.width || cssW || 100;
      const stageH = stageSize.height || cssH || 100;
      const offX = Math.max(0, Math.floor((stageW - baseW * fitToScreen) / 2));
      const offY = Math.max(0, Math.floor((stageH - baseH * fitToScreen) / 2));
      if (!isResizeOnly) {
        setCamera({ x: offX, y: offY, scale: fitToScreen });
        setRenderScale(fitToScreen);
        lastLoadKeyRef.current = loadKey;
      }

      onPageInfo?.({ width: baseW, height: baseH });
    })();
    return () => { alive = false; };
  }, [pdfDoc, pageNumber, pdfUrl, stageSize.width, stageSize.height]);

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

    if (tool === "pan") {
      setIsDragging(true);
      setDragStart({ x: pos.x, y: pos.y, camX: camera.x, camY: camera.y });
      return;
    }

    if (tool === "count") {
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

    if (tool === "select") {
      // clicking empty space clears selection
      if (e.target === stage) onSelect?.(null);
      return;
    }

    if (tool === "measure") {
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

    if (tool === "calibrate") {
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

    if (tool === "line") {
      const w = screenToWorld(pos);
      setDraftLine({ points: [w.x, w.y, w.x, w.y] });
      return;
    }

    if (tool === "area") {
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

    if (tool === "pan" && isDragging && dragStart) {
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
    if (tool === "pan") {
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

  function onWheel(e) {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;

    const scaleBy = 1.05;
    const oldScale = camera.scale;
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const worldPos = screenToWorld(pos);

    const newX = pos.x - worldPos.x * newScale;
    const newY = pos.y - worldPos.y * newScale;
    setCamera({ x: newX, y: newY, scale: newScale });
  }

  // Fit helpers triggered from parent by setting tool to fit-page/fit-width.
  useEffect(() => {
    if (!pageInfo.width || !pageInfo.height) return;
    if (tool !== "fit-page" && tool !== "fit-width") return;
    const stageW = stageSize.width || 100;
    const stageH = stageSize.height || 100;
    if (tool === "fit-width") {
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

          {/* Render committed shapes */}
          
{(strokes || []).map((s) => {
  if (s.type === "area") {
    return (
      <Line
        key={s.id}
        points={s.points || []}
        closed
        stroke={s.id === selectedId ? "#22C55E" : "#A78BFA"}
        draggable={tool === "select" && s.id === selectedId}
        fill={s.id === selectedId ? "rgba(34,197,94,0.12)" : "rgba(167,139,250,0.12)"}
        strokeWidth={2}
        lineJoin="round"
        onMouseDown={(e) => {
          if (tool !== "select") return;
          e.cancelBubble = true;
          onSelect?.(s.id);
        }}
        onClick={(e) => {
          if (tool !== "select") return;
          e.cancelBubble = true;
          onSelect?.(s.id);
        }}
        ref={(node) => { if (node) shapeRefs.current[s.id] = node; }}
        onDragEnd={(e) => {
          if (tool !== "select") return;
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
        draggable={tool === "select" && s.id === selectedId}
        ref={(node) => { if (node) shapeRefs.current[s.id] = node; }}
        onMouseDown={(e) => {
          if (tool !== "select") return;
          e.cancelBubble = true;
          onSelect?.(s.id);
        }}
        onClick={(e) => {
          if (tool !== "select") return;
          e.cancelBubble = true;
          onSelect?.(s.id);
        }}
        onTap={(e) => {
          if (tool !== "select") return;
          e.cancelBubble = true;
          onSelect?.(s.id);
        }}
        onDragEnd={(e) => {
          if (tool !== "select") return;
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
        draggable={tool === "select" && s.id === selectedId}
        fill={s.id === selectedId ? "#22C55E" : "#2563EB"}
        stroke={s.id === selectedId ? "#FFFFFF" : "#0B1220"}
        strokeWidth={2}
        ref={(node) => { if (node) shapeRefs.current[s.id] = node; }}
        onMouseDown={(e) => {
          if (tool !== "select") return;
          e.cancelBubble = true;
          onSelect?.(s.id);
        }}
        onClick={(e) => {
          if (tool !== "select") return;
          e.cancelBubble = true;
          onSelect?.(s.id);
        }}
        onDragEnd={(e) => {
          if (tool !== "select") return;
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
        if (tool === "select") {
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