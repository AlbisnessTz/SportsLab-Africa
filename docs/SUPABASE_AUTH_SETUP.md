# Supabase authentication foundation

SportsLab Africa has a Supabase Auth service layer prepared, but authentication is **not yet connected to the Profile screen or verified end-to-end**. Do not describe login as production-ready until the integration, provider configuration, and tests are complete.

## Configuration

1. Create or open the SportsLab Africa project at https://supabase.com/dashboard.
2. In Project Settings / API, copy the Project URL and the public anon/publishable key.
3. Set these as frontend build environment variables in the local development environment and hosting provider:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. In Supabase Authentication settings, configure the app's local and production redirect URLs.
5. Enable Email provider. Configure email confirmation and password recovery settings.
6. For Google sign-in, enable the Google provider in Supabase and add the Google OAuth client ID/secret in the Supabase dashboard. Set the exact Supabase callback URL in Google Cloud and the app redirect URLs in Supabase.
7. Never use or expose a Supabase `service_role`/secret key in frontend code, `VITE_` variables, or GitHub.

## Current status and limitations

- `src/services/supabaseAuthService.ts` provides the browser client (guarded by environment configuration), email registration/login, Google OAuth initiation, sign-out, current-user retrieval and an auth-state subscription.
- **The Profile screen is now connected.** When `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set, `useAppViewModel` registers, signs in and signs out through Supabase, restores the session on reload, and shows "Continue with Google" on the sign-in form.
- Without those variables the app keeps the local prototype login (see `AUTHENTICATION_STATUS.md`) and hides the Google button, so nothing pretends to authenticate.
- With Supabase configured, passwords are never written to browser storage, the prototype user directory is no longer written, and passwords left over from the prototype are stripped on startup (profiles and bookmarks are kept).
- A real account must be backed by a live Supabase session. Only email-less local guests stay signed in from browser storage alone.
- If email confirmation is enabled in Supabase, registration shows a "check your email" message and the person signs in after confirming.
- Switching to a different account on the same browser starts a clean local profile, so saved items never leak between accounts.
- **Not yet verified end-to-end against a real Supabase project.** Unit tests cover the profile/merge/storage logic, but the full flow (registration, confirmation email, login, Google redirect, sign-out) still needs a test run with real project credentials.
- Favourites, bookmarks and votes are still stored locally per browser. Syncing them across devices needs access-controlled tables with Row Level Security first.
- Google OAuth will not work until provider credentials and redirect URLs are configured.
- The public anon/publishable key is not a secret, but it is not an authorization mechanism; configure Row Level Security for any user data stored in Supabase.
