/** Structured mood from A/B session — source of truth for recommendation prompts. */
export interface SessionMoodProfile {
  preferred_tone: string;
  rejected_tone: string;
  pacing: string;
  darkness_level: string;
  realism_vs_stylised: string;
  complexity: string;
  emotional_texture: string;
  what_they_want: string[];
  what_they_avoid: string[];
}
