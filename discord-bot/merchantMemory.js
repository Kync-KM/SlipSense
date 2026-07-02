// Remembers which category a merchant/person was last corrected to, so the
// next slip from the same merchant gets categorized correctly automatically
// instead of falling back to generic keyword guessing every time.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const MEMORY_FILE = path.join(DATA_DIR, "merchant_memory.json");

function normalizeKey(merchant) {
  return String(merchant || "").trim().toLowerCase();
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(MEMORY_FILE)) fs.writeFileSync(MEMORY_FILE, "{}", "utf8");
}

function loadMemory() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8") || "{}");
  } catch (e) {
    console.error("Failed to read merchant_memory.json, starting fresh:", e.message);
    return {};
  }
}

function saveMemory(memory) {
  ensureStore();
  const tmp = MEMORY_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(memory, null, 2), "utf8");
  fs.renameSync(tmp, MEMORY_FILE);
}

// Look up the remembered category for a merchant name. Returns null if this
// merchant hasn't been seen/corrected before.
function getCategoryForMerchant(merchant) {
  const key = normalizeKey(merchant);
  if (!key) return null;
  const memory = loadMemory();
  return memory[key] ? memory[key].category : null;
}

// Record that this merchant should map to this category from now on. Called
// whenever the user edits a record and sets both a merchant name and category.
function rememberMerchant(merchant, category) {
  const key = normalizeKey(merchant);
  if (!key || !category) return;
  const memory = loadMemory();
  memory[key] = { category, updatedAt: new Date().toISOString() };
  saveMemory(memory);
}

module.exports = { getCategoryForMerchant, rememberMerchant, loadMemory };
