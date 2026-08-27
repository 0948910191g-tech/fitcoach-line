'use client';

import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import type {
  ActivityLevel,
  ExperienceLevel,
  GoalType,
  OnboardingInput,
  OnboardingPreview,
  OnboardingSex,
} from '../../services/onboarding-service';

const shellStyle: CSSProperties = {
  width: '100%',
  maxWidth: 520,
  margin: '0 auto',
  padding: '0 16px 32px',
  boxSizing: 'border-box',
};

const fieldStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
  marginBottom: 16,
  fontSize: 15,
  fontWeight: 600,
};

const inputStyle: CSSProperties = {
  minHeight: 46,
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid #cbd5e1',
  borderRadius: 10,
  padding: '10px 12px',
  fontSize: 16,
  background: '#fff',
  color: '#0f172a',
};

const buttonStyle: CSSProperties = {
  width: '100%',
  minHeight: 48,
  border: 0,
  borderRadius: 12,
  padding: '12px 16px',
  fontSize: 16,
  fontWeight: 700,
  cursor: 'pointer',
};

const initialValues = {
  sex: '' as '' | OnboardingSex,
  birthDate: '',
  heightCm: '',
  currentWeightKg: '',
  activityLevel: '' as '' | ActivityLevel,
  experienceLevel: '' as '' | ExperienceLevel,
  goalType: '' as '' | GoalType,
  targetWeightKg: '',
  trainingDaysPerWeek: '',
};

function toInput(values: typeof initialValues): OnboardingInput {
  return {
    sex: values.sex as OnboardingSex,
    birthDate: values.birthDate,
    heightCm: Number(values.heightCm),
    currentWeightKg: Number(values.currentWeightKg),
    activityLevel: values.activityLevel as ActivityLevel,
    experienceLevel: values.experienceLevel as ExperienceLevel,
    goalType: values.goalType as GoalType,
    targetWeightKg: Number(values.targetWeightKg),
    trainingDaysPerWeek: Number(values.trainingDaysPerWeek),
  };
}

async function postOnboarding(payload: unknown): Promise<Record<string, unknown>> {
  const response = await fetch('/api/auth/line/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'request_failed');
  }
  return data;
}

export function OnboardingForm({ authenticated = true }: { authenticated?: boolean } = {}) {
  const [values, setValues] = useState(initialValues);
  const [preview, setPreview] = useState<OnboardingPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'saved'>('idle');
  const [error, setError] = useState('');

  const onboarding = useMemo(() => toInput(values), [values]);

  function update<K extends keyof typeof initialValues>(key: K, value: (typeof initialValues)[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setPreview(null);
    setConfirmed(false);
    setError('');
  }

  async function calculate(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    setError('');
    try {
      const data = await postOnboarding({ action: 'preview', onboarding });
      setPreview(data.preview as OnboardingPreview);
    } catch {
      setError('ตรวจสอบข้อมูลให้ครบและถูกต้องก่อนคำนวณ');
    } finally {
      setStatus('idle');
    }
  }

  async function save() {
    if (!confirmed || !preview) return;
    if (!authenticated) {
      setError('กรุณาเข้าสู่ระบบด้วย LINE ก่อนบันทึกข้อมูล');
      return;
    }

    setStatus('loading');
    setError('');
    try {
      await postOnboarding({ action: 'save', confirmed: true, onboarding });
      setStatus('saved');
    } catch {
      setStatus('idle');
      setError('ยังบันทึกไม่ได้ กรุณาตรวจสอบการเข้าสู่ระบบแล้วลองอีกครั้ง');
    }
  }

  return (
    <section style={shellStyle} aria-labelledby="onboarding-heading">
      <h2 id="onboarding-heading" style={{ fontSize: 22, margin: '8px 0 20px' }}>
        ตั้งค่าเป้าหมายของคุณ
      </h2>

      <form onSubmit={calculate} noValidate>
        <label style={fieldStyle}>
          เพศ
          <select
            aria-label="เพศ"
            value={values.sex}
            onChange={(event) => update('sex', event.target.value as typeof values.sex)}
            style={inputStyle}
          >
            <option value="">เลือกเพศ</option>
            <option value="male">ชาย</option>
            <option value="female">หญิง</option>
          </select>
        </label>

        <label style={fieldStyle}>
          วันเกิด
          <input
            aria-label="วันเกิด"
            type="date"
            value={values.birthDate}
            onChange={(event) => update('birthDate', event.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={fieldStyle}>
          ส่วนสูง (ซม.)
          <input
            aria-label="ส่วนสูง (ซม.)"
            inputMode="decimal"
            type="number"
            min="1"
            step="0.1"
            value={values.heightCm}
            onChange={(event) => update('heightCm', event.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={fieldStyle}>
          น้ำหนักปัจจุบัน (กก.)
          <input
            aria-label="น้ำหนักปัจจุบัน (กก.)"
            inputMode="decimal"
            type="number"
            min="1"
            step="0.1"
            value={values.currentWeightKg}
            onChange={(event) => update('currentWeightKg', event.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={fieldStyle}>
          ระดับกิจกรรม
          <select
            aria-label="ระดับกิจกรรม"
            value={values.activityLevel}
            onChange={(event) =>
              update('activityLevel', event.target.value as typeof values.activityLevel)
            }
            style={inputStyle}
          >
            <option value="">เลือกระดับกิจกรรม</option>
            <option value="sedentary">นั่งเป็นหลัก / แทบไม่ออกกำลัง</option>
            <option value="light">ออกกำลังเบา 1–3 วัน/สัปดาห์</option>
            <option value="moderate">ออกกำลังปานกลาง 3–5 วัน/สัปดาห์</option>
            <option value="very_active">ออกกำลังหนัก 6–7 วัน/สัปดาห์</option>
          </select>
        </label>

        <label style={fieldStyle}>
          ประสบการณ์ฝึก
          <select
            aria-label="ประสบการณ์ฝึก"
            value={values.experienceLevel}
            onChange={(event) =>
              update('experienceLevel', event.target.value as typeof values.experienceLevel)
            }
            style={inputStyle}
          >
            <option value="">เลือกประสบการณ์ฝึก</option>
            <option value="beginner">เริ่มต้น</option>
            <option value="intermediate">ปานกลาง</option>
            <option value="advanced">มีประสบการณ์สูง</option>
          </select>
        </label>

        <label style={fieldStyle}>
          เป้าหมาย
          <select
            aria-label="เป้าหมาย"
            value={values.goalType}
            onChange={(event) => update('goalType', event.target.value as typeof values.goalType)}
            style={inputStyle}
          >
            <option value="">เลือกเป้าหมาย</option>
            <option value="fat_loss">ลดไขมัน</option>
            <option value="maintain">รักษาน้ำหนัก</option>
            <option value="muscle_gain">เพิ่มกล้ามเนื้อ</option>
          </select>
        </label>

        <label style={fieldStyle}>
          น้ำหนักเป้าหมาย (กก.)
          <input
            aria-label="น้ำหนักเป้าหมาย (กก.)"
            inputMode="decimal"
            type="number"
            min="1"
            step="0.1"
            value={values.targetWeightKg}
            onChange={(event) => update('targetWeightKg', event.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={fieldStyle}>
          จำนวนวันฝึกต่อสัปดาห์ (วัน)
          <select
            aria-label="จำนวนวันฝึกต่อสัปดาห์ (วัน)"
            value={values.trainingDaysPerWeek}
            onChange={(event) => update('trainingDaysPerWeek', event.target.value)}
            style={inputStyle}
          >
            <option value="">เลือกจำนวนวัน</option>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((day) => (
              <option key={day} value={day}>
                {day} วัน
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={status === 'loading'}
          style={{ ...buttonStyle, background: '#e2e8f0', color: '#0f172a' }}
        >
          คำนวณเป้าหมาย
        </button>
      </form>

      {preview ? (
        <section
          aria-live="polite"
          style={{ marginTop: 20, padding: 16, borderRadius: 14, background: '#f8fafc' }}
        >
          <h3 style={{ marginTop: 0 }}>ค่าประมาณสำหรับเริ่มต้น</h3>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, margin: 0 }}>
            <dt>อายุ</dt>
            <dd>{preview.ageYears} ปี</dd>
            <dt>BMR</dt>
            <dd>{preview.bmrKcal.toLocaleString('th-TH')} kcal</dd>
            <dt>TDEE</dt>
            <dd>{preview.tdeeKcal.toLocaleString('th-TH')} kcal</dd>
            <dt>แคลอรี่เป้าหมาย</dt>
            <dd>{preview.targetCaloriesKcal.toLocaleString('th-TH')} kcal</dd>
            <dt>โปรตีนเป้าหมาย</dt>
            <dd>{preview.targetProteinG.toLocaleString('th-TH')} g</dd>
          </dl>
        </section>
      ) : null}

      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 18 }}>
        <input
          aria-label="ฉันตรวจสอบค่าด้านบนแล้วและยืนยันให้บันทึก"
          type="checkbox"
          checked={confirmed}
          disabled={!preview}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>ฉันตรวจสอบค่าด้านบนแล้วและยืนยันให้บันทึก</span>
      </label>

      <button
        type="button"
        onClick={save}
        disabled={!preview || !confirmed || status === 'loading' || status === 'saved'}
        style={{
          ...buttonStyle,
          marginTop: 16,
          background: preview && confirmed ? '#16a34a' : '#cbd5e1',
          color: preview && confirmed ? '#fff' : '#475569',
        }}
      >
        ยืนยันและบันทึก
      </button>

      {!authenticated ? (
        <p style={{ marginTop: 16 }}>
          การคำนวณดูตัวอย่างทำได้ก่อน แต่ต้อง{' '}
          <a href="/api/auth/line/exchange">เข้าสู่ระบบด้วย LINE</a> จึงจะบันทึกได้
        </p>
      ) : null}

      {status === 'saved' ? <p role="status">บันทึกเป้าหมายเรียบร้อย</p> : null}
      {error ? <p role="alert">{error}</p> : null}

      <p style={{ marginTop: 18, color: '#475569', fontSize: 13, lineHeight: 1.6 }}>
        BMR, TDEE, แคลอรี่ และโปรตีนเป็นค่าประมาณสำหรับใช้วางแผนเบื้องต้น ไม่ใช่คำวินิจฉัยทางการแพทย์
      </p>
    </section>
  );
}
