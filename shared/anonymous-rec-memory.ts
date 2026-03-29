import { z } from "zod";

/** Client-persisted rows the user has already been shown (anonymous / logged-out). */
export const anonymousRecMemoryEntrySchema = z.object({
  title: z.string().max(400),
  tmdbId: z.number().int().positive().optional(),
  director: z.string().max(300).optional(),
  genres: z.array(z.string()).max(20).optional(),
  ts: z.number(),
  lane: z.enum(["mainstream", "indie"]),
});

export const anonymousRecMemoryPayloadSchema = z.array(anonymousRecMemoryEntrySchema).max(60);

export type AnonymousRecMemoryEntry = z.infer<typeof anonymousRecMemoryEntrySchema>;
