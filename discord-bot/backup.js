// Sends a backup of data/records.json (and merchant_memory.json) to a
// private Discord channel every few days, scheduled with node-cron. Prevents
// total data loss if the VPS disk dies since this is otherwise a single local
// JSON file.
const cron = require("node-cron");
const path = require("path");
const fs = require("fs");
const { AttachmentBuilder } = require("discord.js");
const storage = require("./storage");

function setupBackup(client) {
  const channelId = process.env.BACKUP_CHANNEL_ID;
  if (!channelId) {
    console.warn("⚠️  ไม่ได้ตั้งค่า BACKUP_CHANNEL_ID ใน .env — จะไม่มีการสำรองข้อมูลอัตโนมัติ");
    return;
  }
  const cronExpr = process.env.BACKUP_CRON || "0 0 */3 * *"; // default: เที่ยงคืน ทุก 3 วัน (server time)

  cron.schedule(cronExpr, () => runBackup(client, channelId));
  console.log(`   ตั้งเวลาสำรองข้อมูลอัตโนมัติ: "${cronExpr}" -> channel ${channelId}`);
}

async function runBackup(client, channelId) {
  const channel = await client.channels.fetch(channelId);
  if (!channel) throw new Error("ไม่พบ channel สำหรับสำรองข้อมูล (เช็ค BACKUP_CHANNEL_ID ให้ถูกต้อง)");

  const today = new Date().toISOString().slice(0, 10);
  const files = [];
  if (fs.existsSync(storage.DATA_FILE)) {
    files.push(new AttachmentBuilder(storage.DATA_FILE, { name: `records-${today}.json` }));
  }
  const memoryFile = path.join(__dirname, "data", "merchant_memory.json");
  if (fs.existsSync(memoryFile)) {
    files.push(new AttachmentBuilder(memoryFile, { name: `merchant_memory-${today}.json` }));
  }
  if (files.length === 0) {
    throw new Error("ไม่มีไฟล์ข้อมูลให้สำรอง (ยังไม่มีรายการบันทึกเลย)");
  }

  const records = storage.loadRecords();
  await channel.send({
    content: `🗄️ สำรองข้อมูลประจำวันที่ ${today} (${records.length} รายการทั้งหมด)`,
    files
  });
}

module.exports = { setupBackup, runBackup };
