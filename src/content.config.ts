import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Every section entry (a game, a tool, a playground experiment) shares one shape.
const entrySchema = z.object({
  title: z.string(),
  summary: z.string(),
  // idea: not started. building: in progress. live: playable or usable.
  status: z.enum(['idea', 'building', 'live']).default('idea'),
  date: z.coerce.date().optional(),
  // Lower numbers sort first within a section.
  order: z.number().default(100),
  repo: z.string().url().optional(),
  demo: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
  // Name of a playable component registered in src/components/games/index.ts.
  play: z.enum(['sudoku', 'motherload']).optional(),
});

const makeCollection = (folder: string) =>
  defineCollection({
    loader: glob({ base: `./src/content/${folder}`, pattern: '**/*.md' }),
    schema: entrySchema,
  });

export const collections = {
  games: makeCollection('games'),
  tools: makeCollection('tools'),
  playground: makeCollection('playground'),
};
