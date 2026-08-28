import { z } from 'zod';

const normalizedCoachUnitsSchema = z
  .object({
    energy: z.literal('kcal'),
    protein: z.literal('g'),
    weight: z.literal('kg'),
  })
  .strict();

const coachBaseShape = {
  confidence: z.number().finite().min(0).max(1),
  assumptions: z.array(z.string().min(1)),
  normalizedUnits: normalizedCoachUnitsSchema,
  factsUsed: z.array(z.string().min(1)),
  missingData: z.array(z.string().min(1)),
};

export const coachReplySchema = z
  .object({
    ...coachBaseShape,
    message: z.string().min(1),
  })
  .strict();

const reportShape = {
  ...coachBaseShape,
  summary: z.string().min(1),
  nextActions: z.array(z.string().min(1)),
};

export const dailyReportSchema = z.object(reportShape).strict();
export const weeklyReportSchema = z.object(reportShape).strict();

export type CoachReply = z.infer<typeof coachReplySchema>;
export type DailyReport = z.infer<typeof dailyReportSchema>;
export type WeeklyReport = z.infer<typeof weeklyReportSchema>;
