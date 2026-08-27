import { z } from 'zod';

const energyRangeSchema = z
  .object({
    min: z.number().finite().min(0),
    max: z.number().finite().min(0),
  })
  .strict()
  .refine((value) => value.max >= value.min, {
    message: 'max energy must be greater than or equal to min energy',
  });

const commonShape = {
  confidence: z.number().finite().min(0).max(1),
  assumptions: z.array(z.string().min(1)),
  normalizedUnits: z
    .object({
      weight: z.literal('kg'),
      duration: z.literal('s'),
      distance: z.literal('m'),
      energy: z.literal('kcal'),
    })
    .strict(),
};

const quickWorkoutSchema = z
  .object({
    ...commonShape,
    mode: z.literal('quick'),
    activityType: z.string().min(1),
    durationSeconds: z.number().int().positive(),
    effort: z.enum(['low', 'moderate', 'high']),
    estimatedEnergyKcal: energyRangeSchema,
  })
  .strict();

const strengthWorkoutSchema = z
  .object({
    ...commonShape,
    mode: z.literal('strength'),
    exercises: z
      .array(
        z
          .object({
            name: z.string().min(1),
            sets: z
              .array(
                z
                  .object({
                    setType: z.enum(['warmup', 'working']).default('working'),
                    reps: z.number().int().positive(),
                    weightKg: z.number().finite().min(0).nullable().default(null),
                    rpe: z.number().finite().min(1).max(10).optional(),
                    restSeconds: z.number().int().min(0).optional(),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1),
    estimatedEnergyKcal: energyRangeSchema,
  })
  .strict();

export const workoutAnalysisSchema = z.discriminatedUnion('mode', [
  quickWorkoutSchema,
  strengthWorkoutSchema,
]);

export type WorkoutAnalysis = z.infer<typeof workoutAnalysisSchema>;
