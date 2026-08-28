import type { CoachInput, DailyReportInput, WeeklyReportInput } from '../provider.js';

const JSON_RULES = [
  'ตอบเป็น JSON เท่านั้น ห้ามใช้ Markdown ห้ามครอบด้วย code fence และห้ามมีข้อความนอก JSON',
  'ผลลัพธ์ต้องมี confidence, assumptions, normalizedUnits, factsUsed และ missingData ตาม schema ที่ระบบกำหนด',
  'ใช้เฉพาะ facts ที่ Backend ส่งให้ ห้ามสร้างตัวเลขสุขภาพ เป้าหมาย หรือข้อเท็จจริงใหม่เอง',
  'ถ้าข้อมูลไม่พอ ให้ใส่รายการใน missingData และลด confidence แทนการเดา',
  'Backend/Rule Engine เป็น source of truth ของตัวเลขและ safety decision; AI มีหน้าที่เรียบเรียงคำแนะนำจาก facts เท่านั้น',
].join('\n');

export function buildCoachPrompt(input: CoachInput): string {
  return [
    'คุณคือ FitCoach LINE โค้ชฟิตเนสภาษาไทยที่ตอบสั้น ชัด และอิงข้อมูลจริงของผู้ใช้',
    JSON_RULES,
    `locale: ${input.locale ?? 'th-TH'}`,
    `คำถามผู้ใช้: ${JSON.stringify(input.question)}`,
    `facts จาก Backend: ${JSON.stringify(input.facts)}`,
  ].join('\n');
}

export function buildDailyReportPrompt(input: DailyReportInput): string {
  return [
    'คุณคือ FitCoach LINE ผู้เรียบเรียงรายงานประจำวันภาษาไทยจากข้อเท็จจริงที่ Backend คำนวณแล้ว',
    JSON_RULES,
    `ช่วงรายงาน: ${JSON.stringify(input.periodStart)} ถึง ${JSON.stringify(input.periodEnd)}`,
    `locale: ${input.locale ?? 'th-TH'}`,
    `facts จาก Backend: ${JSON.stringify(input.facts)}`,
  ].join('\n');
}

export function buildWeeklyReportPrompt(input: WeeklyReportInput): string {
  return [
    'คุณคือ FitCoach LINE ผู้เรียบเรียงรายงานประจำสัปดาห์ภาษาไทยจากข้อเท็จจริงที่ Backend คำนวณแล้ว',
    JSON_RULES,
    `ช่วงรายงาน: ${JSON.stringify(input.periodStart)} ถึง ${JSON.stringify(input.periodEnd)}`,
    `locale: ${input.locale ?? 'th-TH'}`,
    `facts จาก Backend: ${JSON.stringify(input.facts)}`,
  ].join('\n');
}
