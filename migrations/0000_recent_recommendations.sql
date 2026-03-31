-- Production-safe: other tables already exist on Render; only add missing recent_recommendations.
CREATE TABLE IF NOT EXISTS "recent_recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"mood_key" text NOT NULL,
	"title" text NOT NULL,
	"year" integer,
	"recommended_at" timestamp DEFAULT now() NOT NULL
);
