# FitCoach LINE

Owner Alpha ของ AI Fitness Coach ภาษาไทยที่ใช้งานหลักผ่าน LINE โดยแยก Web/LINE adapters, domain rules, database access และ AI providers ออกจากกันตั้งแต่ foundation เพื่อรองรับการสลับจาก CodexProvider ไป OpenAIProvider ภายหลังโดยไม่แก้ feature logic.

## Architecture

- `apps/web` — Next.js App Router, LIFF และ HTTP endpoints
- `apps/worker` — private Node worker สำหรับ durable AI jobs
- `packages/domain` — deterministic calculations และ business rules
- `packages/ai` — AIProvider contracts, schemas และ adapters
- `packages/db` — Supabase clients, migrations และ repositories
- `packages/line` — LINE signature/parser/Flex builders
- `packages/config` — typed environment configuration

## Requirements

- Node.js 22+
- pnpm 10.34.5

## Quality gate

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

No secret, `.env`, Codex auth cache, or real health data may be committed.
