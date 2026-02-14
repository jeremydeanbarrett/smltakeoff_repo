import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Link } from "react-router-dom";

const shell = {
  display: "flex",
  height: "calc(100vh - 88px)",
  gap: 16,
  padding: 16,
};

const card = {
  background: "#fff",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
};

export default function LibrariesPage() {
  const [folders, setFolders] = useState([]);
  const [items, setItems] = useState([]);
  const [activeFolderId, setActiveFolderId] = useState("all");
  const [q, setQ] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [newItem, setNewItem] = useState({ systemType: "", category: "", itemName: "", size: "", unit: "ea", costPerUnit: "" });

  async function reload() {
    const f = await api.listItemFolders();
    const it = await api.listItems();
    const folders = Array.isArray(f) ? f : (Array.isArray(f?.folders) ? f.folders : []);
    const items = Array.isArray(it) ? it : (Array.isArray(it?.items) ? it.items : []);
    setFolders(folders);
    setItems(items);
  }

  useEffect(() => {
    reload();
  }, []);

  const filteredItems = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return (items || [])
      .filter((x) => {
        if (activeFolderId !== "all") {
          const fid = String(x.folder_id ?? "");
          if (fid !== String(activeFolderId)) return false;
        }
        if (!qq) return true;
        const hay = `${x.system_type ?? ""} ${x.category ?? ""} ${x.item_name ?? ""} ${x.size ?? ""}`.toLowerCase();
        return hay.includes(qq);
      })
      .sort((a, b) => String(a.item_name || "").localeCompare(String(b.item_name || "")));
  }, [items, activeFolderId, q]);

  async function addFolder() {
    const name = newFolder.trim();
    if (!name) return;
    await api.createItemFolder({ name });
    setNewFolder("");
    await reload();
  }

  async function addItem() {
    const itemName = (newItem.itemName || "").trim();
    const systemType = (newItem.systemType || "").trim();
    const category = (newItem.category || "").trim();
    const size = (newItem.size || "").trim();
    const unit = String(newItem.unit || "ea").trim() || "ea";
    const costPerUnit = String(newItem.costPerUnit || "").trim();
    if (!itemName) return;

    const folder_id = activeFolderId === "all" ? null : Number(activeFolderId);
    await api.createItem({
      systemType: systemType || "Unassigned",
      category: category || "General",
      itemName,
      size,
      unit,
      costPerUnit: costPerUnit === "" ? 0 : Number(costPerUnit),
      folderId: folder_id,
      folder_id: folder_id,
    });
    setNewItem({ systemType: "", category: "", itemName: "", size: "", unit: "ea", costPerUnit: "" });
    await reload();
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ ...card, padding: 16, marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontWeight: 800 }}>Company Library</div>
        <div style={{ flex: 1 }} />
	        <button
	          onClick={() => {
	            // Simple + reliable: go back to the previous screen (usually Takeoff).
	            // If the user opened Libraries from Projects, this still behaves correctly.
	            window.history.back();
	          }}
	          style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", color: "#111827" }}
	        >
	          ← Back
	        </button>
        <button onClick={async () => {
          try {
            if ((items || []).length > 0) {
              const ok = confirm("This will overwrite your current library items. Continue?");
              if (!ok) return;
              await api.seedItems(true);
            } else {
              await api.seedItems(false);
            }
            await reload();
          } catch (e) {
            alert(e.message || String(e));
          }
        }} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #111827", background: "#111827", color: "#fff" }}>
          Load Starter Library
        </button>
        <Link to="/projects" style={{ textDecoration: "none" }}>
          <span style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #e5e7eb", color: "#111827" }}>
            Projects
          </span>
        </Link>
      </div>

      <div style={shell}>
        {/* Left: folders */}
        <div style={{ ...card, width: 320, padding: 12, overflow: "auto" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <input
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              placeholder="New folder name..."
              style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb" }}
            />
            <button onClick={addFolder} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #111827", background: "#111827", color: "#fff" }}>
              Add
            </button>
          </div>

          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>Items</div>

          <button
            onClick={() => setActiveFolderId("all")}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "10px 12px",
              borderRadius: 10,
              border: activeFolderId === "all" ? "2px solid #3b82f6" : "1px solid #e5e7eb",
              background: "#fff",
              marginBottom: 6,
              cursor: "pointer",
            }}
          >
            All folders
          </button>

          {(folders || []).map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFolderId(String(f.id))}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 10,
                border: String(activeFolderId) === String(f.id) ? "2px solid #3b82f6" : "1px solid #e5e7eb",
                background: "#fff",
                marginBottom: 6,
                cursor: "pointer",
              }}
            >
              {f.name}
            </button>
          ))}
        </div>

        {/* Middle: items */}
        <div style={{ ...card, flex: 1, padding: 12, overflow: "auto" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search library..."
              style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb" }}
            />
            <button
              onClick={reload}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}
            >
              Refresh
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 12 }}>
            <input
              value={newItem.systemType}
              onChange={(e) => setNewItem((s) => ({ ...s, systemType: e.target.value }))}
              placeholder="System (Plumbing/HVAC)"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb" }}
            />
            <input
              value={newItem.category}
              onChange={(e) => setNewItem((s) => ({ ...s, category: e.target.value }))}
              placeholder="Category (Pipe/Fittings)"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb" }}
            />
            <input
              value={newItem.itemName}
              onChange={(e) => setNewItem((s) => ({ ...s, itemName: e.target.value }))}
              placeholder="Item name"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={newItem.size}
                onChange={(e) => setNewItem((s) => ({ ...s, size: e.target.value }))}
                placeholder="Size"
                style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb" }}
              />
              <button onClick={addItem} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #111827", background: "#111827", color: "#fff" }}>
                Add
              </button>
            </div>
          </div>

          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
            Showing {filteredItems.length} item(s)
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filteredItems.map((it) => (
              <div key={it.id} style={{ padding: 12, borderRadius: 12, border: "1px solid #e5e7eb", background: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                      <div style={{ fontWeight: 800 }}>{it.item_name}</div>
                      <div style={{ color: "#6b7280" }}>{it.size || ""}</div>
                    </div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      {it.system_type} • {it.category}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={async () => {
                        const nextName = prompt("Item name:", it.item_name ?? "");
                        if (nextName === null) return;
                        const nextSize = prompt("Size (optional):", it.size ?? "");
                        if (nextSize === null) return;
                        const nextSystem = prompt("System type:", it.system_type ?? "");
                        if (nextSystem === null) return;
                        const nextCat = prompt("Category:", it.category ?? "");
                        if (nextCat === null) return;
                        const nextUnit = prompt("Unit (ea/ft/m/ft^2/m^2):", it.unit ?? "ea");
                        if (nextUnit === null) return;
                        const nextCost = prompt("Cost per unit (number):", String(it.cost_per_unit ?? 0));
                        if (nextCost === null) return;
                        await api.updateItem(it.id, { itemName: nextName, size: nextSize, systemType: nextSystem, category: nextCat, unit: nextUnit, costPerUnit: Number(nextCost) || 0 });
                        await reload();
                      }}
                      style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={async () => {
                        const ok = confirm(`Delete "${it.item_name}"?`);
                        if (!ok) return;
                        await api.deleteItem(it.id);
                        await reload();
                      }}
                      style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ef4444", background: "#fff", cursor: "pointer", color: "#ef4444" }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
