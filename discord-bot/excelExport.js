// Builds an .xlsx workbook from stored records: one sheet with every
// transaction, one sheet with a per-month income/expense/net summary.
const ExcelJS = require("exceljs");

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
const HEADER_FONT = { color: { argb: "FFFFFFFF" }, bold: true };
const MONEY_FMT = '#,##0.00;[Red]-#,##0.00';

function styleHeaderRow(row) {
  row.eachCell(cell => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  row.height = 20;
}

async function buildWorkbook(records, summaryByMonth) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Expense Tracker Discord Bot";
  wb.created = new Date();

  // ---- Sheet 1: all transactions ----
  const sheet = wb.addWorksheet("รายการทั้งหมด", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "วันที่", key: "date", width: 12 },
    { header: "เวลา", key: "time", width: 8 },
    { header: "ประเภท", key: "type", width: 10 },
    { header: "จำนวนเงิน", key: "amount", width: 14 },
    { header: "ร้าน/บุคคล", key: "merchant", width: 26 },
    { header: "หมวดหมู่", key: "category", width: 22 },
    { header: "บันทึก", key: "note", width: 30 },
    { header: "สถานะ", key: "status", width: 14 }
  ];
  styleHeaderRow(sheet.getRow(1));

  records.forEach(r => {
    const row = sheet.addRow({
      date: r.date || "",
      time: r.time || "",
      type: r.type === "income" ? "รายรับ" : "รายจ่าย",
      amount: r.pending ? null : r.amount,
      merchant: r.merchant || "",
      category: r.category || "",
      note: r.note || "",
      status: r.pending ? "⚠️ ยังไม่ระบุยอดเงิน" : "บันทึกแล้ว"
    });
    const amountCell = row.getCell("amount");
    amountCell.numFmt = MONEY_FMT;
    if (!r.pending) {
      amountCell.font = { color: { argb: r.type === "income" ? "FF16A34A" : "FFDC2626" } };
    }
    if (r.pending) {
      row.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } }; });
    }
  });
  sheet.autoFilter = { from: "A1", to: "H1" };

  // ---- Sheet 2: monthly summary ----
  const sumSheet = wb.addWorksheet("สรุปรายเดือน");
  sumSheet.columns = [
    { header: "เดือน", key: "month", width: 12 },
    { header: "รายรับ", key: "income", width: 16 },
    { header: "รายจ่าย", key: "expense", width: 16 },
    { header: "คงเหลือ", key: "net", width: 16 },
    { header: "จำนวนรายการ", key: "count", width: 14 }
  ];
  styleHeaderRow(sumSheet.getRow(1));

  summaryByMonth.forEach(m => {
    const row = sumSheet.addRow(m);
    ["income", "expense", "net"].forEach(k => { row.getCell(k).numFmt = MONEY_FMT; });
    row.getCell("net").font = { color: { argb: m.net < 0 ? "FFDC2626" : "FF16A34A" }, bold: true };
  });

  if (summaryByMonth.length) {
    const totalRow = sumSheet.addRow({
      month: "รวมทั้งหมด",
      income: summaryByMonth.reduce((s, m) => s + m.income, 0),
      expense: summaryByMonth.reduce((s, m) => s + m.expense, 0),
      net: summaryByMonth.reduce((s, m) => s + m.net, 0),
      count: summaryByMonth.reduce((s, m) => s + m.count, 0)
    });
    totalRow.font = { bold: true };
    ["income", "expense", "net"].forEach(k => { totalRow.getCell(k).numFmt = MONEY_FMT; });
    totalRow.eachCell(c => { c.border = { top: { style: "thin" } }; });
  }

  return wb.xlsx.writeBuffer();
}

module.exports = { buildWorkbook };
