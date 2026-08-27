import { OnboardingForm } from '../../src/features/onboarding/onboarding-form';
import { createSupabaseServerClient } from '../../src/lib/supabase/server';

export const dynamic = 'force-dynamic';

async function hasAuthenticatedUser(): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    return Boolean(data.user);
  } catch {
    return false;
  }
}

export default async function OnboardingPage() {
  const authenticated = await hasAuthenticatedUser();

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#f1f5f9',
        color: '#0f172a',
        fontFamily: 'system-ui, sans-serif',
        padding: '24px 0',
      }}
    >
      <header style={{ width: '100%', maxWidth: 520, margin: '0 auto', padding: '0 16px' }}>
        <p style={{ margin: 0, color: '#16a34a', fontWeight: 800 }}>FitCoach LINE</p>
        <h1 style={{ margin: '8px 0', fontSize: 28 }}>เริ่มต้นให้โค้ชช่วยได้ตรงเป้าหมาย</h1>
        <p style={{ marginTop: 0, color: '#475569', lineHeight: 1.6 }}>
          กรอกข้อมูลพื้นฐานก่อน ระบบจะคำนวณค่าตั้งต้นให้ตรวจสอบก่อนบันทึกทุกครั้ง
        </p>
        {!authenticated ? (
          <a
            href="/api/auth/line/exchange"
            style={{
              display: 'inline-block',
              margin: '8px 0 20px',
              padding: '12px 16px',
              borderRadius: 10,
              background: '#06c755',
              color: '#fff',
              fontWeight: 800,
              textDecoration: 'none',
            }}
          >
            เข้าสู่ระบบด้วย LINE
          </a>
        ) : null}
      </header>
      <OnboardingForm authenticated={authenticated} />
    </main>
  );
}
