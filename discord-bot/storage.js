// Simple single-user JSON-file storage for expense/income records.
// Good enough for personal use; writes are atomic (write temp file, rename)
// to avoid corrupting data.json if the process gets killed mid-write.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "records.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
}

function loadRecords() {
  ensureStore();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw || "[]");
  } catch (e) {
    console.error("Failed to read records.json, starting fresh:", e.message);
    return [];
  }
}

function saveRecords(records) {
  ensureStore();
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function addRecord(fields) {
  const records = loadRecords();
  const rec = {
    id: makeId(),
    type: fields.type || "expense",
    amount: fields.amount ?? null,
    pending: !fields.amount, // needs user confirmation if amount is missing
    date: fields.date || new Date().toISOString().slice(0, 10),
    time: fields.time || "",
    merchant: fields.merchant || "",
    category: fields.category || "อื่นๆ",
    note: fields.note || "",
    messageId: fields.messageId || null,
    channelId: fields.channelId || null,
    createdAt: new Date().toISOString()
  };
  records.push(rec);
  saveRecords(records);
  return rec;
}

function getRecord(id) {
  return loadRecords().find(r => r.id === id) || null;
}

function updateRecord(id, patch) {
  const records = loadRecords();
  const idx = records.findIndex(r => r.id === id);
  if (idx === -1) return null;
  records[idx] = { ...records[idx], ...patch };
  if (patch.amount !== undefined) records[idx].pending = !patch.amount;
  saveRecords(records);
  return records[idx];
}

function deleteRecord(id) {
  const records = loadRecords();
  const next = records.filter(r => r.id !== id);
  const removed = next.length !== records.length;
  if (removed) saveRecords(next);
  return removed;
}

function listRecords({ month } = {}) {
  const records = loadRecords();
  const filtered = month ? records.filter(r => (r.date || "").slice(0, 7) === month) : records;
  return filtered.sort((a, b) =>
    (b.date || "").localeCompare(a.date || "") ||
    (b.time || "").localeCompare(a.time || "") ||
    b.createdAt.localeCompare(a.createdAt)
  );
}

function summary({ month } = {}) {
  const records = listRecords({ month }).filter(r => !r.pending);
  let income = 0, expense = 0;
  const byCategory = {};
  records.forEach(r => {
    if (r.type === "income") income += r.amount;
    else {
      expense += r.amount;
      byCategory[r.category] = (byCategory[r.category] || 0) + r.amount;
    }
  });
  return {
    income,
    expense,
    net: income - expense,
    count: records.length,
    byCategory: Object.entries(byCategory).sort((a, b) => b[1] - a[1])
  };
}

function summaryAllMonths() {
  const records = loadRecords().filter(r => !r.pending);
  const months = Array.from(new Set(records.map(r => (r.date || "").slice(0, 7)))).filter(Boolean).sort();
  return months.map(month => {
    const s = summary({ month });
    return { month, income: s.income, expense: s.expense, net: s.net, count: s.count };
  });
}

module.exports = {
  addRecord, getRecord, updateRecord, deleteRecord, listRecords, summary, summaryAllMonths, loadRecords, DATA_FILE
};
