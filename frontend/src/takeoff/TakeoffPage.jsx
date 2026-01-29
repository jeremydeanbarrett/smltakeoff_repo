import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, fileStreamUrl } from "../api";
import "./takeoff.css";
import PdfKonvaViewer from "./PdfKonvaViewer";

export default function TakeoffPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const pid = useMemo(() => Number(projectId), [projectId]);

  const [files, setFiles] = useState([]);
  const [activeFileId, setActiveFileId] = useState(null);
  const [err, setErr] = useState("");

  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [tool, setTool] = useState("pan");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [totalsScope, setTotalsScope] = useState("page"); // "page" | "file"

  const toggleFullscreen = () => setIsFullscreen((v) => !v);

  // Auto-fit the PDF/canvas whenever the workspace changes size (fullscreen/exit, resize)
  useEffect(() => {
    const pulseFit = () => {
      // trigger viewer fit behavior
      setTool("fit-page");
      // return to hand tool immediately after the fit pulse
      setTimeout(() => setTool((t) => (t === "fit-page" ? "pan" : t)), 0);
    };

    // Fit when entering/exiting fullscreen
    pulseFit();

    // Fit on window resize while in fullscreen
    const onResize = () => {
      if (isFullscreen) pulseFit();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isFullscreen]);



  const [selectedId, setSelectedId] = useState(null);
  const [selectedStrokeId, setSelectedStrokeId] = useState(null);
  const [activeItemId, setActiveItemId] = useState("unassigned");
  const undoRef = React.useRef({});
  const redoRef = React.useRef({});
  const [tick, setTick] = useState(0);
  const [takeoffData, setTakeoffData] = useState({ pages: {} });
  const [saving, setSaving] = useState(false);


  useEffect(() => {
    function onKey(e) {
      // Don't hijack typing in inputs
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
      const isTyping = tag === "input" || tag === "textarea" || tag === "select";

      // Fullscreen shortcuts
      if (!isTyping && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        toggleFullscreen();
        return;
      }

      if (e.key === "Escape") {
        // Exit fullscreen, clear selection, and exit calibrate if needed
        setIsFullscreen(false);
        setSelectedId(null);
        if (tool === "calibrate") setTool("pan");
        return;
      }

      // Edit operations
      if (!isTyping && (e.key === "Delete" || e.key === "Backspace")) {
        deleteSelected();
        return;
      }

      // Undo / redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }

      // Tool shortcuts (ignore when typing)
      if (!isTyping && !e.ctrlKey && !e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "h") setTool("pan");
        if (k === "l") setTool("line");
        if (k === "c") setTool("count");
        if (k === "v") setTool("select");
        if (k === "a") setTool("area");
        if (k === "m") setTool("measure");
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, selectedId, takeoffData, isFullscreen]);

  // Scale / units
  // We store scale config inside takeoffData.scale (per file).
  // unitsPerPx is the number of real-world units per *world pixel* in Konva space.
  // For imperial, units are feet. For metric, units are meters.
  const [unitSystem, setUnitSystem] = useState("imperial");
  const [scalePreset, setScalePreset] = useState("none");
  const [calibrateMode, setCalibrateMode] = useState(false);
  const [unitsPerPx, setUnitsPerPx] = useState(null);
  const [lastMeasure, setLastMeasure] = useState(null);
  const [pageRenderScale, setPageRenderScale] = useState(1);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setErr("");
        const out = await api.listFiles(pid);
        const list = out?.files ?? [];
        if (!alive) return;
        setFiles(list);
        if (list.length && !activeFileId) setActiveFileId(list[0].id);
      } catch (e) {
        if (!alive) return;
        setErr(String(e?.message || e));
      }
    })();
    return () => { alive = false; };
  }, [pid]);

  // Load takeoff data for this file
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!activeFileId) return;
      try {
        const out = await api.getTakeoff(pid, activeFileId);
        if (!alive) return;
        const raw = out?.takeoff?.data || { pages: {} };
        const data = { ...raw, pages: raw?.pages && typeof raw.pages === 'object' ? raw.pages : {} };
        setTakeoffData(data);

        // Load saved scale config
        const saved = data?.scale || null;
        if (saved?.unitSystem) setUnitSystem(saved.unitSystem);
        if (saved?.preset) setScalePreset(saved.preset);
        if (typeof saved?.unitsPerPx === "number") setUnitsPerPx(saved.unitsPerPx);
      } catch (e) {
        if (!alive) return;
        // eslint-disable-next-line no-console
        console.error(e);
      }
    })();
    return () => { alive = false; };
  }, [pid, activeFileId]);

  const activeUrl = activeFileId ? fileStreamUrl(activeFileId) : null;

  const strokes = (takeoffData?.pages?.[String(pageNumber)]?.strokes) || [];

  // Scale presets -> ratio (real units / paper units)
  const SCALE_PRESETS = useMemo(() => {
    return {
      imperial_arch: [
        { key: "1_8", label: '1/8" = 1\'-0"', ratio: 96 },
        { key: "1_4", label: '1/4" = 1\'-0"', ratio: 48 },
        { key: "3_8", label: '3/8" = 1\'-0"', ratio: 32 },
        { key: "1_2", label: '1/2" = 1\'-0"', ratio: 24 },
        { key: "3_4", label: '3/4" = 1\'-0"', ratio: 16 },
        { key: "1_1", label: '1" = 1\'-0"', ratio: 12 },
      ],
      imperial_eng: [
        { key: "1in_10ft", label: '1" = 10\'', ratio: 120 },
        { key: "1in_20ft", label: '1" = 20\'', ratio: 240 },
        { key: "1in_30ft", label: '1" = 30\'', ratio: 360 },
        { key: "1in_40ft", label: '1" = 40\'', ratio: 480 },
        { key: "1in_50ft", label: '1" = 50\'', ratio: 600 },
        { key: "1in_100ft", label: '1" = 100\'', ratio: 1200 },
      ],
      metric: [
        { key: "1_20", label: "1:20", ratio: 20 },
        { key: "1_25", label: "1:25", ratio: 25 },
        { key: "1_50", label: "1:50", ratio: 50 },
        { key: "1_75", label: "1:75", ratio: 75 },
        { key: "1_100", label: "1:100", ratio: 100 },
        { key: "1_150", label: "1:150", ratio: 150 },
        { key: "1_200", label: "1:200", ratio: 200 },
      ],
    };
  }, []);

  // Flattened list of all presets for quick lookup (used by persistence + effects)
  const scalePresets = useMemo(() => {
    return [...SCALE_PRESETS.imperial_arch, ...SCALE_PRESETS.imperial_eng, ...SCALE_PRESETS.metric];
  }, [SCALE_PRESETS]);

  function computeUnitsPerPxFromRatio(ratio, sys) {
    // ratio = real / paper
    // PDF canvas world pixels represent (1 / (72 * pageRenderScale)) inches on paper.
    // So paperInchesPerPx = 1 / (72 * pageRenderScale)
    const paperInchesPerPx = 1 / (72 * (pageRenderScale || 1));
    if (sys === "imperial") {
      const realInchesPerPx = ratio * paperInchesPerPx;
      return realInchesPerPx / 12; // feet per px
    }
    // metric: paper units are mm; in PDF points -> inches -> mm
    // 1 inch = 25.4 mm
    const paperMmPerPx = paperInchesPerPx * 25.4;
    const realMmPerPx = ratio * paperMmPerPx;
    return realMmPerPx / 1000; // meters per px
  }

  // ---------------------------------------------------------------------------
  // Phase 2 persistence fix:
  // If the user picked a PRESET scale, the correct unitsPerPx depends on the
  // current PDF render scale. Previously, we stored unitsPerPx once and re-used
  // it even after resize/fullscreen (which changes renderScale), so measurements
  // and totals could drift. We now re-compute unitsPerPx whenever renderScale or
  // the preset changes.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!takeoffData) return;
    if (!pageRenderScale) return;

    const presetKey = takeoffData?.scale?.preset;
    if (!presetKey || presetKey === "none" || presetKey === "calibrated") return;

    // Find the preset definition to get its ratio.
    const hit = scalePresets.find((p) => p.key === presetKey);
    if (!hit) return;

    const next = computeUnitsPerPxFromRatio(hit.ratio, unitSystem);
    if (!Number.isFinite(next) || next <= 0) return;

    // Tiny epsilon to avoid loops from floating point jitter
    const eps = 1e-12;
    if (!unitsPerPx || Math.abs(unitsPerPx - next) > eps) {
      setUnitsPerPx(next);
    }
  }, [takeoffData, pageRenderScale, unitSystem, scalePresets]);

  async function saveScale(nextUnitsPerPx, nextPreset, nextUnitSystem) {
    if (!activeFileId) return;
    const next = {
      ...(takeoffData || { pages: {} }),
      scale: {
        unitSystem: nextUnitSystem,
        preset: nextPreset,
        unitsPerPx: nextUnitsPerPx,
      },
    };
    setTakeoffData(next);
    setSaving(true);
    try {
      await api.saveTakeoff(pid, activeFileId, next);
    } finally {
      setSaving(false);
    }
  }

  async function commitStrokes(nextStrokes, opts = {}) {
    if (!activeFileId) return;
    setSelectedId(null);
    let next = null;
    // Use a functional state update so we always build the next object from the
    // latest takeoffData, avoiding "undo toggles" caused by stale closures.
    setTakeoffData((prev) => {
      const base = prev || { pages: {} };
      const prevStrokes = base.pages?.[String(pageNumber)]?.strokes || [];
      if (!opts.skipHistory) pushUndo(prevStrokes);
      next = {
        ...base,
        pages: {
          ...(base.pages || {}),
          [String(pageNumber)]: { strokes: nextStrokes },
        },
      };
      return next;
    });
    setSaving(true);
    try {
      // next is assigned inside the setTakeoffData functional update above.
      // eslint-disable-next-line no-unmodified-loop-condition
      while (!next) await new Promise((r) => setTimeout(r, 0));
      await api.saveTakeoff(pid, activeFileId, next);
    } finally {
      setSaving(false);
    }
  }

  const unitLabel = unitSystem === "imperial" ? "ft" : "m";

  // ---------------------------
  // Item Library (Phase 2)
  // ---------------------------
  const [items, setItems] = useState([{ id: "unassigned", name: "Unassigned" }]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const out = await api.listItems();
        if (!alive) return;
        const list = (out?.items || []).map((it) => ({
          id: String(it.id),
          systemType: it.system_type,
          category: it.category,
          name: `${it.item_name}${it.size ? ` ${it.size}` : ""}`.trim(),
        }));
        setItems([{ id: "unassigned", name: "Unassigned", systemType: "", category: "" }, ...list]);
      } catch (e) {
        // ignore; user might not be logged in yet
        if (!alive) return;
        // eslint-disable-next-line no-console
        console.warn(e);
      }
    })();
    return () => { alive = false; };
  }, []);


  async function addItemQuick() {
    const name = window.prompt("Item name (e.g. 1-1/4\" Copper Type L)");
    if (!name) return;
    const systemType = window.prompt("System (Plumbing / Gas / HVAC)", "Plumbing") || "Plumbing";
    const category = window.prompt("Category (Pipe / Fixture / Valve)", "Pipe") || "Pipe";
    const size = "";
    try {
      await api.createItem({ systemType, category, itemName: name, size });
      const out = await api.listItems();
      const list = (out?.items || []).map((it) => ({
        id: String(it.id),
        systemType: it.system_type,
        category: it.category,
        name: `${it.item_name}${it.size ? ` ${it.size}` : ""}`.trim(),
      }));
      setItems([{ id: "unassigned", name: "Unassigned", systemType: "", category: "" }, ...list]);
    } catch (e) {
      alert(String(e?.message || e));
    }
  }

  async function editLibraryItem(it) {
    if (!it || it.id === "unassigned") return;
    const systemType = window.prompt("System Type (e.g. Plumbing, Gas, HVAC)", it.system_type || it.systemType || "Plumbing");
    if (!systemType) return;
    const category = window.prompt("Category (e.g. Waterline, Gasline, Duct)", it.category || "General");
    if (!category) return;
    const itemName = window.prompt("Item Name", it.item_name || it.itemName || it.name || "");
    if (!itemName) return;
    const size = window.prompt("Size (optional)", it.size || "");
    try {
      await api.updateItem(it.id, { systemType, category, itemName, size });
      const out = await api.listItems();
      const merged = [{ id: "unassigned", name: "Unassigned" }, ...(out.items || []).map(x => ({
        ...x,
        id: x.id,
        name: `${x.item_name}${x.size ? " " + x.size : ""}`
      }))];
      setItems(merged);
    } catch (e) {
      alert(e?.message || "Failed to update item");
    }
  }

  async function deleteLibraryItem(it) {
    if (!it || it.id === "unassigned") return;
    const ok = window.confirm(`Delete "${it.name || it.item_name}"?`);
    if (!ok) return;
    try {
      await api.deleteItem(it.id);
      const out = await api.listItems();
      const merged = [{ id: "unassigned", name: "Unassigned" }, ...(out.items || []).map(x => ({
        ...x,
        id: x.id,
        name: `${x.item_name}${x.size ? " " + x.size : ""}`
      }))];
      setItems(merged);
      if (activeItemId === it.id) setActiveItemId("unassigned");
    } catch (e) {
      alert(e?.message || "Failed to delete item");
    }
  }

  const totalsByItem = useMemo(() => {
    const by = {};
    for (const it of items) {
      by[it.id] = { length: 0, count: 0, area: 0 };
    }

    const upp = typeof unitsPerPx === "number" ? unitsPerPx : null;

    for (const s of strokes || []) {
      const iid = s.itemId || "unassigned";
      if (!by[iid]) by[iid] = { length: 0, count: 0, area: 0 };

      if (s.type === "count") {
        by[iid].count += 1;
      }
      if (s.type === "line" && Array.isArray(s.points) && s.points.length === 4 && upp != null) {
        const [x1, y1, x2, y2] = s.points;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const pxLen = Math.sqrt(dx * dx + dy * dy);
        by[iid].length += pxLen * upp;
      }

      if (s.type === "area" && Array.isArray(s.points) && s.points.length >= 6 && upp != null) {
        let a = 0;
        const n = Math.floor(s.points.length / 2);
        for (let i = 0; i < n; i++) {
          const x1 = s.points[i*2], y1 = s.points[i*2+1];
          const x2 = s.points[((i+1)%n)*2], y2 = s.points[((i+1)%n)*2+1];
          a += x1 * y2 - x2 * y1;
        }
        const pxArea = Math.abs(a) / 2;
        by[iid].area += pxArea * upp * upp;
      }
    }

    return by;
  }, [strokes, unitsPerPx, items]);

const totalsByItemFile = useMemo(() => {
  const by = {};
  for (const it of items) {
    by[it.id] = { length: 0, count: 0, area: 0 };
  }
  const upp = typeof unitsPerPx === "number" ? unitsPerPx : null;
  const pages = takeoffData?.pages || {};
  for (const pn of Object.keys(pages)) {
    const st = pages[pn]?.strokes || [];
    for (const s of st) {
      const iid = s.itemId || "unassigned";
      if (!by[iid]) by[iid] = { length: 0, count: 0, area: 0 };
      if (s.type === "count") by[iid].count += 1;
      if (s.type === "line" && Array.isArray(s.points) && s.points.length === 4 && upp != null) {
        const [x1, y1, x2, y2] = s.points;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const pxLen = Math.sqrt(dx * dx + dy * dy);
        by[iid].length += pxLen * upp;
      }

      if (s.type === "area" && Array.isArray(s.points) && s.points.length >= 6 && upp != null) {
        let a = 0;
        const n = Math.floor(s.points.length / 2);
        for (let i = 0; i < n; i++) {
          const x1 = s.points[i*2], y1 = s.points[i*2+1];
          const x2 = s.points[((i+1)%n)*2], y2 = s.points[((i+1)%n)*2+1];
          a += x1 * y2 - x2 * y1;
        }
        const pxArea = Math.abs(a) / 2;
        by[iid].area += pxArea * upp * upp;
      }
    }
  }
  return by;
}, [takeoffData, unitsPerPx, items]);


  const totalsActive = totalsScope === "file" ? totalsByItemFile : totalsByItem;


  function fmtLen(v) {
    if (v == null || Number.isNaN(v)) return "—";
    if (unitSystem === "imperial") {
      // show feet with 2 decimals
      return `${v.toFixed(2)} ${unitLabel}`;
    }
    // metric
    return `${v.toFixed(3)} ${unitLabel}`;
  }

  function fmtArea(v) {
    if (v == null || Number.isNaN(v)) return "—";
    const lab = unitSystem === "imperial" ? "ft²" : "m²";
    return `${v.toFixed(2)} ${lab}`;
  }
  // ---------------------------
  // Undo / Redo (per file + page)
  // ---------------------------
  function pageKey() {
    return `${activeFileId || "nofile"}:p:${pageNumber}`;
  }

  function getStrokesForPage(pn = pageNumber) {
    return takeoffData.pages?.[String(pn)]?.strokes || [];
  }

  function pushUndo(prevStrokes) {
    const key = pageKey();
    undoRef.current[key] = undoRef.current[key] || [];
    redoRef.current[key] = redoRef.current[key] || [];
    // Clone strokes so later mutations don't corrupt undo history.
    const clone = (prevStrokes || []).map((s) => ({
      ...s,
      points: Array.isArray(s.points) ? [...s.points] : s.points,
    }));
    undoRef.current[key].push(clone);
    if (undoRef.current[key].length > 100) undoRef.current[key].shift();
    redoRef.current[key] = [];
    setTick((t) => t + 1);
  }

  function canUndo() {
    const key = pageKey();
    return (undoRef.current[key] || []).length > 0;
  }

  function canRedo() {
    const key = pageKey();
    return (redoRef.current[key] || []).length > 0;
  }

  function undo() {
    const key = pageKey();
    const stack = undoRef.current[key] || [];
    if (!stack.length) return;
    const current = getStrokesForPage();
    const prev = stack.pop();
    redoRef.current[key] = redoRef.current[key] || [];
    // Clone current so later mutations don't corrupt redo history.
    redoRef.current[key].push((current || []).map((s) => ({
      ...s,
      points: Array.isArray(s.points) ? [...s.points] : s.points,
    })));
    const next = {
      ...(takeoffData || { pages: {} }),
      pages: {
        ...((takeoffData && takeoffData.pages) || {}),
        [String(pageNumber)]: { strokes: prev },
      },
    };
    commitStrokes(prev, { skipHistory: true });
  }

  function redo() {
    const key = pageKey();
    const stack = redoRef.current[key] || [];
    if (!stack.length) return;
    const current = getStrokesForPage();
    const nxt = stack.pop();
    undoRef.current[key] = undoRef.current[key] || [];
    undoRef.current[key].push((current || []).map((s) => ({
      ...s,
      points: Array.isArray(s.points) ? [...s.points] : s.points,
    })));

    commitStrokes(nxt, { skipHistory: true });
  }

  function deleteSelected() {
    if (!selectedId) return;
    const strokes = getStrokesForPage();
    const prev = strokes;
    const nextStrokes = strokes.filter((s) => s.id !== selectedId);
    pushUndo(prev);
    setSelectedId(null);
    commitStrokes(nextStrokes, { skipHistory: true });
  }

  function downloadCsv() {
    const rows = [];
    rows.push(["Item", "Count", `Length (${unitLabel})`, unitSystem === "imperial" ? "Area (ft^2)" : "Area (m^2)"].join(","));
    for (const it of items) {
      if (it.id === "unassigned") continue;
      const t = totalsActive[it.id] || { length: 0, count: 0, area: 0 };
      rows.push([
        `"${String(it.name).replaceAll('"', '""')}"`,
        String(t.count || 0),
        String((t.length || 0).toFixed(unitSystem === "imperial" ? 2 : 3)),
        String((t.area || 0).toFixed(2)),
      ].join(","));
    }
    const csv = rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const fname = `takeoff_project_${pid}_file_${activeFileId || ""}_${totalsScope}.csv`;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }


  return (
    <div className={"takeoff-root takeoff-page" + (isFullscreen ? " fullscreen" : "")}> 
      <div className="takeoff-topbar">
        <button className="btn" onClick={() => navigate("/")}>&larr; Projects</button>
        <div className="takeoff-title">Takeoff</div>
        <div className="takeoff-spacer" />
      </div>

      <div className="takeoff-layout">
        <aside className="takeoff-left">
          <div className="panel-title">Files</div>
          {err ? <div className="error">{err}</div> : null}
          {files.length === 0 ? <div className="muted">No files uploaded.</div> : null}
          <div className="file-list">
            {files.map(f => (
              <button
                key={f.id}
                className={"file-item" + (f.id === activeFileId ? " active" : "")}
                onClick={() => setActiveFileId(f.id)}
                title={f.original_name || f.filename}
              >
                {f.original_name || f.filename}
              </button>
            ))}
          </div>

          <div className="panel-title" style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Items</span>
            <button className="btn btn-small" onClick={addItemQuick}>+ Add</button>
          </div>
          <div className="muted" style={{ marginBottom: 6 }}>
            Select an item, then draw/count. Totals update per page/file.
          </div>
          <div className="item-list">
            {items.map((it) => {
              const t = totalsActive[it.id] || { length: 0, count: 0, area: 0 };
              const active = it.id === activeItemId;
              return (
                <div
                  key={it.id}
                  className={"item-row" + (active ? " active" : "")}
                  onClick={() => setActiveItemId(it.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveItemId(it.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  title={it.name}
                >
                  <div className="item-name">{it.name}</div>
                  <div className="item-totals">
                    <span className="pill">{t.count} ct</span>
                    <span className="pill">{fmtLen(t.length)}</span>
                    {it.id !== "unassigned" ? (
                      <span className="item-actions" onClick={(e) => e.stopPropagation()}>
                        <button className="icon-btn" title="Edit" onClick={(e) => { e.stopPropagation(); editLibraryItem(it); }}>✎</button>
                        <button className="icon-btn" title="Delete" onClick={(e) => { e.stopPropagation(); deleteLibraryItem(it); }}>🗑</button>
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <main className="takeoff-center">
          {!activeUrl ? (
            <div className="muted">Select a file to view.</div>
          ) : (
            <div className="takeoff-canvas-wrap" onDoubleClick={toggleFullscreen}>
              <div className="takeoff-pagebar">
                <button className="btn" disabled={pageNumber <= 1} onClick={() => setPageNumber(p => Math.max(1, p - 1))}>Prev</button>
                <div className="takeoff-pageinfo">Page {pageNumber} / {pageCount}</div>
                <button className="btn" disabled={pageNumber >= pageCount} onClick={() => setPageNumber(p => Math.min(pageCount, p + 1))}>Next</button>
                <div className="takeoff-spacer" />
                <div className="muted" style={{ marginRight: 8 }}>{saving ? "Saving..." : ""}</div>
              </div>
              <div className="takeoff-canvas">
                <PdfKonvaViewer
                  pdfUrl={activeUrl}
                  pageNumber={pageNumber}
                  tool={tool}
                  unitSystem={unitSystem}
                  unitsPerPx={unitsPerPx}
                  activeItemId={activeItemId}
                  calibrateMode={calibrateMode}
                  strokes={strokes}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onCommitStrokes={commitStrokes}
                  onMeasure={(m) => setLastMeasure(m)}
                  onCalibrated={(nextUnitsPerPx) => {
                    setUnitsPerPx(nextUnitsPerPx);
                    setScalePreset("calibrated");
                    setCalibrateMode(false);
                    saveScale(nextUnitsPerPx, "calibrated", unitSystem);
                  }}
                  onPageInfo={(info) => {
                    if (info?.numPages) setPageCount(info.numPages);
                    if (typeof info?.scale === "number") setPageRenderScale(info.scale);
                  }}
                                  selectedStrokeId={selectedStrokeId}
                  onSelectStroke={setSelectedStrokeId}
/>
              </div>
            </div>
          )}
        </main>

        <aside className="takeoff-right">
          <div className="panel-title">Tools</div>
          <div className="panel-title" style={{ marginTop: 10 }}>Totals</div>
          <div className="scale-panel">
            <div className="scale-row">
              <label className="scale-label">Scope</label>
              <select className="scale-select" value={totalsScope} onChange={(e) => setTotalsScope(e.target.value)}>
                <option value="page">This page</option>
                <option value="file">Whole file</option>
              </select>
            </div>
            <button className="btn" onClick={downloadCsv}>Export CSV</button>
          </div>
          <div className="panel-title" style={{ marginTop: 10 }}>Scale</div>
          <div className="scale-panel">
            <div className="scale-row">
              <label className="scale-label">Units</label>
              <select
                className="scale-select"
                value={unitSystem}
                onChange={(e) => {
                  const next = e.target.value;
                  setUnitSystem(next);
                  // Recompute preset-based scale if applicable
                  if (scalePreset && scalePreset !== "none" && scalePreset !== "calibrated") {
                    const all = [...SCALE_PRESETS.imperial_arch, ...SCALE_PRESETS.imperial_eng, ...SCALE_PRESETS.metric];
                    const hit = all.find(p => p.key === scalePreset);
                    if (hit) {
                      const nextUPP = computeUnitsPerPxFromRatio(hit.ratio, next);
                      setUnitsPerPx(nextUPP);
                      saveScale(nextUPP, scalePreset, next);
                    }
                  } else {
                    saveScale(unitsPerPx, scalePreset, next);
                  }
                }}
              >
                <option value="imperial">Imperial (ft)</option>
                <option value="metric">Metric (m)</option>
              </select>
            </div>

            <div className="scale-row">
              <label className="scale-label">Preset</label>
              <select
                className="scale-select"
                value={scalePreset}
                onChange={(e) => {
                  const nextPreset = e.target.value;
                  setScalePreset(nextPreset);
                  setCalibrateMode(false);
                  if (nextPreset === "none") {
                    setUnitsPerPx(null);
                    saveScale(null, "none", unitSystem);
                    return;
                  }
                  if (nextPreset === "calibrated") {
                    // keep last calibration
                    saveScale(unitsPerPx, "calibrated", unitSystem);
                    return;
                  }
                  const all = [...SCALE_PRESETS.imperial_arch, ...SCALE_PRESETS.imperial_eng, ...SCALE_PRESETS.metric];
                  const hit = all.find(p => p.key === nextPreset);
                  if (!hit) return;
                  const nextUPP = computeUnitsPerPxFromRatio(hit.ratio, unitSystem);
                  setUnitsPerPx(nextUPP);
                  saveScale(nextUPP, nextPreset, unitSystem);
                }}
              >
                <option value="none">(Not set)</option>
                <optgroup label="Architectural (Imperial)">
                  {SCALE_PRESETS.imperial_arch.map(p => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Engineering (Imperial)">
                  {SCALE_PRESETS.imperial_eng.map(p => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Metric Ratios">
                  {SCALE_PRESETS.metric.map(p => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </optgroup>
                <option value="calibrated">(Calibrated)</option>
              </select>
            </div>

            <div className="scale-row">
              <button
                className={"btn" + (calibrateMode ? " active" : "")}
                onClick={() => {
                  setCalibrateMode(m => !m);
                  setTool("calibrate");
                }}
                title="Click two points on the drawing, then enter the real distance"
              >
                {calibrateMode ? "Calibrating..." : "Calibrate"}
              </button>
              <button
                className="btn"
                onClick={() => setTool("fit-page")}
              >
                Fit Page
              </button>
              <button
                className="btn"
                onClick={() => setTool("fit-width")}
              >
                Fit Width
              </button>
            </div>

            <div className="muted" style={{ marginTop: 8 }}>
              Current scale: {unitsPerPx ? `${unitsPerPx.toExponential(3)} ${unitLabel}/px` : "(not set)"}
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              Last line: {lastMeasure?.type === "line" ? fmtLen(lastMeasure.length) : "—"}
            </div>
          </div>

          <div className="tool-stack">
            <button className={"tool-btn" + (tool === "pan" ? " active" : "")} onClick={() => setTool("pan")}>Hand</button>
            <button className={"tool-btn" + (tool === "line" ? " active" : "")} onClick={() => setTool("line")}>Line</button>
            <button className={"tool-btn" + (tool === "area" ? " active" : "")} onClick={() => setTool("area")}>Area</button>
            <button className={"tool-btn" + (tool === "measure" ? " active" : "")} onClick={() => setTool("measure")}>Measure</button>
            <button className={"tool-btn" + (tool === "count" ? " active" : "")} onClick={() => setTool("count")} >Count</button>
                        <button className={"tool-btn" + (tool === "select" ? " active" : "")} onClick={() => setTool("select")} >Select</button>
          </div>
          <div className="tool-stack" style={{ marginTop: 10 }}>
            <button className="tool-btn" onClick={undo} disabled={!canUndo()}>Undo</button>
            <button className="tool-btn" onClick={redo} disabled={!canRedo()}>Redo</button>
            <button className="tool-btn" onClick={deleteSelected} disabled={!selectedId}>Delete</button>
          </div>
          <div className="muted" style={{ marginTop: 12, lineHeight: 1.4 }}>
            Tips:<br />
            • Mouse wheel = zoom<br />
            • Hand tool = pan<br />
            • Line tool = click-drag (hold SHIFT = snap angles)
            • Area tool = click points, double-click to close
            • Measure tool = click two points (no save)
            • Hotkeys: H Hand, L Line, A Area, C Count, M Measure, V Select (hold Shift to snap)<br />
            • Area tool = click points, double-click to close<br />
            • Measure tool = click 2 points (doesn’t save)<br />
            • Keys: H hand, L line, C count, A area, M measure, V select
          </div>
        </aside>
      </div>
    </div>
  );
}
