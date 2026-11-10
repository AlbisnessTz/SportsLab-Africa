# Authentication status — SportsLab Africa

## Current behavior

- Email registration asks users to enter their own display name and stores that name in the local browser profile.
- Email sign-in loads the saved profile name.
- Earlier Google, Apple and phone buttons created fabricated sample identities. Those buttons have been changed so they no longer authenticate a user or create a fake profile.
- Existing fabricated sample identities are removed from the active local profile during migration, while saved match/article bookmarks are retained.

## Supabase integration (opt-in)

When `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are configured, the Profile screen uses Supabase Auth for email registration, sign-in, Google sign-in and sign-out, and no passwords are stored in the browser. See `SUPABASE_AUTH_SETUP.md`. This path has unit-test coverage but has **not yet been verified end-to-end against a real Supabase project**.

## Important limitation (prototype mode)

When Supabase is **not** configured, the email account flow is a front-end prototype using browser local storage; it is **not production-grade authentication**. Passwords are not protected by a trusted identity backend. Google OAuth, Apple sign-in and phone OTP are not connected yet.

Before public production launch, connect a real authentication provider and verify identities server-side. Use the verified provider profile's display name first, then the email address as a fallback; never infer a real identity from a provider label. Do not store provider access tokens or plain-text passwords in browser storage.

## PWA

The project now includes a SportsLab Africa web manifest, SVG app icon, and service worker for the app shell. This is a Progressive Web App, not a published or digitally signed Android APK. Verify installability on the actual deployed HTTPS origin; preview environments can behave differently.
