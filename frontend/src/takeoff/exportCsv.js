export function exportTakeoffCsv({ pid, activeFileId, unitSystem, unitLabel, totalsByItem, totalsByItemFile, DEFAULT_ITEMS }) {
  try {
    const NL = String.fromCharCode(10);
    const rows = [];
    const areaLab = unitSystem === "imperial" ? "ft^2" : "m^2";
    rows.push(["Item","Count",`Length (${unitLabel})`,`Area (${areaLab})`,"Scope"]);

    for (const it of DEFAULT_ITEMS) {
      const t = totalsByItem[it.id] || { count: 0, length: 0, area: 0 };
      rows.push([it.name, t.count || 0, (t.length || 0).toFixed(3), (t.area || 0).toFixed(3), "page"]);
    }
    for (const it of DEFAULT_ITEMS) {
      const t = totalsByItemFile[it.id] || { count: 0, length: 0, area: 0 };
      rows.push([it.name, t.count || 0, (t.length || 0).toFixed(3), (t.area || 0).toFixed(3), "file"]);
    }

    const csv = rows.map(r => r.map(v => {
      const s = String(v ?? "");
      const needsQuotes = s.indexOf('"') !== -1 || s.indexOf(",") !== -1 || s.indexOf(NL) !== -1;
      if (!needsQuotes) return s;
      return '"' + s.replace(/"/g, '""') + '"';
    }).join(",")).join(NL);

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `takeoff_quantities_project_${pid}_file_${activeFileId}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    alert("Export failed. See console.");
  }
}
