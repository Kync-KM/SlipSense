// Parses OCR text from Thai bank transfer slips / receipts into a structured
// record: { amount, date, time, merchant, category, type, note }.
// Ported from the web-app version (expense-tracker.html) — same logic, no DOM.

function pad(n) { return String(n).padStart(2, "0"); }

// Tesseract frequently outputs SARA AM (ำ) decomposed as NIKHAHIT + SARA AA
// (ํ + า). Recompose it so keyword regexes (สำเร็จ, บันทึกช่วยจำ, ...) match reliably.
function fixThaiText(text) {
  if (!text) return "";
  return text.replace(/ํา/g, "ำ");
}

// Longest run of Thai characters in a line, allowing single spaces between
// words (so "นาย นิติกร เขียวปั้น" stays together) but treating bigger gaps as
// boundaries so garbled Latin/number noise glued on by OCR gets dropped.
function longestThaiRun(line) {
  if (!line) return "";
  const re = /[ก-๙]+(?: [ก-๙]+)*/g;
  let m, best = "";
  while ((m = re.exec(line))) {
    if (m[0].length > best.length) best = m[0];
  }
  return best.trim();
}

const THAI_MONTHS = {
  "มกราคม": 1, "ม.ค": 1, "กุมภาพันธ์": 2, "ก.พ": 2, "มีนาคม": 3, "มี.ค": 3,
  "เมษายน": 4, "เม.ย": 4, "พฤษภาคม": 5, "พ.ค": 5, "มิถุนายน": 6, "มิ.ย": 6,
  "กรกฎาคม": 7, "ก.ค": 7, "สิงหาคม": 8, "ส.ค": 8, "กันยายน": 9, "ก.ย": 9,
  "ตุลาคม": 10, "ต.ค": 10, "พฤศจิกายน": 11, "พ.ย": 11, "ธันวาคม": 12, "ธ.ค": 12
};

function monthLookup(raw) {
  const norm = raw.replace(/\./g, "").trim();
  for (const key in THAI_MONTHS) {
    if (key.replace(/\./g, "") === norm) return THAI_MONTHS[key];
  }
  for (const key in THAI_MONTHS) {
    const k = key.replace(/\./g, "");
    if (norm.startsWith(k) || k.startsWith(norm)) return THAI_MONTHS[key];
  }
  return null;
}

const CATEGORY_MAP = [
  [["7-11", "เซเว่น", "7-eleven", "เซเว่นอีเลฟเว่น"], "ร้านสะดวกซื้อ/ซูเปอร์มาร์เก็ต"],
  [["lotus", "โลตัส", "บิ๊กซี", "big c", "tops", "ท็อปส์", "แม็คโคร", "makro"], "ร้านสะดวกซื้อ/ซูเปอร์มาร์เก็ต"],
  [["grab", "bolt", "taxi", "แท็กซี่", "bts", "mrt", "วิน", "มอเตอร์ไซค์", "airasia", "น้ำมัน", "ปตท", "ปั๊ม"], "เดินทาง"],
  [["foodpanda", "lineman", "line man", "ร้านอาหาร", "ก๋วยเตี๋ยว", "ส้มตำ", "ข้าว", "คาเฟ่", "coffee", "กาแฟ", "ชานม",
    "ตามสั่ง", "กะเพรา", "ผัดกะเพรา", "ข้าวผัด", "ต้มยำ", "แกง", "อาหารตามสั่ง"], "อาหาร/เครื่องดื่ม"],
  [["ais", "true", "dtac", "เติมเงิน", "เน็ต", "อินเทอร์เน็ต"], "ค่าโทรศัพท์/อินเทอร์เน็ต"],
  [["การไฟฟ้า", "การประปา", "ค่าน้ำ", "ค่าไฟ"], "ค่าน้ำค่าไฟ/สาธารณูปโภค"],
  [["โรงพยาบาล", "ร้านยา", "คลินิก", "hospital", "pharmacy"], "สุขภาพ"],
  [["เงินเดือน", "salary", "โบนัส"], "เงินเดือน/รายรับ"],
  [["โอนเงิน", "พร้อมเพย์", "promptpay", "transfer", "รหัสอ้างอิง", "เลขที่รายการ"], "โอนเงิน"]
];

const CATEGORY_OPTIONS = [
  "อาหาร/เครื่องดื่ม", "ร้านสะดวกซื้อ/ซูเปอร์มาร์เก็ต", "เดินทาง", "ค่าน้ำค่าไฟ/สาธารณูปโภค",
  "ค่าโทรศัพท์/อินเทอร์เน็ต", "ช้อปปิ้ง", "สุขภาพ", "เงินเดือน/รายรับ", "โอนเงิน", "อื่นๆ"
];

function guessCategory(text) {
  const lower = text.toLowerCase();
  for (const [keywords, cat] of CATEGORY_MAP) {
    if (keywords.some(k => lower.includes(k.toLowerCase()))) return cat;
  }
  return "อื่นๆ";
}

function extractNumbersLoose(str) {
  const moneyRegex = /(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/g;
  const found = str.match(moneyRegex) || [];
  return found
    .map(f => ({ raw: f, val: parseFloat(f.replace(/,/g, "")) }))
    .filter(o => !isNaN(o.val) && o.val > 0 && o.val < 10000000)
    // reject lone single-digit noise picked up from garbled OCR (e.g. a stray
    // "1" or "2") unless it's a proper decimal amount like "5.00"
    .filter(o => o.raw.includes(".") || o.val >= 10)
    .map(o => o.val);
}

// Stricter matcher (requires a proper X.XX decimal) used for low-trust fallback
// scans, so stray digits picked up from garbled OCR noise don't get treated as
// a confident amount.
function extractNumbersStrict(str) {
  const moneyRegex = /(\d{1,3}(?:,\d{3})*\.\d{2})/g;
  const found = str.match(moneyRegex) || [];
  return found.map(f => parseFloat(f.replace(/,/g, ""))).filter(n => !isNaN(n) && n > 0 && n < 10000000);
}

function findAmount(lines, fullText) {
  const labelRegex = /จำนวนเงิน|จำนวน[:\s]|จำนวน$|รวมทั้งสิ้น|รวมสุทธิ|^รวม\b|total|amount/i;
  const feeRegex = /ค่าธรรมเนียม|fee/i;
  let candidates = [];
  for (let i = 0; i < lines.length; i++) {
    if (labelRegex.test(lines[i]) && !feeRegex.test(lines[i])) {
      let nums = extractNumbersLoose(lines[i]);
      if (nums.length === 0 && lines[i + 1] && !feeRegex.test(lines[i + 1])) nums = extractNumbersLoose(lines[i + 1]);
      if (nums.length === 0 && lines[i + 2] && !feeRegex.test(lines[i + 2])) nums = extractNumbersLoose(lines[i + 2]);
      candidates = candidates.concat(nums);
    }
  }
  if (candidates.length === 0) {
    lines.forEach(l => {
      if (/บาท|฿/.test(l) && !feeRegex.test(l)) candidates = candidates.concat(extractNumbersStrict(l));
    });
  }
  if (candidates.length === 0) candidates = extractNumbersStrict(fullText);
  return candidates.length ? Math.max(...candidates) : null;
}

function extractDate(text) {
  // numeric dd/mm/yyyy (or yy)
  let m = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let d = +m[1], mo = +m[2], y = +m[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      if (y < 100) y = 2500 + y;
      if (y > 2400) y -= 543;
      return `${y}-${pad(mo)}-${pad(d)}`;
    }
  }
  // thai month name, e.g. "2 ก.ค. 69"
  m = text.match(/(\d{1,2})\s*([ก-๙.]{2,10})\s*(\d{2,4})/);
  if (m) {
    const mo = monthLookup(m[2]);
    let d = +m[1], y = +m[3];
    if (mo && d >= 1 && d <= 31) {
      if (y < 100) y = 2500 + y;
      if (y > 2400) y -= 543;
      return `${y}-${pad(mo)}-${pad(d)}`;
    }
  }
  return null;
}

function extractTime(text) {
  let m = text.match(/([01]?\d|2[0-3])[:.]([0-5]\d)/);
  if (m) return `${pad(+m[1])}:${m[2]}`;
  // OCR sometimes drops the separator, e.g. "1424 น." meaning 14:24 น.
  m = text.match(/(\d{3,4})\s*น/);
  if (m) {
    const digits = m[1];
    const hh = digits.length === 4 ? digits.slice(0, 2) : digits.slice(0, 1);
    const mm = digits.length === 4 ? digits.slice(2) : digits.slice(1);
    const h = +hh, mnum = +mm;
    if (h >= 0 && h <= 23 && mnum >= 0 && mnum <= 59) return `${pad(h)}:${pad(mnum)}`;
  }
  return null;
}

function extractMemo(text) {
  const m = text.match(/บันทึกช่วยจำ[:\s]*([^\n]*)/);
  if (m) {
    let val = (m[1] || "").trim();
    if (!val) {
      const idx = text.indexOf("บันทึกช่วยจำ");
      const after = text.slice(idx).split(/\r?\n/);
      if (after[1]) val = after[1].trim();
    }
    return val;
  }
  return "";
}

function extractMerchant(lines, docType, boundaryIdx) {
  // 1) explicit keyword line, e.g. "ไปยัง", "ไปที่"
  const toIdx = lines.findIndex(l => /ไปยัง|ไปที่|ผู้รับโอน|ชื่อผู้รับ/.test(l));
  if (toIdx !== -1) {
    const after = (lines[toIdx].split(/ไปยัง|ไปที่|ผู้รับโอน|ชื่อผู้รับ/)[1] || "").trim();
    const cand = after || longestThaiRun(lines[toIdx + 1] || "");
    if (cand) return cand.replace(/[:：]/g, "").trim().slice(0, 60);
  }
  // 2) plain itemized receipt: shop name usually on first line
  if (docType === "receipt" && lines.length > 0) {
    const cand = longestThaiRun(lines[0]) || lines[0];
    return cand.replace(/[:：]/g, "").trim().slice(0, 60);
  }
  // 3) transfer/payment slip without explicit keyword: heuristic scan.
  const isDateTimeLine = l => /\d{1,2}[:.]\d{2}/.test(l) ||
    /\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/.test(l) ||
    /\d{1,2}\s*[ก-๙.]{2,10}\s*\d{2,4}/.test(l);
  const isTitleLine = l => /สำเร็จ|k\s?\+|kplus/i.test(l);
  const isBankLine = l => /^ธ\.|ธนาคาร|bank|promptpay|พร้อมเพย์/i.test(l);
  const isMaskLine = l => /x{2,}/i.test(l);
  const isPureDigits = l => /^\d{6,}$/.test(l);

  const titleRegex = /^(นาย|นาง|นางสาว|น\.ส\.|คุณ)/;
  const titled = [];
  const untitled = [];
  lines.slice(0, boundaryIdx).forEach(l => {
    if (l.length < 2 || isDateTimeLine(l) || isTitleLine(l) || isBankLine(l) || isMaskLine(l) || isPureDigits(l)) return;
    const thai = longestThaiRun(l);
    if (thai.length < 2) return;
    if (titleRegex.test(thai)) titled.push(thai); else untitled.push(thai);
  });
  const merchant = untitled.length ? untitled[untitled.length - 1] : (titled.length ? titled[titled.length - 1] : "");
  return merchant.replace(/[:：]/g, "").trim().slice(0, 60);
}

function analyzeText(rawText) {
  const result = { amount: null, date: null, time: null, merchant: "", category: "อื่นๆ", type: "expense", note: "" };
  if (!rawText) return result;
  const text = fixThaiText(rawText);
  const lower = text.toLowerCase();

  const transferKeywords = ["โอนเงิน", "รหัสอ้างอิง", "เลขที่รายการ", "promptpay", "บัญชีปลายทาง", "ผู้รับโอน",
    "transfer", "สแกนจ่าย", "จากบัญชี", "ไปยัง", "ชำระเงินสำเร็จ", "จ่ายบิลสำเร็จ", "เติมเงินสำเร็จ"];
  const receiptKeywords = ["ใบเสร็จ", "รวมทั้งสิ้น", "จำนวนเงินรวม", "vat", "ภาษีมูลค่าเพิ่ม", "tax invoice", "เงินทอน", "ใบกำกับภาษี"];
  const transferScore = transferKeywords.filter(k => lower.includes(k)).length;
  const receiptScore = receiptKeywords.filter(k => lower.includes(k)).length;
  const docType = transferScore >= receiptScore && transferScore > 0 ? "transfer" : "receipt";

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  result.amount = findAmount(lines, text);
  result.date = extractDate(text);
  result.time = extractTime(text);

  const boundaryIdx = (() => {
    const idx = lines.findIndex(l => /เลขที่รายการ|รหัสอ้างอิง|จำนวนเงิน|^จำนวน\b|รวมทั้งสิ้น|ค่าธรรมเนียม/i.test(l));
    return idx === -1 ? lines.length : idx;
  })();
  result.merchant = extractMerchant(lines, docType, boundaryIdx);

  const memo = extractMemo(text);
  result.note = memo || "";

  result.category = guessCategory(text + " " + memo);
  result.type = "expense"; // default; user can flip via the ✏️ / 🔄 buttons

  return result;
}

module.exports = { analyzeText, CATEGORY_OPTIONS, fixThaiText };
