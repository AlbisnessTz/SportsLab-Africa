import type { UserProfile } from '../types';

/**
 * Pure account/profile helpers. Nothing here touches the browser, localStorage or the Supabase
 * client, so the logic can be unit-tested in Node.
 */

/** The minimal shape of an authenticated user that these helpers need (compatible with Supabase's User). */
export interface AuthUserLike {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

export type AuthActionResult =
  | { status: 'signed-in' }
  | { status: 'confirmation-required'; message: string }
  | { status: 'redirecting' };

export function mapAuthUserToProfile(user: AuthUserLike): Pick<UserProfile, 'name' | 'email' | 'isAuthenticated'> {
  const metadata = user.user_metadata ?? {};
  const nameValue = metadata.full_name ?? metadata.name ?? metadata.display_name;
  const name = typeof nameValue === 'string' && nameValue.trim()
    ? nameValue.trim()
    : (user.email?.split('@')[0] || 'Sports Supporter');

  return { name, email: user.email ?? '', isAuthenticated: true };
}

const sameEmail = (a?: string | null, b?: string | null) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/**
 * Chooses the profile to build on when an account signs in or registers.
 * - Guest (no email) or the same account: keep the local profile (bookmarks, votes, preferences).
 * - A different account: start clean so one person's saved items never leak into another account
 *   on a shared device.
 */
export function baseProfileFor(prev: UserProfile, email: string, defaults: UserProfile): UserProfile {
  const prevEmail = (prev.email ?? '').trim();
  return prevEmail && !sameEmail(prevEmail, email) ? defaults : prev;
}

/** Applies a verified Supabase user to the local profile. Never carries a password. */
export function mergeAuthenticatedUser(prev: UserProfile, user: AuthUserLike, defaults: UserProfile): UserProfile {
  const mapped = mapAuthUserToProfile(user);
  const base = baseProfileFor(prev, mapped.email, defaults);
  const sameAccount = Boolean((prev.email ?? '').trim()) && sameEmail(prev.email, mapped.email);
  // Keep a name the person chose locally, otherwise refreshes of the session would overwrite it.
  const keepLocalName = sameAccount && Boolean(prev.name?.trim()) && prev.name !== defaults.name;

  return {
    ...base,
    name: keepLocalName ? prev.name : mapped.name,
    email: mapped.email,
    password: '',
    isAuthenticated: true,
  };
}

export function signedOutProfile(prev: UserProfile): UserProfile {
  return { ...prev, password: '', isAuthenticated: false };
}

/** Turns provider error text into short, user-safe messages. */
export function describeAuthError(message?: string | null): string {
  const text = (message ?? '').toLowerCase();
  if (text.includes('invalid login credentials')) {
    return 'Invalid email or password. Please check your details and try again.';
  }
  if (text.includes('email not confirmed')) {
    return 'Please confirm your email address first. Check your inbox for the confirmation link.';
  }
  if (text.includes('already registered') || text.includes('already been registered')) {
    return 'An account with this email address already exists. Please sign in instead.';
  }
  if (text.includes('rate limit') || text.includes('too many')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (text.includes('failed to fetch') || text.includes('network')) {
    return 'Could not reach the sign-in service. Check your connection and try again.';
  }
  return message?.trim() || 'Something went wrong. Please try again.';
}
