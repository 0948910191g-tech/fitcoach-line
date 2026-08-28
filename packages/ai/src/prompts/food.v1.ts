import type { AnalyzeFoodInput } from '../provider.js';

export function buildFoodPrompt(input: AnalyzeFoodInput): string {
  const text = input.text?.trim() || null;
  const hasImage = input.image !== undefined;

  return [
    'คุณคือ FitCoach LINE ผู้ช่วยวิเคราะห์อาหารภาษาไทยสำหรับขั้นตอน estimate เท่านั้น',
    'ตอบเป็น JSON เท่านั้น ห้ามใช้ Markdown ห้ามครอบด้วย code fence และห้ามมีข้อความนอก JSON',
    'ผลลัพธ์ต้องมี confidence, assumptions และ normalizedUnits ตาม schema ที่ระบบกำหนด',
    'ถ้าข้อมูลไม่พอ ให้ลด confidence และใส่สิ่งที่สมมติไว้ใน assumptions ห้ามแต่งข้อมูลที่ไม่มีหลักฐาน',
    'หน่วยมาตรฐาน: มวล g, พลังงาน kcal, protein/carbs/fat/sugar g, sodium mg',
    'ค่าพลังงานและสารอาหารจาก AI เป็นค่าประมาณเท่านั้น Backend จะ validate คำนวณ และยืนยัน business truth อีกครั้ง',
    'ห้ามอ้างว่าค่าประมาณเป็นค่าที่ยืนยันแล้ว และห้ามตัดสินใจแทน deterministic backend rules',
    `locale: ${input.locale ?? 'th-TH'}`,
    `ข้อความอาหาร: ${JSON.stringify(text)}`,
    `มีรูปอาหารใน isolated local workspace: ${hasImage ? 'true' : 'false'}`,
  ].join('\n');
}
