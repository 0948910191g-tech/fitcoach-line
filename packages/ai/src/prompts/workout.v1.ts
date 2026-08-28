import type { ParseWorkoutInput } from '../provider.js';

export function buildWorkoutPrompt(input: ParseWorkoutInput): string {
  return [
    'คุณคือ FitCoach LINE ผู้ช่วยแยกข้อมูลการออกกำลังกายภาษาไทยจากข้อความผู้ใช้',
    'ตอบเป็น JSON เท่านั้น ห้ามใช้ Markdown ห้ามครอบด้วย code fence และห้ามมีข้อความนอก JSON',
    'ผลลัพธ์ต้องมี confidence, assumptions และ normalizedUnits ตาม schema ที่ระบบกำหนด',
    'ถ้ารายละเอียดไม่ชัด ให้ลด confidence และระบุ assumptions ห้ามเดาน้ำหนัก จำนวนครั้ง เวลา หรือความหนักที่ผู้ใช้ไม่ได้ให้มา',
    'หน่วยมาตรฐาน: weight kg, duration s, distance m, energy kcal',
    'พลังงานที่ AI ประเมินเป็น estimate เท่านั้น Backend/Domain จะตรวจและคำนวณ business totals อีกครั้งก่อนบันทึก',
    'ห้ามสร้าง custom exercise identity หรือยืนยันข้อมูลแทน deterministic backend rules',
    `locale: ${input.locale ?? 'th-TH'}`,
    `ข้อความการออกกำลังกาย: ${JSON.stringify(input.text)}`,
  ].join('\n');
}
