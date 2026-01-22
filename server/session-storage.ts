import { v4 as uuidv4 } from "uuid";
import type { Session, Movie } from "@shared/schema";

// Extended session with filters
interface SessionWithFilters extends Session {
  _createdAt: number;
  _genres: string[];
  _includeTopPicks: boolean;
}

// In-memory session storage
const sessions = new Map<string, SessionWithFilters>();

// Session timeout (1 hour)
const SESSION_TTL_MS = 60 * 60 * 1000;

// Clean up old sessions periodically
setInterval(() => {
  const now = Date.now();
  Array.from(sessions.entries()).forEach(([sessionId, session]) => {
    // Sessions older than TTL get removed
    if (session._createdAt && now - session._createdAt > SESSION_TTL_MS) {
      sessions.delete(sessionId);
    }
  });
}, 5 * 60 * 1000); // Every 5 minutes

export const sessionStorage = {
  createSession(genres: string[] = [], includeTopPicks: boolean = false): Session {
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
    };
    sessions.set(sessionId, session);
    return session;
  },

  getSessionFilters(sessionId: string): { genres: string[]; includeTopPicks: boolean } | undefined {
    const session = sessions.get(sessionId);
    if (!session) return undefined;
    return { genres: session._genres, includeTopPicks: session._includeTopPicks };
  },

  getSession(sessionId: string): Session | undefined {
    return sessions.get(sessionId);
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

  deleteSession(sessionId: string): void {
    sessions.delete(sessionId);
  },
};
