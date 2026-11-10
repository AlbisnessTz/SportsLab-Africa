import { useState, useEffect, useCallback } from 'react';
import { 
  TabType, 
  TravelCategory, 
  Team, 
  Match, 
  NewsArticle, 
  Stadium, 
  UserProfile, 
  AppSettings 
} from '../types';
import { 
  TEAMS_DATA, 
  MATCHES_DATA, 
  TRAVEL_SPOTS_DATA, 
  NEWS_DATA, 
  STADIUMS_DATA 
} from '../data/mockData';
import { DEFAULT_PROFILE, StorageService } from '../services/storageService';
import {
  isSupabaseAuthConfigured,
  onSupabaseAuthStateChange,
  registerWithEmail,
  signInWithEmail,
  signInWithGoogle,
  signOutSupabase,
} from '../services/supabaseAuthService';
import {
  baseProfileFor,
  describeAuthError,
  mergeAuthenticatedUser,
  signedOutProfile,
  type AuthActionResult,
} from '../services/authProfile';
import { checkLiveApiHealth, type LiveApiConnectionState } from '../services/liveSportsService';
import { fetchLiveFootballMatches, type LiveFootballFeedResult } from '../services/liveFootballFeedService';

// With a trusted identity provider configured, never write passwords or the prototype
// user directory to browser storage. Without one, the local prototype flow stays in place.
const persistProfile = (profile: UserProfile) =>
  isSupabaseAuthConfigured ? StorageService.saveProfileLocalOnly(profile) : StorageService.saveProfile(profile);

export function useAppViewModel() {
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [showSplash, setShowSplash] = useState<boolean>(true);
  const [showApkModal, setShowApkModal] = useState<boolean>(false);
  const [liveApiConnection, setLiveApiConnection] = useState<LiveApiConnectionState>('checking');
  const [liveFootballFeed, setLiveFootballFeed] = useState<LiveFootballFeedResult>({
    state: 'unavailable',
    matches: [],
    message: 'Checking the live football feed…',
  });

  // User Profile & Settings state
  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    if (isSupabaseAuthConfigured) StorageService.stripStoredPasswords();
    const stored = StorageService.getProfile();
    if (!isSupabaseAuthConfigured) return stored;
    // A real account must be proven by a live Supabase session (restored by the listener below).
    // Only email-less local guests stay signed in from storage.
    return stored.email ? signedOutProfile(stored) : { ...stored, password: '' };
  });
  const [appSettings, setAppSettings] = useState<AppSettings>(() => StorageService.getSettings());

  // Matches State (dynamic votes)
  const [matches, setMatches] = useState<Match[]>(MATCHES_DATA);

  // Filter States
  const [selectedCity, setSelectedCity] = useState<string>('Dar es Salaam');
  const [selectedTravelCategory, setSelectedTravelCategory] = useState<TravelCategory>('hotel');
  const [selectedMatchGroup, setSelectedMatchGroup] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals / Details state
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [selectedStadium, setSelectedStadium] = useState<Stadium | null>(null);

  // Auto hide splash screen after 2.4 seconds initially
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 2400);
    return () => clearTimeout(timer);
  }, []);

  // Check backend availability without treating sample fixtures as live data.
  useEffect(() => {
    let active = true;
    checkLiveApiHealth().then(async (state) => {
      if (!active) return;
      setLiveApiConnection(state);
      if (state !== 'configured') {
        setLiveFootballFeed({
          state: 'unavailable',
          matches: [],
          message: state === 'not-configured'
            ? 'A live-data provider key has not been configured on the server.'
            : 'The backend cannot be reached from this preview.',
        });
        return;
      }
      const result = await fetchLiveFootballMatches();
      if (active) setLiveFootballFeed(result);
    });
    return () => {
      active = false;
    };
  }, []);

  // Sync dark mode class to documentElement
  useEffect(() => {
    if (appSettings.darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [appSettings.darkMode]);

  // Keep the profile in step with the Supabase session (sign-in, restore on reload, token refresh, sign-out).
  useEffect(() => {
    if (!isSupabaseAuthConfigured) return;
    const { data } = onSupabaseAuthStateChange((user) => {
      setUserProfile((prev) => {
        if (!user) return prev.email ? signedOutProfile(prev) : prev;
        const next = mergeAuthenticatedUser(prev, user, DEFAULT_PROFILE);
        StorageService.saveProfileLocalOnly(next);
        return next;
      });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Auth Handlers. They throw an Error with a user-safe message on failure.
  const handleRegister = useCallback(async (newUser: UserProfile): Promise<AuthActionResult> => {
    if (!isSupabaseAuthConfigured) {
      const registered = StorageService.registerUser(newUser);
      setUserProfile(registered);
      return { status: 'signed-in' };
    }

    const { password, ...account } = newUser;
    const { data, error } = await registerWithEmail(account.email, password ?? '', account.name);
    if (error) throw new Error(describeAuthError(error.message));
    // To avoid revealing which emails exist, Supabase answers a duplicate sign-up with a user that has no identities.
    if (data.user && data.user.identities?.length === 0) {
      throw new Error(describeAuthError('User already registered'));
    }

    setUserProfile((prev) => {
      const withPreferences: UserProfile = {
        ...baseProfileFor(prev, account.email, DEFAULT_PROFILE),
        name: account.name,
        email: account.email,
        country: account.country,
        language: account.language,
        favoriteTeamId: account.favoriteTeamId,
        photoUrl: account.photoUrl,
        avatarType: account.avatarType,
        password: '',
        isAuthenticated: false,
      };
      const next = data.session && data.user
        ? mergeAuthenticatedUser(withPreferences, data.user, DEFAULT_PROFILE)
        : withPreferences;
      StorageService.saveProfileLocalOnly(next);
      return next;
    });

    if (data.session) return { status: 'signed-in' };
    return {
      status: 'confirmation-required',
      message: 'Account created. Check your email and open the confirmation link, then sign in.',
    };
  }, []);

  const handleLogin = useCallback(async (email: string, pass: string): Promise<AuthActionResult> => {
    if (!isSupabaseAuthConfigured) {
      const loggedIn = StorageService.loginUser(email, pass);
      setUserProfile(loggedIn);
      return { status: 'signed-in' };
    }

    const { data, error } = await signInWithEmail(email, pass);
    if (error) throw new Error(describeAuthError(error.message));
    if (data.user) {
      const verifiedUser = data.user;
      setUserProfile((prev) => {
        const next = mergeAuthenticatedUser(prev, verifiedUser, DEFAULT_PROFILE);
        StorageService.saveProfileLocalOnly(next);
        return next;
      });
    }
    return { status: 'signed-in' };
  }, []);

  const handleGoogleSignIn = useCallback(async (): Promise<AuthActionResult> => {
    if (!isSupabaseAuthConfigured) {
      throw new Error('Google sign-in is not connected yet. No account was created.');
    }
    const { error } = await signInWithGoogle(window.location.origin);
    if (error) throw new Error(describeAuthError(error.message));
    // The browser leaves for Google; the session is restored by the listener when it returns.
    return { status: 'redirecting' };
  }, []);

  const handleLogout = useCallback(async () => {
    if (!isSupabaseAuthConfigured) {
      setUserProfile(StorageService.logoutUser());
      return;
    }
    try {
      await signOutSupabase();
    } catch (e) {
      console.error('Sign-out request failed; signing out locally', e);
    }
    setUserProfile((prev) => {
      const next = signedOutProfile(prev);
      StorageService.saveProfileLocalOnly(next);
      return next;
    });
  }, []);

  // Persist Profile Updates
  const updateProfile = useCallback((updated: Partial<UserProfile>) => {
    setUserProfile((prev) => {
      const next = { ...prev, ...updated };
      persistProfile(next);
      return next;
    });
  }, []);

  // Persist Settings Updates
  const updateSettings = useCallback((updated: Partial<AppSettings>) => {
    setAppSettings((prev) => {
      const next = { ...prev, ...updated };
      StorageService.saveSettings(next);
      return next;
    });
  }, []);

  // Bookmark / Save match
  const toggleSaveMatch = useCallback((matchId: string) => {
    setUserProfile((prev) => {
      const isSaved = prev.savedMatches.includes(matchId);
      const nextSaved = isSaved
        ? prev.savedMatches.filter((id) => id !== matchId)
        : [...prev.savedMatches, matchId];
      const next = { ...prev, savedMatches: nextSaved };
      persistProfile(next);
      return next;
    });
  }, []);

  // Cast Fan Prediction Vote
  const castMatchVote = useCallback((matchId: string, choice: 'home' | 'draw' | 'away') => {
    setUserProfile((prevProfile) => {
      const existingVotes = prevProfile.userVotes || {};
      const previousChoice = existingVotes[matchId];

      if (previousChoice === choice) return prevProfile; // already voted this

      const nextVotes = { ...existingVotes, [matchId]: choice };
      const nextProfile = { ...prevProfile, userVotes: nextVotes };
      persistProfile(nextProfile);

      // Update match vote counts
      setMatches((prevMatches) =>
        prevMatches.map((m) => {
          if (m.id !== matchId) return m;
          const currentPoll = m.poll || { homeVotes: 100, drawVotes: 50, awayVotes: 80 };
          const updatedPoll = { ...currentPoll };

          // Subtract previous vote if re-voting
          if (previousChoice === 'home') updatedPoll.homeVotes = Math.max(0, updatedPoll.homeVotes - 1);
          if (previousChoice === 'draw') updatedPoll.drawVotes = Math.max(0, updatedPoll.drawVotes - 1);
          if (previousChoice === 'away') updatedPoll.awayVotes = Math.max(0, updatedPoll.awayVotes - 1);

          // Add new vote
          if (choice === 'home') updatedPoll.homeVotes += 1;
          if (choice === 'draw') updatedPoll.drawVotes += 1;
          if (choice === 'away') updatedPoll.awayVotes += 1;

          const updatedMatch = { ...m, poll: updatedPoll };
          // If currently viewing this match in detail modal, sync it
          setSelectedMatch((curr) => (curr && curr.id === matchId ? updatedMatch : curr));

          return updatedMatch;
        })
      );

      return nextProfile;
    });
  }, []);

  // Bookmark / Save news article
  const toggleSaveArticle = useCallback((articleId: string) => {
    setUserProfile((prev) => {
      const isSaved = prev.savedArticles.includes(articleId);
      const nextSaved = isSaved
        ? prev.savedArticles.filter((id) => id !== articleId)
        : [...prev.savedArticles, articleId];
      const next = { ...prev, savedArticles: nextSaved };
      persistProfile(next);
      return next;
    });
  }, []);

  // Derived filtered data
  const filteredMatches = matches.filter((m) => {
    const matchGroup = selectedMatchGroup === 'All' || m.group === selectedMatchGroup;
    const query = searchQuery.toLowerCase().trim();
    const matchesQuery =
      !query ||
      m.homeTeam.toLowerCase().includes(query) ||
      m.awayTeam.toLowerCase().includes(query) ||
      (m.stadium && m.stadium.toLowerCase().includes(query)) ||
      m.city.toLowerCase().includes(query);
    return matchGroup && matchesQuery;
  });

  const filteredTeams = TEAMS_DATA.filter((t) => {
    const query = searchQuery.toLowerCase().trim();
    return (
      !query ||
      t.name.toLowerCase().includes(query) ||
      t.coach.toLowerCase().includes(query) ||
      t.group.toLowerCase().includes(query) ||
      t.keyPlayers.some((p) => p.toLowerCase().includes(query))
    );
  });

  const filteredTravelSpots = TRAVEL_SPOTS_DATA.filter((ts) => {
    const categoryMatch = ts.category === selectedTravelCategory;
    const cityMatch = !selectedCity || selectedCity === 'All Cities' || ts.city.toLowerCase() === selectedCity.toLowerCase();
    const query = searchQuery.toLowerCase().trim();
    const queryMatch =
      !query ||
      ts.name.toLowerCase().includes(query) ||
      ts.address.toLowerCase().includes(query) ||
      ts.description.toLowerCase().includes(query);
    return categoryMatch && cityMatch && queryMatch;
  });

  const filteredNews = NEWS_DATA.filter((n) => {
    const query = searchQuery.toLowerCase().trim();
    return (
      !query ||
      n.title.toLowerCase().includes(query) ||
      n.category.toLowerCase().includes(query) ||
      n.summary.toLowerCase().includes(query) ||
      n.tags.some((tag) => tag.toLowerCase().includes(query))
    );
  });

  return {
    // Navigation & View
    activeTab,
    setActiveTab,
    showSplash,
    setShowSplash,
    showApkModal,
    setShowApkModal,
    liveApiConnection,
    liveFootballFeed,

    // User & Preferences
    userProfile,
    updateProfile,
    handleRegister,
    handleLogin,
    handleGoogleSignIn,
    handleLogout,
    authConfigured: isSupabaseAuthConfigured,
    appSettings,
    updateSettings,
    toggleSaveMatch,
    castMatchVote,
    toggleSaveArticle,

    // Filter controls
    selectedCity,
    setSelectedCity,
    selectedTravelCategory,
    setSelectedTravelCategory,
    selectedMatchGroup,
    setSelectedMatchGroup,
    searchQuery,
    setSearchQuery,

    // Detail Modals
    selectedTeam,
    setSelectedTeam,
    selectedMatch,
    setSelectedMatch,
    selectedArticle,
    setSelectedArticle,
    selectedStadium,
    setSelectedStadium,

    // Data collections
    teams: TEAMS_DATA,
    filteredTeams,
    matches,
    filteredMatches,
    travelSpots: TRAVEL_SPOTS_DATA,
    filteredTravelSpots,
    news: NEWS_DATA,
    filteredNews,
    stadiums: STADIUMS_DATA
  };
}
