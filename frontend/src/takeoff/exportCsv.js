export function exportTakeoffCsv({ pid, activeFileId, unitSystem, unitLabel, totalsByItem, totalsByItemFile, DEFAULT_ITEMS }) {
  try {
    const NL = String.fromCharCode(10);
    const rows = [];
    const areaLab = unitSystem === "imperial" ? "ft^2" : "m^2";

    // CSV header
    rows.push([
      "Item",
      "Unit",
      "Count",
      `Length (${unitLabel})`,
      `Area (${areaLab})`,
      "CostPerUnit",
      "ExtendedCost",
      "Scope"
    ]);

    const asNum = (v) => (Number(v) || 0);

    const qtyForCost = (it, t) => {
      const u = String(it.unit || "ea").toLowerCase();
      if (u === "ea" || u === "each" || u === "count") return asNum(t.count);
      if (u === "ft" || u === "m" || u === "inch" || u === "in" || u === "mm" || u === "cm") return asNum(t.length);
      if (u.includes("^2") || u.includes("sq") || u === "sqm" || u === "sqft") return asNum(t.area);
      // Fallback
      return asNum(t.count);
    };

    const pushRows = (scope, totals) => {
      for (const it of DEFAULT_ITEMS) {
        const t = totals[it.id] || { count: 0, length: 0, area: 0 };
        const costPer = asNum(it.costPerUnit ?? it.cost_per_unit ?? 0);
        const qty = qtyForCost(it, t);
        const ext = qty * costPer;

        rows.push([
          it.name,
          it.unit || "ea",
          asNum(t.count),
          asNum(t.length).toFixed(3),
          asNum(t.area).toFixed(3),
          costPer ? costPer.toFixed(4) : "",
          costPer ? ext.toFixed(2) : "",
          scope
        ]);
      }
    };

    // Page scope (entire project)
    pushRows("page", totalsByItem || {});
    // File scope (active file)
    pushRows("file", totalsByItemFile || {});

    const esc = (s) => {
      const str = String(s ?? "");
      if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csv = rows.map((r) => r.map(esc).join(",")).join(NL);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `takeoff_${pid}_${activeFileId || "all"}_${stamp}.csv`;

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("exportTakeoffCsv failed", e);
    alert("Export failed. Check console for details.");
  }
}
