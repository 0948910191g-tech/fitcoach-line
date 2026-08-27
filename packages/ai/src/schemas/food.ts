import { z } from 'zod';

const nonNegative = z.number().finite().min(0);

export const foodAnalysisSchema = z
  .object({
    confidence: z.number().finite().min(0).max(1),
    assumptions: z.array(z.string().min(1)),
    normalizedUnits: z
      .object({
        mass: z.literal('g'),
        energy: z.literal('kcal'),
        protein: z.literal('g'),
        carbs: z.literal('g'),
        fat: z.literal('g'),
        sugar: z.literal('g'),
        sodium: z.literal('mg'),
      })
      .strict(),
    items: z
      .array(
        z
          .object({
            name: z.string().min(1),
            quantity: z
              .object({
                value: z.number().finite().positive(),
                unit: z.enum(['g', 'ml', 'piece', 'serving']),
              })
              .strict(),
            components: z.array(z.string().min(1)).default([]),
            caloriesKcal: nonNegative,
            proteinG: nonNegative,
            carbsG: nonNegative,
            fatG: nonNegative,
            sugarG: nonNegative,
            sodiumMg: nonNegative,
          })
          .strict(),
      )
      .min(1),
    totals: z
      .object({
        caloriesKcal: nonNegative,
        proteinG: nonNegative,
        carbsG: nonNegative,
        fatG: nonNegative,
        sugarG: nonNegative,
        sodiumMg: nonNegative,
      })
      .strict(),
  })
  .strict();

export type FoodAnalysis = z.infer<typeof foodAnalysisSchema>;
