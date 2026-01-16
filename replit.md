# PickAFlick - Movie Picker App

## Overview
PickAFlick is a comparison-based movie picker where users complete 7 rounds of choosing between two movie posters. After all rounds, AI analyzes their choices and recommends 5 personalized movies with trailers. The app sources movies from 5 curated IMDb lists and uses TMDb for movie data, posters, and trailers.

## Current State
- **Frontend**: 7-round head-to-head movie picker with side-by-side cards, progress bar, AI recommendations results screen
- **Backend**: Session-based game state, IMDb list scraping, TMDb integration, OpenAI-powered preference analysis and recommendations
- **Integration**: Full flow from game start through AI recommendations with trailer playback

## Architecture

### Frontend (React + Vite + TypeScript)
- `/client/src/pages/home.tsx` - Main page managing game state (start → playing → loading → results)
- `/client/src/components/round-picker.tsx` - Side-by-side movie comparison with round counter and progress
- `/client/src/components/movie-choice-card.tsx` - Clickable movie poster with selection indicator
- `/client/src/components/results-screen.tsx` - AI recommendations display with embedded trailers

### Backend (Node.js + Express + TypeScript)
- `/server/routes.ts` - API endpoints (/api/catalogue, /api/recs, /api/trailers, /api/catalogue-all)
- `/server/catalogue.ts` - Movie catalogue service with caching
- `/server/tmdb.ts` - TMDb API integration for movie details and trailers
- `/server/imdb-scraper.ts` - IMDb list scraping
- `/server/session-storage.ts` - In-memory session storage for game state
- `/server/ai-recommender.ts` - OpenAI-powered preference analysis and recommendations

### Shared
- `/shared/schema.ts` - TypeScript types for Movie, CatalogueResponse, etc.

## API Endpoints
- `POST /api/session/start` - Creates new game session, returns sessionId and totalRounds
- `GET /api/session/:sessionId/round` - Returns current round's movie pair
- `POST /api/session/:sessionId/choose` - Submit movie choice for current round
- `GET /api/session/:sessionId/recommendations` - Get AI-powered movie recommendations
- `GET /api/catalogue` - Returns 75 random movies (15 from each of 5 IMDb lists)
- `GET /api/recs?limit=6` - Returns random recommendations from the rec pool
- `GET /api/trailers?ids=1,2,3` - Returns YouTube trailer URLs for given movie IDs
- `GET /api/catalogue-all` - Health status with movie counts

## Environment Variables
- `TMDB_API_KEY` (required) - TMDb API key for movie data
- `CATALOGUE_TTL_HOURS` (optional, default: 24) - How often to rebuild catalogue

## IMDb Lists Used
1. ls094921320 - Top 250 Movies
2. ls003501243 - Best Horror Movies
3. ls002065120 - Classic Movies
4. ls000873904 - Best Comedies
5. ls005747458 - Critically Acclaimed

## Design
- Dark cinema theme (very dark background ~4% lightness for immersive feel)
- Side-by-side movie posters with click-to-select animation (chosen scales up, unchosen fades)
- No confirm button - clicking a poster auto-advances to next round for frictionless flow
- Progress bar showing round completion
- Results page shows one recommendation at a time with carousel navigation
- Like/Maybe/Back/Next controls to rate each recommendation
- Preference profile cards display full text without truncation
- Trailer auto-plays (muted) for each recommendation
- Uses Inter font family for clean modern look

## Development
- Run with `npm run dev`
- Frontend: Vite on port 5000
- Backend: Express on port 5000
- Catalogue builds on startup (takes ~1-2 minutes)

## Notes
- OpenAI integration uses Replit AI Integrations (no user API key required)
- Legacy endpoints (/api/catalogue, /api/recs, /api/trailers) kept for backwards compatibility
