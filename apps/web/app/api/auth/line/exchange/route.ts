import { getServerEnv } from '../../../../../../../packages/config/src/env';
import { createSupabaseServerClient } from '../../../../../src/lib/supabase/server';
import {
  calculateOnboardingPreview,
  createOnboardingService,
  type OnboardingInput,
  validateOnboardingInput,
} from '../../../../../src/services/onboarding-service';

type AuthError = { message: string } | null;

type TrustedLineLink = {
  user_id: string;
  auth_user_id: string;
  provider: string;
  provider_id: string;
  line_user_id: string;
};

type LineAuthClient = {
  auth: {
    signInWithOAuth(input: {
      provider: 'custom:line';
      options: { redirectTo: string; scopes: 'openid profile' };
    }): Promise<{ data: { url: string | null }; error: AuthError }>;
    exchangeCodeForSession(code: string): Promise<{ error: AuthError }>;
    getUser(): Promise<{ data: { user: { id: string } | null }; error: AuthError }>;
  };
  rpc(
    name: string,
    args?: Readonly<Record<string, unknown>>,
  ): Promise<{ data: unknown; error: AuthError }>;
};

function firstLink(data: unknown): TrustedLineLink | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row = data[0];
  if (typeof row !== 'object' || row === null) return null;
  const candidate = row as Partial<TrustedLineLink>;
  if (
    typeof candidate.user_id !== 'string' ||
    typeof candidate.auth_user_id !== 'string' ||
    typeof candidate.provider !== 'string' ||
    typeof candidate.provider_id !== 'string' ||
    typeof candidate.line_user_id !== 'string'
  ) {
    return null;
  }
  return candidate as TrustedLineLink;
}

function isTrustedLineLink(link: TrustedLineLink | null, authUserId: string): link is TrustedLineLink {
  return Boolean(
    link &&
      link.user_id &&
      link.auth_user_id === authUserId &&
      link.provider === 'custom:line' &&
      link.provider_id &&
      link.line_user_id &&
      link.provider_id === link.line_user_id,
  );
}

export function createLineExchangeHandler(dependencies: {
  callbackUrl: string;
  createClient: () => Promise<LineAuthClient>;
}) {
  return async function handleLineExchange(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get('code');
    const client = await dependencies.createClient();

    if (!code) {
      const { data, error } = await client.auth.signInWithOAuth({
        provider: 'custom:line',
        options: {
          redirectTo: dependencies.callbackUrl,
          scopes: 'openid profile',
        },
      });
      if (error || !data.url) {
        return Response.json({ error: 'line_login_unavailable' }, { status: 502 });
      }
      return Response.redirect(data.url, 302);
    }

    const exchange = await client.auth.exchangeCodeForSession(code);
    if (exchange.error) {
      return Response.json({ error: 'invalid_oauth_callback' }, { status: 401 });
    }

    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) {
      return Response.json({ error: 'authenticated_session_required' }, { status: 401 });
    }

    const linked = await client.rpc('link_line_identity_v1');
    const link = firstLink(linked.data);
    if (linked.error || !isTrustedLineLink(link, userData.user.id)) {
      return Response.json({ error: 'line_identity_mismatch' }, { status: 401 });
    }

    return Response.redirect(new URL('/onboarding', dependencies.callbackUrl), 302);
  };
}

export async function GET(request: Request): Promise<Response> {
  const env = getServerEnv();
  const handler = createLineExchangeHandler({
    callbackUrl: env.LINE_LOGIN_CALLBACK_URL,
    createClient: async () => (await createSupabaseServerClient()) as unknown as LineAuthClient,
  });
  return handler(request);
}

type OnboardingPostBody = {
  action?: unknown;
  confirmed?: unknown;
  onboarding?: unknown;
};

function currentAsOfDate(): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function POST(request: Request): Promise<Response> {
  let body: OnboardingPostBody;
  try {
    body = (await request.json()) as OnboardingPostBody;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const validation = validateOnboardingInput(body.onboarding);
  if (!validation.valid) {
    return Response.json(
      { error: 'invalid_onboarding', fields: validation.errors },
      { status: 400 },
    );
  }
  const onboarding = body.onboarding as OnboardingInput;
  const asOfDate = currentAsOfDate();

  if (body.action === 'preview') {
    return Response.json({ preview: calculateOnboardingPreview(onboarding, { asOfDate }) });
  }

  if (body.action !== 'save') {
    return Response.json({ error: 'unsupported_action' }, { status: 400 });
  }
  if (body.confirmed !== true) {
    return Response.json({ error: 'explicit_confirmation_required' }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return Response.json({ error: 'authenticated_session_required' }, { status: 401 });
  }

  const linked = await supabase.rpc('link_line_identity_v1');
  const link = firstLink(linked.data);
  if (linked.error || !isTrustedLineLink(link, userData.user.id)) {
    return Response.json({ error: 'line_identity_mismatch' }, { status: 401 });
  }

  const service = createOnboardingService({
    saveConfirmedOnboarding: async (payload) => {
      const { error } = await supabase.rpc('save_onboarding_v1', {
        p_confirmed: true,
        p_sex: payload.profile.sex,
        p_birth_date: payload.profile.birthDate,
        p_height_cm: payload.profile.heightCm,
        p_current_weight_kg: payload.profile.currentWeightKg,
        p_activity_level: payload.profile.activityLevel,
        p_experience_level: payload.profile.experienceLevel,
        p_goal_type: payload.goal.goalType,
        p_target_weight_kg: payload.goal.targetWeightKg,
        p_target_calories: payload.goal.targetCalories,
        p_target_protein_g: payload.goal.targetProteinG,
        p_training_days_per_week: payload.goal.trainingDaysPerWeek,
      });
      if (error) throw new Error('Onboarding persistence failed');
    },
  });

  try {
    const preview = await service.save({
      userId: link.user_id,
      onboarding,
      confirmed: true,
      asOfDate,
    });
    return Response.json({ saved: true, preview });
  } catch {
    return Response.json({ error: 'onboarding_save_failed' }, { status: 500 });
  }
}
