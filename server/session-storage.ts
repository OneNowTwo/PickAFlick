import { v4 as uuidv4 } from "uuid";
import type { Session, Movie } from "@shared/schema";

// Extended session with filters
interface SessionWithFilters extends Session {
  _createdAt: number;
  _genres: string[];
  _includeTopPicks: boolean;
  _includeNewReleases: boolean;
  _baseTotalRounds: number; // Original total rounds before skips
}

// In-memory session storage
const sessions = new Map<string, SessionWithFilters>();

// Session timeout (1 hour)
const SESSION_TTL_MS = 60 * 60 * 1000;

// Clean up old sessions periodically
setInterval(() => {
  const now = Date.now();
  let deletedCount = 0;
  Array.from(sessions.entries()).forEach(([sessionId, session]) => {
    // Sessions older than TTL get removed
    if (session._createdAt && now - session._createdAt > SESSION_TTL_MS) {
      sessions.delete(sessionId);
      deletedCount++;
      console.log(`🗑️  [SESSION CLEANUP] Deleted expired session ${sessionId}`);
    }
  });
  if (deletedCount > 0) {
    console.log(`🗑️  [SESSION CLEANUP] Deleted ${deletedCount} sessions. Remaining: ${sessions.size}`);
  }
}, 5 * 60 * 1000); // Every 5 minutes

export const sessionStorage = {
  createSession(genres: string[] = [], includeTopPicks: boolean = false, includeNewReleases: boolean = false): Session {
    const sessionId = uuidv4();
    const session: SessionWithFilters = {
      sessionId,
      currentRound: 1,
      totalRounds: 7,
      choices: [],
      isComplete: false,
      _createdAt: Date.now(),
      _genres: genres,
      _includeTopPicks: includeTopPicks,
      _includeNewReleases: includeNewReleases,
      _baseTotalRounds: 7, // Original total rounds
    };
    sessions.set(sessionId, session);
    console.log(`🟢 [SESSION CREATE] ID: ${sessionId} | Total: ${sessions.size} | Genres: ${genres.join(',')}`);
    console.log(`🟢 [SESSION CREATE] All IDs: ${Array.from(sessions.keys()).join(', ')}`);
    return session;
  },

  getSessionFilters(sessionId: string): { genres: string[]; includeTopPicks: boolean; includeNewReleases: boolean } | undefined {
    const session = sessions.get(sessionId);
    if (!session) return undefined;
    return { genres: session._genres, includeTopPicks: session._includeTopPicks, includeNewReleases: session._includeNewReleases };
  },

  getBaseTotalRounds(sessionId: string): number {
    const session = sessions.get(sessionId);
    return session?._baseTotalRounds ?? 7;
  },

  getSession(sessionId: string): Session | undefined {
    const session = sessions.get(sessionId);
    if (session) {
      console.log(`✅ [SESSION GET] ID: ${sessionId} | FOUND | Total: ${sessions.size}`);
    } else {
      console.log(`❌ [SESSION GET] ID: ${sessionId} | NOT FOUND | Total: ${sessions.size}`);
      console.log(`❌ [SESSION GET] Available IDs: ${Array.from(sessions.keys()).join(', ') || 'NONE'}`);
      console.log(`❌ [SESSION GET] Map has: ${sessions.has(sessionId)}`);
    }
    return session;
  },

  updateSession(sessionId: string, update: Partial<Session>): Session | undefined {
    const session = sessions.get(sessionId);
    if (!session) return undefined;
    
    Object.assign(session, update);
    return session;
  },

  addChoice(
    sessionId: string,
    round: number,
    leftMovie: Movie,
    rightMovie: Movie,
    chosenMovieId: number
  ): Session | undefined {
    const session = sessions.get(sessionId);
    if (!session) return undefined;

    session.choices.push({
      round,
      leftMovie,
      rightMovie,
      chosenMovieId,
    });

    // Advance to next round or mark complete
    if (session.currentRound >= session.totalRounds) {
      session.isComplete = true;
    } else {
      session.currentRound++;
    }

    return session;
  },

  getChosenMovies(sessionId: string): Movie[] {
    const session = sessions.get(sessionId);
    if (!session) return [];

    return session.choices.map((choice) => {
      return choice.chosenMovieId === choice.leftMovie.id
        ? choice.leftMovie
        : choice.rightMovie;
    });
  },

  getRejectedMovies(sessionId: string): Movie[] {
    const session = sessions.get(sessionId);
    if (!session) return [];

    return session.choices.map((choice) => {
      return choice.chosenMovieId === choice.leftMovie.id
        ? choice.rightMovie
        : choice.leftMovie;
    });
  },

  getChoicesWithContext(sessionId: string): Array<{ round: number; chosen: Movie; rejected: Movie }> {
    const session = sessions.get(sessionId);
    if (!session) return [];

    return session.choices.map((choice) => ({
      round: choice.round,
      chosen: choice.chosenMovieId === choice.leftMovie.id ? choice.leftMovie : choice.rightMovie,
      rejected: choice.chosenMovieId === choice.leftMovie.id ? choice.rightMovie : choice.leftMovie,
    }));
  },

  deleteSession(sessionId: string): void {
    sessions.delete(sessionId);
  },

  addRound(sessionId: string): Session | undefined {
    const session = sessions.get(sessionId);
    if (!session) return undefined;
    
    session.totalRounds++;
    return session;
  },
};
