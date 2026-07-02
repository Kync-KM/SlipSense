require("dotenv").config();
const path = require("path");
const {
  Client, GatewayIntentBits, Partials, Events,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  AttachmentBuilder
} = require("discord.js");
const { createWorker } = require("tesseract.js");
const { preprocessImage } = require("./preprocess");
const { analyzeText, CATEGORY_OPTIONS, guessCategory } = require("./parser");
const storage = require("./storage");
const { buildWorkbook } = require("./excelExport");
const merchantMemory = require("./merchantMemory");
const { setupBackup, runBackup } = require("./backup");

const OWNER_ID = process.env.OWNER_ID || null;

if (!process.env.DISCORD_TOKEN) {
  console.error("ไม่พบ DISCORD_TOKEN ใน .env — ดูวิธีตั้งค่าใน README.md");
  process.exit(1);
}
if (!OWNER_ID) {
  console.warn("⚠️  ไม่ได้ตั้งค่า OWNER_ID ใน .env — บอทจะประมวลผลรูปจากทุกคนที่ทักมา แนะนำให้ตั้งค่าเพื่อความเป็นส่วนตัว");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message]
});

// ---------- OCR worker (created once, reused for every image — much faster
// and lighter on a small VPS than spinning up a new worker per image) ----------
let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("tha+eng", 1, {
      cachePath: path.join(__dirname, "tessdata"),
      logger: () => {}
    });
  }
  return workerPromise;
}

// ---------- Simple queue so images are processed one at a time (keeps memory
// usage predictable on a small VPS) ----------
let queue = Promise.resolve();
function enqueue(task) {
  const result = queue.then(task, task);
  queue = result.then(() => {}, () => {});
  return result;
}

// ---------- UI builders ----------
function fmtMoney(n) {
  return Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildRecordUI(rec) {
  const pending = !rec.amount;
  const embed = new EmbedBuilder()
    .setColor(rec.possibleDuplicate ? 0xea580c : pending ? 0xf59e0b : (rec.type === "income" ? 0x16a34a : 0xdc2626))
    .setTitle(
      rec.possibleDuplicate ? "⚠️ บันทึกแล้ว (ดูเหมือนจะซ้ำกับรายการที่มีอยู่)" :
      pending ? "⚠️ บันทึกแล้ว (ต้องกรอกยอดเงินเอง)" : "✅ บันทึกแล้ว"
    )
    .addFields(
      { name: "ประเภท", value: rec.type === "income" ? "🟢 รายรับ" : "🔴 รายจ่าย", inline: true },
      { name: "จำนวนเงิน", value: pending ? "❓ อ่านไม่ได้ กดปุ่มแก้ไข" : `${fmtMoney(rec.amount)} บาท`, inline: true },
      { name: "วันที่/เวลา", value: `${rec.date || "-"}${rec.time ? " " + rec.time + " น." : ""}`, inline: true },
      { name: "ร้าน/บุคคล", value: rec.merchant || "-", inline: true },
      { name: "หมวดหมู่", value: rec.category || "-", inline: true }
    );
  if (rec.possibleDuplicate) {
    embed.addFields({
      name: "⚠️ คำเตือน",
      value: "มีรายการ วันที่/ยอดเงิน/ร้านตรงกันอยู่แล้ว เช็คดูก่อนว่าไม่ได้ส่งสลิปใบเดิมซ้ำ (กด 🗑️ ลบได้ถ้าซ้ำจริง)"
    });
  }
  if (rec.note) embed.addFields({ name: "บันทึกช่วยจำ", value: rec.note.slice(0, 1000) });
  embed.setFooter({ text: `ID: ${rec.id}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`edit:${rec.id}`).setLabel("แก้ไข").setEmoji("✏️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`toggle:${rec.id}`).setLabel("สลับรายรับ/รายจ่าย").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`delete:${rec.id}`).setLabel("ลบ").setEmoji("🗑️").setStyle(ButtonStyle.Danger)
  );
  return { embed, components: [row] };
}

function buildEditModal(rec) {
  const modal = new ModalBuilder().setCustomId(`editmodal:${rec.id}`).setTitle("แก้ไขรายการ");

  const amountInput = new TextInputBuilder()
    .setCustomId("amount").setLabel("จำนวนเงิน (บาท)").setStyle(TextInputStyle.Short)
    .setValue(rec.amount ? String(rec.amount) : "").setRequired(true);
  const dateInput = new TextInputBuilder()
    .setCustomId("date").setLabel("วันที่ (YYYY-MM-DD)").setStyle(TextInputStyle.Short)
    .setValue(rec.date || "").setRequired(true);
  const merchantInput = new TextInputBuilder()
    .setCustomId("merchant").setLabel("ร้าน/บุคคล").setStyle(TextInputStyle.Short)
    .setValue(rec.merchant || "").setRequired(false);
  const categoryInput = new TextInputBuilder()
    .setCustomId("category").setLabel("หมวดหมู่").setStyle(TextInputStyle.Short)
    .setValue(rec.category || "อื่นๆ")
    .setPlaceholder("อาหาร/เครื่องดื่ม, เดินทาง, โอนเงิน, อื่นๆ ...")
    .setRequired(false);
  const noteInput = new TextInputBuilder()
    .setCustomId("note").setLabel("บันทึกช่วยจำ").setStyle(TextInputStyle.Paragraph)
    .setValue(rec.note || "").setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(amountInput),
    new ActionRowBuilder().addComponents(dateInput),
    new ActionRowBuilder().addComponents(merchantInput),
    new ActionRowBuilder().addComponents(categoryInput),
    new ActionRowBuilder().addComponents(noteInput)
  );
  return modal;
}

// ---------- Image -> OCR -> parse -> auto-save ----------
async function processSlip(message, attachment) {
  const processingMsg = await message.reply({ content: "🔎 กำลังอ่านสลิป..." }).catch(() => null);
  try {
    const res = await fetch(attachment.url);
    if (!res.ok) throw new Error(`ดาวน์โหลดรูปไม่สำเร็จ (HTTP ${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());

    const processed = await preprocessImage(buffer);
    const worker = await getWorker();
    const { data: { text } } = await worker.recognize(processed);
    const parsed = analyzeText(text);

    // If we've seen this merchant before and the user corrected its category,
    // trust that over the generic keyword guess.
    const rememberedCategory = merchantMemory.getCategoryForMerchant(parsed.merchant);
    const category = rememberedCategory || parsed.category;

    const date = parsed.date || new Date().toISOString().slice(0, 10);
    const dup = storage.findPotentialDuplicate({ date, amount: parsed.amount, merchant: parsed.merchant });

    const rec = storage.addRecord({
      type: parsed.type,
      amount: parsed.amount,
      date,
      time: parsed.time || "",
      merchant: parsed.merchant,
      category,
      note: parsed.note,
      possibleDuplicate: !!dup,
      messageId: message.id,
      channelId: message.channel.id
    });

    const { embed, components } = buildRecordUI(rec);
    if (processingMsg) await processingMsg.edit({ content: null, embeds: [embed], components });
    else await message.reply({ embeds: [embed], components });
  } catch (err) {
    console.error("OCR/parse failed:", err);
    const errMsg = "❌ อ่านสลิปไม่สำเร็จ ลองส่งใหม่อีกครั้ง (รูปอาจไม่ชัด หรือไฟล์ใหญ่เกินไป)";
    if (processingMsg) await processingMsg.edit({ content: errMsg }).catch(() => {});
    else await message.reply({ content: errMsg }).catch(() => {});
  }
}

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;
    if (OWNER_ID && message.author.id !== OWNER_ID) return;

    const imageAttachments = [...message.attachments.values()]
      .filter(a => (a.contentType || "").startsWith("image/"));
    if (imageAttachments.length === 0) return;

    for (const att of imageAttachments) {
      await enqueue(() => processSlip(message, att));
    }
  } catch (err) {
    console.error("messageCreate handler error:", err);
  }
});

// ---------- Buttons / Modal / Slash commands ----------
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (OWNER_ID && interaction.user.id !== OWNER_ID) {
      if (interaction.isRepliable()) {
        await interaction.reply({ content: "บอทนี้ใช้ได้เฉพาะเจ้าของเท่านั้นครับ", ephemeral: true });
      }
      return;
    }

    if (interaction.isButton()) {
      const [action, id] = interaction.customId.split(":");
      const rec = storage.getRecord(id);
      if (!rec) {
        await interaction.reply({ content: "ไม่พบรายการนี้แล้ว (อาจถูกลบไปแล้ว)", ephemeral: true });
        return;
      }
      if (action === "edit") {
        await interaction.showModal(buildEditModal(rec));
      } else if (action === "toggle") {
        const updated = storage.updateRecord(id, { type: rec.type === "income" ? "expense" : "income" });
        const { embed, components } = buildRecordUI(updated);
        await interaction.update({ embeds: [embed], components });
      } else if (action === "delete") {
        storage.deleteRecord(id);
        await interaction.update({ content: "🗑️ ลบรายการนี้แล้ว", embeds: [], components: [] });
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      const [action, id] = interaction.customId.split(":");
      if (action !== "editmodal") return;

      const existing = storage.getRecord(id);
      if (!existing) {
        await interaction.reply({ content: "ไม่พบรายการนี้แล้ว", ephemeral: true });
        return;
      }

      const amountRaw = interaction.fields.getTextInputValue("amount").trim();
      const dateRaw = interaction.fields.getTextInputValue("date").trim();
      const merchantRaw = interaction.fields.getTextInputValue("merchant").trim();
      const categoryRaw = interaction.fields.getTextInputValue("category").trim();
      const noteRaw = interaction.fields.getTextInputValue("note").trim();

      const amountParsed = parseFloat(amountRaw.replace(/,/g, ""));
      const finalDate = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : existing.date;
      const finalAmount = !isNaN(amountParsed) && amountParsed > 0 ? amountParsed : null;
      const patch = {
        amount: finalAmount,
        date: finalDate,
        merchant: merchantRaw,
        category: categoryRaw || "อื่นๆ",
        note: noteRaw,
        possibleDuplicate: !!storage.findPotentialDuplicate({
          date: finalDate, amount: finalAmount, merchant: merchantRaw, excludeId: id
        })
      };
      const updated = storage.updateRecord(id, patch);

      // Learn this merchant -> category mapping for next time, so future
      // slips from the same place get categorized correctly automatically.
      if (merchantRaw && patch.category) merchantMemory.rememberMerchant(merchantRaw, patch.category);

      const { embed, components } = buildRecordUI(updated);
      await interaction.update({ embeds: [embed], components });
      return;
    }

    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
      return;
    }
  } catch (err) {
    console.error("interactionCreate handler error:", err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "เกิดข้อผิดพลาด ลองใหม่อีกครั้งครับ", ephemeral: true }).catch(() => {});
    }
  }
});

async function handleSlashCommand(interaction) {
  const cmd = interaction.commandName;

  if (cmd === "summary") {
    const month = interaction.options.getString("month") || new Date().toISOString().slice(0, 7);
    const s = storage.summary({ month });
    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle(`สรุปยอดเดือน ${month}`)
      .addFields(
        { name: "รายรับ", value: `${fmtMoney(s.income)} บาท`, inline: true },
        { name: "รายจ่าย", value: `${fmtMoney(s.expense)} บาท`, inline: true },
        { name: "คงเหลือ", value: `${fmtMoney(s.net)} บาท`, inline: true }
      );
    if (s.byCategory.length) {
      embed.addFields({
        name: "แยกตามหมวดหมู่ (รายจ่าย)",
        value: s.byCategory.map(([cat, amt]) => `${cat}: ${fmtMoney(amt)} บาท`).join("\n").slice(0, 1024)
      });
    }
    const pendingCount = storage.listRecords({ month }).filter(r => r.pending).length;
    if (pendingCount) embed.setFooter({ text: `⚠️ มี ${pendingCount} รายการที่ยังไม่ได้กรอกยอดเงิน (ไม่ถูกรวมในสรุปนี้)` });
    await interaction.reply({ embeds: [embed] });

  } else if (cmd === "list") {
    const month = interaction.options.getString("month");
    const count = Math.min(25, Math.max(1, interaction.options.getInteger("count") || 10));
    const records = storage.listRecords(month ? { month } : {}).slice(0, count);
    if (records.length === 0) {
      await interaction.reply({ content: "ยังไม่มีรายการ", ephemeral: true });
      return;
    }
    const lines = records.map(r => {
      const sign = r.type === "income" ? "🟢+" : "🔴-";
      const amt = r.pending ? "❓ยังไม่ระบุ" : `${fmtMoney(r.amount)} บาท`;
      return `${sign}${amt} • ${r.date}${r.time ? " " + r.time : ""} • ${r.merchant || r.category}`;
    });
    const embed = new EmbedBuilder().setColor(0x2563eb).setTitle("รายการล่าสุด")
      .setDescription(lines.join("\n").slice(0, 4000));
    await interaction.reply({ embeds: [embed] });

  } else if (cmd === "export") {
    const format = interaction.options.getString("format") || "excel";
    const records = storage.listRecords();
    if (records.length === 0) {
      await interaction.reply({ content: "ยังไม่มีรายการให้ export", ephemeral: true });
      return;
    }
    await interaction.deferReply();
    const today = new Date().toISOString().slice(0, 10);

    if (format === "csv") {
      const header = ["วันที่", "เวลา", "ประเภท", "จำนวนเงิน", "ร้าน/บุคคล", "หมวดหมู่", "บันทึก"];
      const rows = records.map(r => [
        r.date, r.time || "", r.type === "income" ? "รายรับ" : "รายจ่าย",
        r.pending ? "" : r.amount, r.merchant, r.category, (r.note || "").replace(/\n/g, " ")
      ]);
      const csv = [header, ...rows].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      const buf = Buffer.from("﻿" + csv, "utf8");
      const attachment = new AttachmentBuilder(buf, { name: `expense-${today}.csv` });
      await interaction.editReply({ files: [attachment] });
    } else {
      const buf = await buildWorkbook(records, storage.summaryAllMonths());
      const attachment = new AttachmentBuilder(Buffer.from(buf), { name: `expense-${today}.xlsx` });
      await interaction.editReply({ content: "📊 ไฟล์ Excel (ชีต \"รายการทั้งหมด\" + \"สรุปรายเดือน\")", files: [attachment] });
    }

  } else if (cmd === "delete_last") {
    const records = storage.listRecords();
    if (records.length === 0) {
      await interaction.reply({ content: "ยังไม่มีรายการ", ephemeral: true });
      return;
    }
    const last = records[0];
    storage.deleteRecord(last.id);
    await interaction.reply({ content: `ลบรายการล่าสุดแล้ว: ${last.merchant || last.category} (${last.amount ?? "?"} บาท)` });

  } else if (cmd === "add") {
    const amount = interaction.options.getNumber("amount");
    const type = interaction.options.getString("type") || "expense";
    const merchant = interaction.options.getString("merchant") || "";
    const dateOpt = interaction.options.getString("date") || "";
    const noteOpt = interaction.options.getString("note") || "";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateOpt) ? dateOpt : new Date().toISOString().slice(0, 10);

    if (!amount || amount <= 0) {
      await interaction.reply({ content: "กรุณาใส่จำนวนเงินให้ถูกต้อง (มากกว่า 0)", ephemeral: true });
      return;
    }

    const rememberedCategory = merchantMemory.getCategoryForMerchant(merchant);
    const category = interaction.options.getString("category") || rememberedCategory ||
      (merchant ? guessCategory(merchant) : "อื่นๆ") || "อื่นๆ";

    const dup = storage.findPotentialDuplicate({ date, amount, merchant });
    const rec = storage.addRecord({ type, amount, date, merchant, category, note: noteOpt, possibleDuplicate: !!dup });

    if (merchant && category) merchantMemory.rememberMerchant(merchant, category);

    const { embed, components } = buildRecordUI(rec);
    await interaction.reply({ embeds: [embed], components });

  } else if (cmd === "backup_now") {
    if (!process.env.BACKUP_CHANNEL_ID) {
      await interaction.reply({ content: "ยังไม่ได้ตั้งค่า BACKUP_CHANNEL_ID ใน .env ครับ", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      await runBackup(interaction.client, process.env.BACKUP_CHANNEL_ID);
      await interaction.editReply({ content: "สำรองข้อมูลเรียบร้อยแล้ว ✅" });
    } catch (err) {
      console.error("backup_now failed:", err);
      await interaction.editReply({ content: `สำรองข้อมูลไม่สำเร็จ: ${err.message}` });
    }
  }
}

client.once(Events.ClientReady, (c) => {
  console.log(`✅ บอทออนไลน์แล้ว: ${c.user.tag}`);
  console.log(`   ข้อมูลบันทึกอยู่ที่: ${storage.DATA_FILE}`);
  if (OWNER_ID) console.log(`   ประมวลผลรูปจาก user ID: ${OWNER_ID} เท่านั้น`);
  setupBackup(client);
});

process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));

client.login(process.env.DISCORD_TOKEN);
