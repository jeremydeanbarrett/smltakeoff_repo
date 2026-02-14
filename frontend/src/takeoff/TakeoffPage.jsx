import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, fileStreamUrl, requestKeepalive } from "../api";
import "./takeoff.css";
import PdfKonvaViewer from "./PdfKonvaViewer";

export default function TakeoffPage() {
  const { projectId, fileId } = useParams();
  const navigate = useNavigate();

  const pid = useMemo(() => Number(projectId), [projectId]);

  

  const initialFileId = useMemo(() => {
    const n = Number(fileId);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [fileId]);
const [files, setFiles] = useState([]);
  const [activeFileId, setActiveFileId] = useState(null);

  // STACK Step 2: quick search + grouping (safe, isolated state)
  const [planQuery, setPlanQuery] = useState("");
  const [itemQuery, setItemQuery] = useState("");
  // Plan text search (PDF embedded text only; scanned PDFs need OCR later)
  const [pdfFindQuery, setPdfFindQuery] = useState("");
  const [pdfFindCmd, setPdfFindCmd] = useState(0);
  const [pdfFindDir, setPdfFindDir] = useState(null); // "next" | "prev"
  const [pdfFindResults, setPdfFindResults] = useState([]); // [{pageNumber,count}]
  const [pdfFindMatchInfo, setPdfFindMatchInfo] = useState({ pageNumber: 1, index: 0, total: 0 });

  const [showAllItems, setShowAllItems] = useState(false);
  const [pinnedItemIds, setPinnedItemIds] = useState([]);
  const [libPickerOpen, setLibPickerOpen] = useState(false);
  const [libPickerQuery, setLibPickerQuery] = useState("");
  const [openSystems, setOpenSystems] = useState({});
  const [openCategories, setOpenCategories] = useState({});


  // STACK-style left panel sections
  const [plansOpen, setPlansOpen] = useState(true);
  const [uploadsOpen, setUploadsOpen] = useState(true);

  // Persist panel/search state per project (so refresh feels like STACK)
  const uiKey = useMemo(() => (pid ? `smltakeoff_ui_${pid}` : ""), [pid]);

  useEffect(() => {
    if (!uiKey) return;
    try {
      const raw = localStorage.getItem(uiKey);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.plansOpen === "boolean") setPlansOpen(s.plansOpen);
      if (typeof s.uploadsOpen === "boolean") setUploadsOpen(s.uploadsOpen);
      if (typeof s.planQuery === "string") setPlanQuery(s.planQuery);
      if (typeof s.itemQuery === "string") setItemQuery(s.itemQuery);
      if (typeof s.showAllItems === "boolean") setShowAllItems(s.showAllItems);
      if (Array.isArray(s.pinnedItemIds)) setPinnedItemIds(s.pinnedItemIds.map(String));
      if (s.openSystems && typeof s.openSystems === "object") setOpenSystems(s.openSystems);
      if (s.openCategories && typeof s.openCategories === "object") setOpenCategories(s.openCategories);
    } catch {}
  }, [uiKey]);

  useEffect(() => {
    if (!uiKey) return;
    try {
      const s = {
        plansOpen,
        uploadsOpen,
        planQuery,
        itemQuery,
        showAllItems,
        pinnedItemIds,
        openSystems,
        openCategories,
      };
      localStorage.setItem(uiKey, JSON.stringify(s));
    } catch {}
  }, [uiKey, plansOpen, uploadsOpen, planQuery, itemQuery, showAllItems, pinnedItemIds, openSystems, openCategories]);

  // Keep URL aligned with the active file so refresh reloads the same takeoff data
  useEffect(() => {
    if (!pid || !activeFileId) return;
    const hash = window.location.hash || "";
    const isFocus = hash.includes("/focus");
    const path = isFocus ? `/takeoff/${pid}/${activeFileId}/focus` : `/takeoff/${pid}/${activeFileId}`;
    if (!hash.includes(path)) {
      navigate(path, { replace: true });
    }
  }, [pid, activeFileId, navigate]);

  const [err, setErr] = useState("");


  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [tool, setTool] = useState("pan");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [totalsScope, setTotalsScope] = useState("page"); // "page" | "file"

  const setFocusUrl = (focus) => {
    if (!pid || !activeFileId) return;
    const base = `/takeoff/${pid}/${activeFileId}`;
    navigate(focus ? `${base}/focus` : base, { replace: true });
  };

  const toggleFullscreen = () => {
    setIsFullscreen((v) => {
      const next = !v;
      setFocusUrl(next);
      return next;
    });
  };

  // If URL includes /focus, start in Focus Mode
  useEffect(() => {
    const hash = window.location.hash || "";
    const focus = hash.includes("/focus");
    if (focus !== isFullscreen) setIsFullscreen(focus);
  }, [pid, activeFileId]);

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
  // Item visibility (per project)
  const hiddenKey = pid ? `sml_hidden_items_${pid}` : null;
  const [hiddenItemIds, setHiddenItemIds] = useState(() => {
    try {
      if (!hiddenKey) return {};
      const raw = localStorage.getItem(hiddenKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      if (hiddenKey) localStorage.setItem(hiddenKey, JSON.stringify(hiddenItemIds || {}));
    } catch {
      // ignore
    }
  }, [hiddenKey, hiddenItemIds]);

  const isHidden = (id) => !!(hiddenItemIds && hiddenItemIds[String(id)]);
  const toggleHidden = (id) => {
    const key = String(id);
    setHiddenItemIds((prev) => {
      const next = { ...(prev || {}) };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
    // if hiding the active item, jump back to unassigned so user can keep drawing
    if (String(activeItemId) === key) setActiveItemId("unassigned");
  };

  const undoRef = React.useRef({});
  const redoRef = React.useRef({});
  const [tick, setTick] = useState(0);
  const [takeoffData, setTakeoffData] = useState({ pages: {} });

// Robust autosave state
const [saveState, setSaveState] = useState("idle"); // idle | dirty | saving | saved | error
const [saveDetail, setSaveDetail] = useState("");
const lastSavedAtRef = React.useRef(0);
const dirtyRef = React.useRef(false);
const latestToSaveRef = React.useRef(null);
const pendingTimerRef = React.useRef(null);
const inflightRef = React.useRef(false);
const rerunRef = React.useRef(false);

const saving = saveState === "saving";

  function toScaleMmPerPx(unitsPerPxVal, unitSys) {
    const upp = Number(unitsPerPxVal);
    if (!Number.isFinite(upp) || upp <= 0) return 1.0;
    // viewer uses ft for imperial, m for metric
    return unitSys === "imperial" ? (upp * 304.8) : (upp * 1000.0);
  }

  function fromScaleMmPerPx(scaleMmPerPxVal, unitSys) {
    const s = Number(scaleMmPerPxVal);
    if (!Number.isFinite(s) || s <= 0) return null;
    return unitSys === "imperial" ? (s / 304.8) : (s / 1000.0);
  }

  async function doSaveNow(payload, reason = "") {
    if (!pid || !activeFileId) return;
    if (inflightRef.current) {
      rerunRef.current = true;
      latestToSaveRef.current = payload;
      return;
    }
    inflightRef.current = true;
    rerunRef.current = false;

    setSaveState("saving");
    setSaveDetail(reason ? `Saving (${reason})...` : "Saving...");

    try {
      await api.saveTakeoff(pid, activeFileId, payload);
      lastSavedAtRef.current = Date.now();
      dirtyRef.current = false;
      setSaveState("saved");
      setSaveDetail("Saved");
    } catch (e) {
      console.error(e);
      setSaveState("error");
      setSaveDetail(String(e?.message || "Save failed"));
    } finally {
      inflightRef.current = false;
      if (rerunRef.current && latestToSaveRef.current) {
        const next = latestToSaveRef.current;
        rerunRef.current = false;
        latestToSaveRef.current = null;
        // fire immediately
        setTimeout(() => doSaveNow(next, "rerun"), 0);
      }
    }
  }

  function scheduleSave(nextTakeoffData, reason = "auto") {
    if (!pid || !activeFileId) return;

    // Build backend payload (preferred schema)
    const payload = {
      unitMode: unitSystem,
      scaleMmPerPx: toScaleMmPerPx(nextTakeoffData?.scale?.unitsPerPx ?? unitsPerPx, unitSystem),
      data: nextTakeoffData || { pages: {} },
    };

    latestToSaveRef.current = payload;
    dirtyRef.current = true;
    setSaveState("dirty");
    setSaveDetail("Unsaved changes");

    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }

    // Conservative debounce to keep UI smooth
    pendingTimerRef.current = setTimeout(() => {
      pendingTimerRef.current = null;
      if (latestToSaveRef.current) doSaveNow(latestToSaveRef.current, reason);
    }, 2000);
  }

  async function flushSave(reason = "flush") {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    if (latestToSaveRef.current && dirtyRef.current) {
      await doSaveNow(latestToSaveRef.current, reason);
    }
  }


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

      // Duplicate (Ctrl+D)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
        return;
      }

      // Lock/unlock selected (L)
      if (!isTyping && e.key.toLowerCase() === "l") {
        e.preventDefault();
        toggleLockSelected();
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
        const list = (Array.isArray(out) ? out : (out?.files ?? []));
        if (!alive) return;
        setFiles(list);
        if (list.length) {
          setActiveFileId((prev) => {
            if (prev) return prev;
            if (initialFileId && list.some((f) => Number(f.id) === Number(initialFileId))) return initialFileId;
            return list[0].id;
          });
        }
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


useEffect(() => {
  const handler = () => {
    if (!dirtyRef.current || !activeFileId || !latestToSaveRef.current) return;
    try {
      requestKeepalive(`/api/takeoff/${pid}/${activeFileId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(latestToSaveRef.current),
      });
    } catch {}
  };
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}, [pid, activeFileId]);

  const activeUrl = activeFileId ? fileStreamUrl(activeFileId) : null;

  // Load persisted takeoff (if any) for this project+file
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!pid || !activeFileId) return;
      try {
        setErr("");
        const out = await api.getTakeoff(pid, activeFileId);
        if (!alive) return;

        const t = out?.takeoff;
        if (!t) {
          // Start fresh
          setTakeoffData({ pages: {} });
          setUnitsPerPx(null);
          return;
        }

        const nextUnitMode = (t.unitMode || "imperial");
        const nextData = (t.data && typeof t.data === "object") ? t.data : { pages: {} };

        setUnitSystem(nextUnitMode);
        const upp = fromScaleMmPerPx(t.scaleMmPerPx, nextUnitMode);
        if (Number.isFinite(upp) && upp > 0) {
          setUnitsPerPx(upp);
          // keep scale metadata inside takeoffData too
          nextData.scale = {
            unitSystem: nextUnitMode,
            preset: nextData?.scale?.preset || "calibrated",
            unitsPerPx: upp,
          };
        }
        setTakeoffData({ pages: {}, ...nextData });
        setSaveState("idle");
        setSaveDetail("");
      } catch (e) {
        console.error(e);
        if (!alive) return;
        // Don't block UI if takeoff missing; treat as fresh
        setTakeoffData({ pages: {} });
      }
    })();

    return () => { alive = false; };
  }, [pid, activeFileId]);


  const visibleFiles = useMemo(() => {
    const q = (planQuery || "").trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => {
      const name = String(f.original_name || f.filename || "").toLowerCase();
      return name.includes(q);
    });
  }, [files, planQuery]);


  const strokes = (takeoffData?.pages?.[String(pageNumber)]?.strokes) || [];
  const visibleStrokes = useMemo(() => {
    const arr = strokes || [];
    return arr.filter((s) => !isHidden(s.itemId || 'unassigned'));
  }, [strokes, hiddenItemIds]);


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
  scheduleSave(next, "scale");
}


  
async function commitStrokes(nextStrokes, opts = {}) {
  if (!activeFileId) return;
  setSelectedId(null);
  let next = null;
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
  setTimeout(() => {
    if (next) scheduleSave(next, "draw");
  }, 0);
}

const unitLabel
 = unitSystem === "imperial" ? "ft" : "m";

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
          unit: it.unit || "ea",
          costPerUnit: Number(it.cost_per_unit ?? it.costPerUnit ?? 0) || 0,
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


  const visibleItems = useMemo(() => {
    const q = (itemQuery || "").trim().toLowerCase();

    // Default: show only what matters (STACK vibe)
    let base = items;

    if (!showAllItems) {
      base = items.filter((it) => {
        const id = String(it.id);
        if (id === "unassigned") return true;
        if (id === String(activeItemId)) return true;
        if (pinnedItemIds.includes(id)) return true;
        const t = totalsActive[id];
        if (!t) return false;
        return (t.count || 0) > 0 || (t.length || 0) > 0 || (t.area || 0) > 0;
      });
    }

    if (!q) return base;
    return base.filter((it) => String(it.name || "").toLowerCase().includes(q));
  }, [items, itemQuery, showAllItems, pinnedItemIds, totalsActive, activeItemId]);

  const groupedItems = useMemo(() => {
    // Keep Unassigned always visible at top
    const unassigned = visibleItems.find((x) => x.id === "unassigned") || { id: "unassigned", name: "Unassigned" };
    const rest = visibleItems.filter((x) => x.id !== "unassigned");

    // Group by systemType -> category
    const systems = {};
    for (const it of rest) {
      const sys = (it.systemType || it.system_type || it.system || "General").trim() || "General";
      const cat = (it.category || "General").trim() || "General";
      if (!systems[sys]) systems[sys] = {};
      if (!systems[sys][cat]) systems[sys][cat] = [];
      systems[sys][cat].push(it);
    }

    // Sort systems/cats/items by name
    const systemNames = Object.keys(systems).sort((a, b) => a.localeCompare(b));
    const out = { unassigned, systems: [] };
    for (const sys of systemNames) {
      const catsObj = systems[sys];
      const catNames = Object.keys(catsObj).sort((a, b) => a.localeCompare(b));
      const cats = catNames.map((cat) => ({
        name: cat,
        items: catsObj[cat].slice().sort((a, b) => String(a.name).localeCompare(String(b.name))),
      }));
      out.systems.push({ name: sys, categories: cats });
    }
    return out;
  }, [visibleItems]);


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
    const sel = strokes.find((s) => s.id === selectedId);
    if (sel?.locked) return;
    const prev = strokes;
    const nextStrokes = strokes.filter((s) => s.id !== selectedId);
    pushUndo(prev);
    setSelectedId(null);
    commitStrokes(nextStrokes, { skipHistory: true });
  }

  
  function getSelectedStroke() {
    if (!selectedId) return null;
    const strokes = getStrokesForPage();
    return strokes.find((s) => s.id === selectedId) || null;
  }

  function toggleLockSelected() {
    if (!selectedId) return;
    const strokes = getStrokesForPage();
    const sel = strokes.find((s) => s.id === selectedId);
    if (!sel) return;
    const nextStrokes = strokes.map((s) => (s.id === selectedId ? { ...s, locked: !s.locked } : s));
    // Lock toggle shouldn't spam undo history; but it IS a real edit.
    pushUndo(strokes);
    commitStrokes(nextStrokes, { skipHistory: true });
  }

  function duplicateSelected() {
    if (!selectedId) return;
    const strokes = getStrokesForPage();
    const sel = strokes.find((s) => s.id === selectedId);
    if (!sel) return;

    const newId = (globalThis.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // Small offset so you can see the duplicate immediately
    const bump = (pts) => (pts || []).map((v, i) => v + (i % 2 === 0 ? 12 : 12));

    const clone = {
      ...sel,
      id: newId,
      locked: false,
    };

    if (clone.type === "line" || clone.type === "area") {
      clone.points = bump(clone.points);
    } else if (clone.type === "count") {
      clone.x = (clone.x || 0) + 12;
      clone.y = (clone.y || 0) + 12;
    }

    const nextStrokes = [...strokes, clone];
    pushUndo(strokes);
    setSelectedId(newId);
    commitStrokes(nextStrokes, { skipHistory: true });
  }

function downloadCsv() {
    // CSV format: Summary + Detail
    // Summary columns: System, Category, Item, Scope, Page, Count, Length, Area
    // Detail columns: Page, Type, System, Category, Item, Value, Units

    const esc = (v) => `"${String(v ?? "").replaceAll('"','""')}"`;

    const rows = [];
    rows.push(["SECTION", "System", "Category", "Item", "Scope", "Page", "Count", `Length (${unitLabel})`, unitSystem === "imperial" ? "Area (ft^2)" : "Area (m^2)", "Unit", "CostPerUnit", "ExtendedCost"].join(","));

    // Summary rows
    const scopeLabel = totalsScope;
    const pageLabel = totalsScope === "page" ? String(pageNumber) : "";

    // Include Unassigned if it has any marks
    const itemOrder = [...items];
    for (const it of itemOrder) {
      const t = totalsActive[it.id] || { length: 0, count: 0, area: 0 };
      if ((t.count || 0) === 0 && (t.length || 0) === 0 && (t.area || 0) === 0) continue;

      const sys = (it.systemType || it.system_type || it.system || "General").trim() || "General";
      const cat = (it.category || "General").trim() || "General";
      const unit = String(it.unit || "ea").trim() || "ea";
      const cpu = Number(it.costPerUnit ?? it.cost_per_unit ?? 0) || 0;
      let qtyForCost = 0;
      if (unit === "ea") qtyForCost = Number(t.count || 0);
      else if (unit === "ft" || unit === "m") qtyForCost = Number(t.length || 0);
      else if (unit === "ft^2" || unit === "m^2") qtyForCost = Number(t.area || 0);
      const extCost = cpu * qtyForCost;

      rows.push([
        "SUMMARY",
        esc(sys),
        esc(cat),
        esc(it.name || (it.id === "unassigned" ? "Unassigned" : it.id)),
        esc(scopeLabel),
        esc(pageLabel),
        String(t.count || 0),
        String((t.length || 0).toFixed(unitSystem === "imperial" ? 2 : 3)),
        String((t.area || 0).toFixed(2)),
        esc(unit),
        String(cpu.toFixed(2)),
        String(extCost.toFixed(2)),
      ].join(","));
    }

    rows.push(""); // spacer
    rows.push(["SECTION", "Page", "Type", "System", "Category", "Item", "Value", "Units"].join(","));

    const upp = unitsPerPx;
    const measureLineLen = (pts) => {
      if (!Array.isArray(pts) || pts.length < 4 || !Number.isFinite(upp) || upp <= 0) return 0;
      let px = 0;
      for (let i = 0; i < pts.length - 2; i += 2) {
        const dx = pts[i + 2] - pts[i];
        const dy = pts[i + 3] - pts[i + 1];
        px += Math.sqrt(dx * dx + dy * dy);
      }
      return px * upp;
    };
    const measurePolyArea = (pts) => {
      if (!Array.isArray(pts) || pts.length < 6 || !Number.isFinite(upp) || upp <= 0) return 0;
      const n = Math.floor(pts.length / 2);
      let a = 0;
      for (let i = 0; i < n; i++) {
        const x1 = pts[i * 2], y1 = pts[i * 2 + 1];
        const x2 = pts[((i + 1) % n) * 2], y2 = pts[((i + 1) % n) * 2 + 1];
        a += x1 * y2 - x2 * y1;
      }
      const pxArea = Math.abs(a) / 2;
      return pxArea * upp * upp;
    };

    const lookupItem = (id) => items.find((x) => x.id === id) || { id, name: id || "Unassigned" };

    const pushDetail = (pn, s) => {
      const it = lookupItem(s.itemId || "unassigned");
      const sys = (it.systemType || it.system_type || it.system || "General").trim() || "General";
      const cat = (it.category || "General").trim() || "General";
      const type = s.type || "unknown";
      if (type === "count") {
        rows.push(["DETAIL", esc(pn), esc("count"), esc(sys), esc(cat), esc(it.name || it.id), "1", esc("ea")].join(","));
        return;
      }
      if (type === "area") {
        const area = measurePolyArea(s.points);
        const units = unitSystem === "imperial" ? "ft^2" : "m^2";
        rows.push(["DETAIL", esc(pn), esc("area"), esc(sys), esc(cat), esc(it.name || it.id), String(area.toFixed(2)), esc(units)].join(","));
        return;
      }
      // line/measure
      const len = measureLineLen(s.points);
      rows.push(["DETAIL", esc(pn), esc(type), esc(sys), esc(cat), esc(it.name || it.id), String(len.toFixed(unitSystem === "imperial" ? 2 : 3)), esc(unitLabel)].join(","));
    };

    if (totalsScope === "page") {
      for (const s of strokes || []) pushDetail(String(pageNumber), s);
    } else {
      const pages = takeoffData.pages || {};
      const pns = Object.keys(pages).map((x) => Number(x)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
      for (const pn of pns) {
        const ss = pages[String(pn)]?.strokes || [];
        for (const s of ss) pushDetail(String(pn), s);
      }
    }

    const csv = rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const fname = `takeoff_project_${pid}_file_${activeFileId || ""}_${totalsScope}_MEGA.csv`;
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
        <button className="btn" onClick={toggleFullscreen} title="Hide side panels (STACK-style focus)">{isFullscreen ? "Exit Focus" : "Focus"}</button>
        <div className="takeoff-title">Takeoff</div>
        <div className="takeoff-find" style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 12 }}>
          <input
            className="search-input"
            style={{ width: 220 }}
            placeholder="Find in plan…"
            value={pdfFindQuery}
            onChange={(e) => setPdfFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { setPdfFindDir("next"); setPdfFindCmd((c) => c + 1); }
              if (e.key === "Escape") { setPdfFindQuery(""); }
            }}
            title="Search embedded PDF text (scanned plans need OCR later)"
          />
          <button
            className="btn btn-small"
            disabled={!pdfFindQuery.trim()}
            onClick={() => { setPdfFindDir("prev"); setPdfFindCmd((c) => c + 1); }}
            title="Previous match"
          >
            ◀
          </button>
          <button
            className="btn btn-small"
            disabled={!pdfFindQuery.trim()}
            onClick={() => { setPdfFindDir("next"); setPdfFindCmd((c) => c + 1); }}
            title="Next match"
          >
            ▶
          </button>

          <div className="muted" style={{ fontSize: 12, minWidth: 86, textAlign: "right" }} title="Match on current page">
            {pdfFindMatchInfo.total ? `${pdfFindMatchInfo.index}/${pdfFindMatchInfo.total}` : ""}
          </div>

          {pdfFindResults?.length ? (
            <select
              className="select"
              style={{ height: 32, padding: "0 8px" }}
              value={pageNumber}
              onChange={(e) => setPageNumber(Number(e.target.value))}
              title="Jump to a page with matches"
            >
              {Array.from({ length: (pageCount || 1) }, (_, i) => i + 1).map((p) => {
                const hit = pdfFindResults.find((r) => r.pageNumber === p);
                const label = hit ? `Pg ${p} (${hit.count})` : `Pg ${p}`;
                return <option key={p} value={p}>{label}</option>;
              })}
            </select>
          ) : null}
        </div>

        <div className="takeoff-spacer" />

<div className={`save-badge ${saveState}`} title={saveDetail}>
  {saveState === "saving" ? "Saving..." :
   saveState === "dirty" ? "Unsaved" :
   saveState === "error" ? "Save failed" :
   saveState === "saved" ? `Saved ${new Date(lastSavedAtRef.current).toLocaleTimeString()}` :
   "Saved"}
</div>

      </div>

      <div className="takeoff-layout">
        <aside className="takeoff-left">
          <div className="left-sections">

  <div className="section">
    <button
      className="section-header"
      onClick={() => setPlansOpen((v) => !v)}
      aria-expanded={plansOpen}
    >
      <span className="chev">{plansOpen ? "▾" : "▸"}</span>
      <span className="section-title">Plans</span>
    </button>

    {err ? <div className="error">{err}</div> : null}
    {plansOpen ? (
      files.length === 0 ? (
        <div className="muted">No files uploaded.</div>
      ) : (
        <>
          <div className="search-row">
            <input
              className="search-input"
              placeholder="Search plans…"
              value={planQuery}
              onChange={(e) => setPlanQuery(e.target.value)}
            />
          </div>
          <div className="file-list">
          {visibleFiles.map((f) => (
            <button
              key={f.id}
              className={"file-item" + (f.id === activeFileId ? " active" : "")}
              onClick={() => setActiveFileId(f.id)}
              title={f.original_name || f.filename}
            >
              <span className="file-icon">📄</span>
              <span className="file-name">{f.original_name || f.filename}</span>
            </button>
          ))}
        </div>
        </>
      )
    ) : null}
  </div>

  <div className="section" style={{ marginTop: 10 }}>
    <button
      className="section-header"
      onClick={() => setUploadsOpen((v) => !v)}
      aria-expanded={uploadsOpen}
    >
      <span className="chev">{uploadsOpen ? "▾" : "▸"}</span>
      <span className="section-title">Uploads</span>
    </button>

    {uploadsOpen ? (
      <div className="uploads-box">
        <div className="muted" style={{ marginBottom: 8 }}>
          Add/replace plans from the project page.
        </div>
        <button className="btn" onClick={() => navigate(`/projects/${pid}`)}>
          Go to Project Uploads
        </button>
      </div>
    ) : null}
  </div>

</div>
<div className="panel-title" style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Items</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-small" onClick={() => setLibPickerOpen(true)}>+ From Library</button>
              <button className="btn btn-small" onClick={addItemQuick}>+ New</button>
            </div>
          </div>
          <div className="muted" style={{ marginBottom: 6 }}>
            Select an item, then draw/count. Totals update per page/file.
          </div>
          <div className="search-row" style={{ marginBottom: 8 }}>
            <input
              className="search-input"
              placeholder="Search items…"
              value={itemQuery}
              onChange={(e) => setItemQuery(e.target.value)}
            />
          </div>

          <div className="toggle-row" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={showAllItems} onChange={(e) => setShowAllItems(e.target.checked)} />
              <span className="muted">Show all library items</span>
            </label>
          </div>

          <div className="item-list">
            {/* Unassigned always at top */}
            {(() => {
              const it = groupedItems.unassigned;
              const t = totalsActive[it.id] || { length: 0, count: 0, area: 0 };
              const active = it.id === activeItemId;
              return (
                <div
                  key={it.id}
                  className={"item-row" + (active ? " active" : "")}
                  onClick={() => setActiveItemId(it.id)}
                  role="button"
                  tabIndex={0}
                  title={it.name}
                >
                  <button
                    className={"item-eye" + (isHidden(it.id) ? " hidden" : "")}
                    title={isHidden(it.id) ? "Show item" : "Hide item"}
                    onClick={(e) => { e.stopPropagation(); toggleHidden(it.id); }}
                  >
                    {isHidden(it.id) ? "🚫" : "👁"}
                  </button>
                  <div className="item-name">{it.name}</div>
                  <div className="item-totals">
                    <span className="pill">{t.count} ct</span>
                    <span className="pill">{fmtLen(t.length)}</span>
                  </div>
                </div>
              );
            })()}

            {/* Grouped library */}
            {groupedItems.systems.map((sys) => {
              const sysOpen = openSystems[sys.name] !== false; // default open
              return (
                <div key={sys.name} className="group-block">
                  <button
                    type="button"
                    className="group-header"
                    onClick={() =>
                      setOpenSystems((prev) => ({ ...(prev || {}), [sys.name]: !sysOpen }))
                    }
                  >
                    <span className="chev">{sysOpen ? "▾" : "▸"}</span>
                    <span className="group-title">{sys.name}</span>
                  </button>

                  {sysOpen ? (
                    <div className="group-body">
                      {sys.categories.map((cat) => {
                        const catKey = `${sys.name}::${cat.name}`;
                        const catOpen = (openCategories?.[catKey] ?? true) !== false;
                        const catTotals = cat.items.reduce((acc, it2) => {
                          const t2 = totalsActive[it2.id] || { length: 0, count: 0, area: 0 };
                          acc.length += t2.length || 0;
                          acc.count += t2.count || 0;
                          acc.area += t2.area || 0;
                          return acc;
                        }, { length: 0, count: 0, area: 0 });
                        const catAnyVisible = cat.items.some((it2) => !isHidden(it2.id));
                        const catAllHidden = cat.items.length > 0 && cat.items.every((it2) => isHidden(it2.id));
                        return (
                          <div key={catKey} className="cat-block">
                            <button
                              type="button"
                              className="cat-header"
                              onClick={() =>
                                setOpenCategories((prev) => ({ ...(prev || {}), [catKey]: !catOpen }))
                              }
                            >
                              <span className="chev">{catOpen ? "▾" : "▸"}</span>
                              <span className="cat-title">{cat.name}</span>
                              <span className="cat-meta">
                                <span className="tot-chip">{catTotals.count ? `${Math.round(catTotals.count)} EA` : ""}</span>
                                <span className="tot-chip">{catTotals.length ? fmtLen(catTotals.length) : ""}</span>
                                <span className="tot-chip">{catTotals.area ? fmtArea(catTotals.area) : ""}</span>
                                <button
                                  type="button"
                                  className="mini-btn"
                                  title={catAnyVisible ? "Hide category" : "Show category"}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setHiddenItemIds((prev) => {
                                      const next = { ...(prev || {}) };
                                      for (const it2 of cat.items) { next[String(it2.id)] = catAnyVisible; }
                                      return next;
                                    });
                                  }}
                                >
                                  {catAnyVisible ? "👁" : "🚫"}
                                </button>
                              </span>
                            </button>

                            {catOpen ? (
                              <div className="cat-body">
                                {cat.items.map((it) => {
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
                                      <button
                    className={"item-eye" + (isHidden(it.id) ? " hidden" : "")}
                    title={isHidden(it.id) ? "Show item" : "Hide item"}
                    onClick={(e) => { e.stopPropagation(); toggleHidden(it.id); }}
                  >
                    {isHidden(it.id) ? "🚫" : "👁"}
                  </button>
                  <div className="item-name">{it.name}</div>
                                      <div className="item-totals">
                                        <span className="pill">{t.count} ct</span>
                                        <span className="pill">{fmtLen(t.length)}</span>
                                        {it.id !== "unassigned" ? (
                                          <span className="item-actions" onClick={(e) => e.stopPropagation()}>
                                            <button
                                              className="icon-btn"
                                              title={pinnedItemIds.includes(String(it.id)) ? "Unpin from sidebar" : "Pin to sidebar"}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setPinnedItemIds((prev) => {
                                                  const id = String(it.id);
                                                  const has = prev.includes(id);
                                                  return has ? prev.filter((x) => x !== id) : [...prev, id];
                                                });
                                              }}
                                            >
                                              {pinnedItemIds.includes(String(it.id)) ? "📌" : "➕"}
                                            </button>
                                            <button className="icon-btn" title="Edit" onClick={(e) => { e.stopPropagation(); editLibraryItem(it); }}>✎</button>
                                            <button className="icon-btn" title="Delete" onClick={(e) => { e.stopPropagation(); deleteLibraryItem(it); }}>🗑</button>
                                          </span>
                                        ) : null}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
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

<div className={`save-badge ${saveState}`} title={saveDetail}>
  {saveState === "saving" ? "Saving..." :
   saveState === "dirty" ? "Unsaved" :
   saveState === "error" ? "Save failed" :
   saveState === "saved" ? `Saved ${new Date(lastSavedAtRef.current).toLocaleTimeString()}` :
   "Saved"}
</div>

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
                  strokes={visibleStrokes}
                  selectedId={selectedId}
                  searchQuery={pdfFindQuery}
                  searchCmd={pdfFindCmd}
                  searchDir={pdfFindDir}
                  onSearchResults={setPdfFindResults}
                  onSearchMatchInfo={setPdfFindMatchInfo}
                  onSelect={setSelectedId}
                  onCommitStrokes={commitStrokes}
                  onMeasure={(m) => setLastMeasure(m)}
	                  onCalibrated={(nextUnitsPerPx) => {
	                    // End calibration mode no matter what.
	                    setCalibrateMode(false);
	                    setTool("hand");

	                    // nextUnitsPerPx can be null if user cancels / types junk.
	                    if (!Number.isFinite(nextUnitsPerPx) || nextUnitsPerPx <= 0) return;

	                    setUnitsPerPx(nextUnitsPerPx);
	                    setScalePreset("calibrated");
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
                  setCalibrateMode((m) => {
                    const next = !m;
                    setTool(next ? "calibrate" : "pan");
                    return next;
                  });
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
            <button className="tool-btn" onClick={duplicateSelected} disabled={!selectedId}>Duplicate</button>
            <button className="tool-btn" onClick={toggleLockSelected} disabled={!selectedId}>Lock/Unlock</button>
            <button className="tool-btn" onClick={deleteSelected} disabled={!selectedId || getSelectedStroke()?.locked}>Delete</button>
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

        {libPickerOpen ? (
          <div
            className="modal-overlay"
            onClick={() => setLibPickerOpen(false)}
            role="presentation"
          >
            <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
              <div className="modal-head">
                <div style={{ fontWeight: 700 }}>Add from Library</div>
                <button className="icon-btn" onClick={() => setLibPickerOpen(false)} title="Close">✕</button>
              </div>
              <div style={{ padding: 12 }}>
                <input
                  className="search-input"
                  placeholder="Search library…"
                  value={libPickerQuery}
                  onChange={(e) => setLibPickerQuery(e.target.value)}
                />
              </div>
              <div className="modal-body">
                {(() => {
                  const q = (libPickerQuery || "").trim().toLowerCase();
                  const base = items
                    .filter((it) => String(it.id) !== "unassigned")
                    .filter((it) => {
                      if (!q) return true;
                      const name = String(it.name || "").toLowerCase();
                      const sys = String(it.systemType || "").toLowerCase();
                      const cat = String(it.category || "").toLowerCase();
                      return name.includes(q) || sys.includes(q) || cat.includes(q);
                    });

                  // group by systemType -> category
                  const sysMap = new Map();
                  for (const it of base) {
                    const sys = String(it.systemType || "General");
                    const cat = String(it.category || "General");
                    if (!sysMap.has(sys)) sysMap.set(sys, new Map());
                    const catMap = sysMap.get(sys);
                    if (!catMap.has(cat)) catMap.set(cat, []);
                    catMap.get(cat).push(it);
                  }

                  const systems = Array.from(sysMap.keys()).sort((a,b)=>a.localeCompare(b));
                  return (
                    <div style={{ padding: 8 }}>
                      {systems.map((sys) => {
                        const sysKey = `sys:${sys}`;
                        const sysOpen = openSystems[sysKey] ?? true;

                        const catMap = sysMap.get(sys);
                        const cats = Array.from(catMap.keys()).sort((a,b)=>a.localeCompare(b));

                        return (
                          <div key={sysKey} className="accordion">
                            <div
                              className="accordion-head"
                              onClick={() => setOpenSystems((p) => ({ ...p, [sysKey]: !sysOpen }))}
                              role="button"
                              tabIndex={0}
                            >
                              <span style={{ fontWeight: 700 }}>{sys}</span>
                              <span className="muted">{sysOpen ? "▾" : "▸"}</span>
                            </div>

                            {sysOpen ? (
                              <div className="accordion-body">
                                {cats.map((cat) => {
                                  const catKey = `${sysKey}|cat:${cat}`;
                                  const catOpen = openCategories[catKey] ?? true;
                                  const list = catMap.get(cat) || [];
                                  return (
                                    <div key={catKey} style={{ marginBottom: 8 }}>
                                      <div
                                        className="accordion-subhead"
                                        onClick={() => setOpenCategories((p) => ({ ...p, [catKey]: !catOpen }))}
                                        role="button"
                                        tabIndex={0}
                                      >
                                        <span style={{ fontWeight: 600 }}>{cat}</span>
                                        <span className="muted">{catOpen ? "▾" : "▸"}</span>
                                      </div>

                                      {catOpen ? (
                                        <div>
                                          {list.slice(0, 300).map((it) => {
                                            const id = String(it.id);
                                            const pinned = pinnedItemIds.includes(id);
                                            return (
                                              <div
                                                key={id}
                                                className="modal-row"
                                                onClick={() => {
                                                  setPinnedItemIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
                                                  setActiveItemId(id);
                                                  setLibPickerOpen(false);
                                                }}
                                                role="button"
                                                tabIndex={0}
                                                title={it.name}
                                              >
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                  <div className="modal-row-name">{it.name}</div>
                                                  <div className="muted" style={{ fontSize: 12 }}>
                                                    {(it.systemType || "General")} • {(it.category || "General")}
                                                  </div>
                                                </div>
                                                <div className="muted" style={{ fontSize: 12 }}>{pinned ? "Pinned" : ""}</div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div><div className="modal-foot">
                <span className="muted">Tip: pin items you want visible even when totals are zero.</span>
                <button className="btn btn-small" onClick={() => { setShowAllItems(true); setLibPickerOpen(false); }}>Show all</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}