// Registers slash commands with Discord. Run this once (and again whenever
// you change command definitions): npm run deploy-commands
require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("summary")
    .setDescription("สรุปยอดรายรับ-รายจ่าย")
    .addStringOption(opt =>
      opt.setName("month")
        .setDescription("เดือนที่ต้องการดู เช่น 2026-07 (ไม่ใส่ = เดือนนี้)")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("list")
    .setDescription("แสดงรายการล่าสุด")
    .addStringOption(opt =>
      opt.setName("month")
        .setDescription("เดือนที่ต้องการดู เช่น 2026-07 (ไม่ใส่ = ทุกเดือน)")
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt.setName("count")
        .setDescription("จำนวนรายการ (ค่าเริ่มต้น 10, สูงสุด 25)")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("export")
    .setDescription("ส่งออกรายการทั้งหมดเป็นไฟล์ Excel หรือ CSV")
    .addStringOption(opt =>
      opt.setName("format")
        .setDescription("รูปแบบไฟล์ (ค่าเริ่มต้น Excel)")
        .setRequired(false)
        .addChoices(
          { name: "Excel (.xlsx)", value: "excel" },
          { name: "CSV", value: "csv" }
        )
    ),
  new SlashCommandBuilder()
    .setName("delete_last")
    .setDescription("ลบรายการล่าสุดที่บันทึกไว้ (แก้เผื่อบอทจำผิด)"),
  new SlashCommandBuilder()
    .setName("add")
    .setDescription("เพิ่มรายการด้วยมือ (ไม่ต้องมีรูปสลิป เช่น จ่ายเงินสด)")
    .addNumberOption(opt =>
      opt.setName("amount").setDescription("จำนวนเงิน (บาท)").setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("type").setDescription("ประเภท (ค่าเริ่มต้น รายจ่าย)").setRequired(false)
        .addChoices(
          { name: "รายจ่าย", value: "expense" },
          { name: "รายรับ", value: "income" }
        )
    )
    .addStringOption(opt =>
      opt.setName("merchant").setDescription("ร้าน/บุคคล").setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName("category").setDescription("หมวดหมู่ (ไม่ใส่ = เดาให้อัตโนมัติ)").setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName("note").setDescription("บันทึกช่วยจำ").setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName("date").setDescription("วันที่ YYYY-MM-DD (ไม่ใส่ = วันนี้)").setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("backup_now")
    .setDescription("สำรองข้อมูลทันที (ไม่ต้องรอถึงเที่ยงคืน)")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
      console.error("กรุณาตั้งค่า DISCORD_TOKEN และ CLIENT_ID ในไฟล์ .env ก่อน");
      process.exit(1);
    }
    const route = process.env.GUILD_ID
      ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
      : Routes.applicationCommands(process.env.CLIENT_ID);

    await rest.put(route, { body: commands });
    console.log(
      process.env.GUILD_ID
        ? "ลงทะเบียน slash command กับ server ที่ระบุแล้ว (ใช้ได้ทันที)"
        : "ลงทะเบียน slash command แบบ global แล้ว (อาจใช้เวลาถึง 1 ชม. กว่าจะขึ้นทุก server)"
    );
  } catch (err) {
    console.error("ลงทะเบียน slash command ไม่สำเร็จ:", err);
    process.exit(1);
  }
})();
