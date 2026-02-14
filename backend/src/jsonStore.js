import fs from "fs";
import path from "path";
import crypto from "crypto";

// Simple per-user JSON store. No SQLite, no native builds.
// Stores live in: backend/data/<userId>.json

const baseDir = process.env.SML_DATA_DIR || process.env.DATA_DIR || process.cwd();
const dataDir = path.resolve(baseDir, "data");

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function getUserFilePath(userId) {
  ensureDataDir();
  const safeId = String(userId || "local").replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(dataDir, `${safeId}.json`);
}

function normalizeStore(store) {
  // Ensure expected top-level arrays always exist.
  store.projects = Array.isArray(store.projects) ? store.projects : [];
  store.files = Array.isArray(store.files) ? store.files : [];
  store.items = Array.isArray(store.items) ? store.items : [];
  store.itemFolders = Array.isArray(store.itemFolders) ? store.itemFolders : [];
  store.takeoffs = Array.isArray(store.takeoffs) ? store.takeoffs : [];
  return store;
}

export function readUserStore(userId) {
  const filePath = getUserFilePath(userId);
  if (!fs.existsSync(filePath)) {
    return normalizeStore({ projects: [], files: [], items: [], itemFolders: [], takeoffs: [] });
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return normalizeStore(JSON.parse(raw));
  } catch {
    // If file got corrupted, don't brick the app.
    return normalizeStore({ projects: [], files: [], items: [], itemFolders: [], takeoffs: [] });
  }
}

export function writeUserStore(userId, store) {
  const filePath = getUserFilePath(userId);
  const normalized = normalizeStore(store);
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2));
}

export function withUserStore(userId, fn) {
  const store = readUserStore(userId);
  const result = fn(store);
  writeUserStore(userId, store);
  return result;
}

export function ensureDefaultProjects(userId) {
  return withUserStore(userId, (store) => {
    if (store.projects.length === 0) {
      store.projects.push({
        id: Date.now().toString(),
        name: "My First Project",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // Ensure every project has required fields
    for (const p of store.projects) {
      if (!p.id) p.id = crypto.randomUUID();
      if (!p.createdAt) p.createdAt = new Date().toISOString();
      if (!p.updatedAt) p.updatedAt = p.createdAt;
      if (!p.name) p.name = "Untitled Project";
    }
  });
}


// Ensure the user store has an items array. We don't force-create any items;
// we just normalize the schema so routes can safely read/write.
export function ensureDefaultItems(userId) {
  // Seed a useful starter library if the user's library is empty.
  // This keeps "local" usable out of the box and matches JB's STACK-style expectations.
  ensureDefaultItemFolders(userId);

  const store = readUserStore(userId);
  normalizeStore(store);

  if (!Array.isArray(store.items)) store.items = [];

  if (store.items.length === 0) {
    const folderIdByName = {};
    for (const f of store.itemFolders || []) folderIdByName[f.name] = f.id;

    const nextIdStart =
      store.items.reduce((m, it) => Math.max(m, Number(it.id) || 0), 0) + 1;
    let nextId = nextIdStart;

    const items = [];

    // Plumbing Pipe -> Copper sizes
    const copperSizes = ['1/2"', '3/4"', '1"', '1-1/4"', '1-1/2"', '2"', '3"', '4"'];
    for (const size of copperSizes) {
      items.push({
        id: nextId++,
        system_type: "Plumbing",
        category: "Copper",
        item_name: "Copper",
        size,
        unit: "ft",
        folder_id: folderIdByName["Plumbing Pipe"] || null,
        cost_per_unit: 0,
      });
    }

    // Plumbing Pipe -> DWV / Drains sizes
    const dwvSizes = ['1-1/2"', '2"', '3"', '4"', '6"'];
    for (const size of dwvSizes) {
      items.push({
        id: nextId++,
        system_type: "Plumbing",
        category: "DWV",
        item_name: "DWV",
        size,
        unit: "ft",
        folder_id: folderIdByName["Plumbing Pipe"] || null,
        cost_per_unit: 0,
      });
    }

    // HVAC -> Spiral sizes 4" to 20"
    const spiralSizes = [4,6,8,10,12,14,16,18,20].map(n => `${n}"`);
    for (const size of spiralSizes) {
      items.push({
        id: nextId++,
        system_type: "HVAC",
        category: "Spiral",
        item_name: "Spiral",
        size,
        unit: "ft",
        folder_id: folderIdByName["HVAC"] || null,
        cost_per_unit: 0,
      });
    }

    // Fixtures
    const fixtures = [
      "Toilet",
      "Sink",
      "Lab Sink",
      "Urinal",
      "Water Fountain",
      "Kitchen Sink",
      "Janitor Sink",
      "Mop Sink",
    ];
    for (const name of fixtures) {
      items.push({
        id: nextId++,
        system_type: "Plumbing",
        category: "Fixtures",
        item_name: name,
        size: "",
        unit: "ea",
        folder_id: folderIdByName["Fixtures"] || null,
        cost_per_unit: 0,
      });
    }

    store.items = items;
    writeUserStore(userId, store);
  }
}

export function ensureDefaultItemFolders(userId) {
  const store = readUserStore(userId);
  normalizeStore(store);

  if (store.itemFolders.length === 0) {
    const names = [
      "Assembly Items",
      "Electrical",
      "Equipment",
      "Fixtures",
      "Hangers / Supports",
      "HVAC",
      "Plumbing Fittings",
      "Plumbing Pipe",
      "Valves",
      "Watts slab",
    ];

    store.itemFolders = names.map((name, idx) => ({
      id: idx + 1,
      name,
      parentId: null,
    }));

    writeUserStore(userId, store);
  }
}
