import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const {
  mapAuthUserToProfile,
  baseProfileFor,
  mergeAuthenticatedUser,
  signedOutProfile,
  describeAuthError,
} = await import('../src/services/authProfile.ts');

const defaults = {
  name: 'Sports Fan',
  email: '',
  password: '',
  country: 'Tanzania',
  language: 'English',
  favoriteTeamId: 'tan',
  photoUrl: 'default.png',
  avatarType: 'preset',
  isAuthenticated: false,
  savedMatches: [],
  savedArticles: [],
};

test('maps a Supabase user to a profile name from metadata, then email, never from a provider label', () => {
  assert.equal(mapAuthUserToProfile({ email: 'a@b.com', user_metadata: { full_name: ' Juma Hamisi ' } }).name, 'Juma Hamisi');
  assert.equal(mapAuthUserToProfile({ email: 'a@b.com', user_metadata: { name: 'Neema' } }).name, 'Neema');
  assert.equal(mapAuthUserToProfile({ email: 'amina@example.com', user_metadata: {} }).name, 'amina');
  assert.equal(mapAuthUserToProfile({ email: null }).name, 'Sports Supporter');
  assert.equal(mapAuthUserToProfile({ email: 'a@b.com' }).isAuthenticated, true);
});

test('guest bookmarks carry over when a guest signs in', () => {
  const guest = { ...defaults, isAuthenticated: true, savedMatches: ['m1'], savedArticles: ['n1'] };
  const merged = mergeAuthenticatedUser(guest, { email: 'Juma@Example.com', user_metadata: { full_name: 'Juma' } }, defaults);
  assert.deepEqual(merged.savedMatches, ['m1']);
  assert.deepEqual(merged.savedArticles, ['n1']);
  assert.equal(merged.email, 'Juma@Example.com');
  assert.equal(merged.name, 'Juma');
  assert.equal(merged.isAuthenticated, true);
});

test('a different account never inherits the previous account\'s saved items', () => {
  const previous = { ...defaults, email: 'one@example.com', name: 'One', savedMatches: ['m1'], country: 'Kenya' };
  const merged = mergeAuthenticatedUser(previous, { email: 'two@example.com', user_metadata: { full_name: 'Two' } }, defaults);
  assert.deepEqual(merged.savedMatches, []);
  assert.equal(merged.country, 'Tanzania');
  assert.equal(merged.name, 'Two');
  assert.equal(baseProfileFor(previous, 'ONE@example.com', defaults), previous);
});

test('session refreshes keep a name the person chose locally for the same account', () => {
  const local = { ...defaults, email: 'juma@example.com', name: 'Juma H.', savedMatches: ['m2'] };
  const merged = mergeAuthenticatedUser(local, { email: 'JUMA@example.com', user_metadata: { full_name: 'Juma Hamisi' } }, defaults);
  assert.equal(merged.name, 'Juma H.');
  assert.deepEqual(merged.savedMatches, ['m2']);
});

test('authenticated and signed-out profiles never carry a password', () => {
  const withPassword = { ...defaults, email: 'a@b.com', password: 'secret' };
  assert.equal(mergeAuthenticatedUser(withPassword, { email: 'a@b.com' }, defaults).password, '');
  const out = signedOutProfile({ ...withPassword, isAuthenticated: true });
  assert.equal(out.password, '');
  assert.equal(out.isAuthenticated, false);
  assert.equal(out.email, 'a@b.com');
});

test('provider errors become short user-safe messages', () => {
  assert.match(describeAuthError('Invalid login credentials'), /Invalid email or password/);
  assert.match(describeAuthError('Email not confirmed'), /confirm your email/);
  assert.match(describeAuthError('User already registered'), /already exists/);
  assert.match(describeAuthError('email rate limit exceeded'), /Too many attempts/);
  assert.match(describeAuthError('Failed to fetch'), /Could not reach/);
  assert.equal(describeAuthError('Password should be at least 6 characters.'), 'Password should be at least 6 characters.');
  assert.match(describeAuthError(undefined), /Something went wrong/);
});

test('server-backed accounts never write passwords to browser storage', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
  };
  const { StorageService } = await import('../src/services/storageService.ts');

  StorageService.saveProfileLocalOnly({ ...defaults, email: 'a@b.com', password: 'secret', isAuthenticated: true });
  const saved = JSON.parse(store.get('sportslab_africa_user_profile_v1'));
  assert.equal('password' in saved, false);
  assert.equal(saved.email, 'a@b.com');
  assert.equal(store.has('sportslab_africa_registered_users_v1'), false, 'prototype user directory must not be written');

  // Passwords left over from the prototype login are removed; profiles and bookmarks are kept.
  store.set('sportslab_africa_registered_users_v1', JSON.stringify([{ ...defaults, email: 'old@b.com', password: 'plain', savedMatches: ['m9'] }]));
  store.set('sportslab_africa_user_profile_v1', JSON.stringify({ ...defaults, email: 'old@b.com', password: 'plain', savedMatches: ['m9'] }));
  StorageService.stripStoredPasswords();
  const users = JSON.parse(store.get('sportslab_africa_registered_users_v1'));
  const profile = JSON.parse(store.get('sportslab_africa_user_profile_v1'));
  assert.equal('password' in users[0], false);
  assert.equal('password' in profile, false);
  assert.deepEqual(users[0].savedMatches, ['m9']);
  assert.deepEqual(profile.savedMatches, ['m9']);
});

test('the active profile screen signs in through the view-model, with Google offered only when configured', async () => {
  const app = await read('../src/App.tsx');
  const vm = await read('../src/viewmodels/useAppViewModel.ts');
  const profile = await read('../src/components/ProfileScreen.tsx');
  assert.match(app, /onGoogleSignIn=\{vm\.authConfigured \? vm\.handleGoogleSignIn : undefined\}/);
  assert.match(vm, /isSupabaseAuthConfigured/);
  assert.match(vm, /signInWithEmail\(email, pass\)/);
  assert.match(vm, /registerWithEmail\(/);
  assert.match(vm, /signOutSupabase\(\)/);
  assert.match(profile, /\{onGoogleSignIn && \(/);
  assert.doesNotMatch(vm, /VITE_SUPABASE_SERVICE|service_role/);
});
