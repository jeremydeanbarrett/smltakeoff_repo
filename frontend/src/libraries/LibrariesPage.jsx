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
  const [newItem, setNewItem] = useState({ systemType: "", category: "", itemName: "", size: "" });

  async function reload() {
    const f = await api.listItemFolders();
    const it = await api.listItems();
    setFolders(Array.isArray(f?.folders) ? f.folders : []);
    setItems(Array.isArray(it?.items) ? it.items : []);
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
    if (!itemName) return;

    const folder_id = activeFolderId === "all" ? null : Number(activeFolderId);
    await api.createItem({
      systemType: systemType || "Unassigned",
      category: category || "General",
      itemName,
      size,
      folderId: folder_id,
      folder_id: folder_id,
    });
    setNewItem({ systemType: "", category: "", itemName: "", size: "" });
    await reload();
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ ...card, padding: 16, marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontWeight: 800 }}>Company Library</div>
        <div style={{ flex: 1 }} />
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
                <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                  <div style={{ fontWeight: 800 }}>{it.item_name}</div>
                  <div style={{ color: "#6b7280" }}>{it.size || ""}</div>
                </div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  {it.system_type} • {it.category}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
