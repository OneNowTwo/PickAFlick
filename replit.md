# PickAFlick - Movie Picker App

## Overview
PickAFlick is a comparison-based movie picker where users complete 7 rounds of choosing between two movie posters. After all rounds, AI analyzes their choices and recommends 5 personalized movies with trailers. The app sources movies from 5 curated IMDb lists and uses TMDb for movie data, posters, and trailers.

## Current State
- **Frontend**: 7-round head-to-head movie picker with side-by-side cards, progress bar, AI recommendations results screen, Watchlist page, Mood/Genre selection on home page, How It Works instructions
- **Backend**: Session-based game state with genre filtering, IMDb list scraping, TMDb integration, OpenAI-powered preference analysis and recommendations, PostgreSQL watchlist persistence
- **Integration**: Full flow from mood selection → game start → genre-filtered movie pairs → AI recommendations with trailer playback, saved liked movies persist to database

## Architecture

### Frontend (React + Vite + TypeScript)
- `/client/src/pages/home.tsx` - Main page managing game state (start → playing → loading → results)
- `/client/src/pages/watchlist.tsx` - Watchlist page showing saved/liked movies with watched toggle
- `/client/src/components/round-picker.tsx` - Side-by-side movie comparison with round counter and progress
- `/client/src/components/movie-choice-card.tsx` - Clickable movie poster with selection indicator
- `/client/src/components/results-screen.tsx` - AI recommendations display with embedded trailers, Like button saves to watchlist

### Backend (Node.js + Express + TypeScript)
- `/server/routes.ts` - API endpoints including session, catalogue, and watchlist endpoints
- `/server/catalogue.ts` - Movie catalogue service with caching
- `/server/tmdb.ts` - TMDb API integration for movie details and trailers
- `/server/imdb-scraper.ts` - IMDb list scraping
- `/server/session-storage.ts` - In-memory session storage for game state
- `/server/ai-recommender.ts` - OpenAI-powered preference analysis and recommendations
- `/server/storage.ts` - Database storage layer for watchlist
- `/server/db.ts` - PostgreSQL database connection

### Database
- PostgreSQL database with `watchlist` table for persisting liked movies

### Shared
- `/shared/schema.ts` - TypeScript types for Movie, Session, Watchlist, etc.

## API Endpoints
### Session/Game
- `POST /api/session/start` - Creates new game session. Accepts optional `genres` array, `includeTopPicks` and `includeNewReleases` booleans to filter movies. Returns sessionId and totalRounds
- `GET /api/session/:sessionId/round` - Returns current round's movie pair (includes baseTotalRounds and choicesMade for progress calculation)
- `POST /api/session/:sessionId/choose` - Submit movie choice for current round
- `GET /api/session/:sessionId/recommendations` - Get AI-powered movie recommendations
- `POST /api/session/:sessionId/replacement` - Get replacement recommendation when user marks one as "Seen It"

### Watchlist
- `GET /api/watchlist` - Get all saved movies in watchlist
- `POST /api/watchlist` - Add movie to watchlist
- `DELETE /api/watchlist/:id` - Remove movie from watchlist
- `PATCH /api/watchlist/:id/watched` - Toggle watched status
- `GET /api/watchlist/check/:tmdbId` - Check if movie is in watchlist

### Watch Providers
- `GET /api/watch-providers/:tmdbId` - Get streaming/rent/buy options for a movie (Australia region)

### Legacy
- `GET /api/catalogue` - Returns 75 random movies (15 from each of 5 IMDb lists)
- `GET /api/recs?limit=6` - Returns random recommendations from the rec pool
- `GET /api/trailers?ids=1,2,3` - Returns YouTube trailer URLs for given movie IDs
- `GET /api/catalogue-all` - Health status with movie counts

## Environment Variables
- `TMDB_API_KEY` (required) - TMDb API key for movie data
- `CATALOGUE_TTL_HOURS` (optional, default: 24) - How often to rebuild catalogue

## Movie Sources
Primary: IMDb Lists (when available)
1. ls094921320 - Top 250 Movies
2. ls003501243 - Best Horror Movies
3. ls002065120 - Classic Movies
4. ls000873904 - Best Comedies
5. ls005747458 - Critically Acclaimed

Always included from TMDb:
- **New Releases** - "Now Playing" movies currently in theaters (region: AU)

Fallback: TMDb API (when IMDb scraping fails)
- Top Rated movies
- Popular Now movies
- New Releases (Now Playing)
- Horror (genre ID: 27)
- Comedy (genre ID: 35)
- Sci-Fi & Fantasy (genre IDs: 878, 14)

## Design
- Dark cinema theme (very dark background ~4% lightness for immersive feel)
- Side-by-side movie posters with click-to-select animation (chosen scales up, unchosen fades)
- No confirm button - clicking a poster auto-advances to next round for frictionless flow
- Progress ring showing round completion (uses choicesMade/baseTotalRounds so skip doesn't move progress backwards)
- Skip button adds +1 round to compensate, but progress percentage stays frozen
- Results page shows one recommendation at a time with carousel navigation
- "Seen It" button removes recommendation and AI generates a replacement
- Save to Watchlist/Back/Next controls on results screen
- Preference profile cards display full text without truncation
- Trailer auto-plays (muted) for each recommendation
- Uses Inter font family for clean modern look

## Mood/Genre Options
- Action & Adventure
- Comedy
- Drama
- Horror & Thriller
- Sci-Fi & Fantasy
- Romance
- Mystery & Crime
- Top Picks - Top rated and popular movies

## Development
- Run with `npm run dev`
- Frontend: Vite on port 5000
- Backend: Express on port 5000
- Catalogue builds on startup (takes ~1-2 minutes)

## AI Recommendations
- Uses GPT-4o-mini via Replit AI Integrations
- Recommendations include variety mix:
  - ONE recent release (last 3 years) that matches user taste
  - ONE underseen gem (critically acclaimed but lesser-known)
  - ONE classic/older film (pre-2010)
  - TWO flexible picks
- Explicit anti-repetition rules to avoid over-suggested films (A Ghost Story, Hereditary, etc.)
- Quality standards: English-language or mainstream crossover, well-rated films only

## Notes
- OpenAI integration uses Replit AI Integrations (no user API key required)
- Legacy endpoints (/api/catalogue, /api/recs, /api/trailers) kept for backwards compatibility
