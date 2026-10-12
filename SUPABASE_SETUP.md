# Supabase deployment and security setup

The browser intentionally uses only Supabase's public URL and anon/publishable key. The service-role key belongs only in Supabase's server-side Edge Function environment.

## 1. Configure the project

Create a Supabase project and copy its Project URL and anon/publishable key into a local `.env` file:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
# Optional: set the production origin used in referral links.
VITE_REFERRAL_BASE_URL=https://your-game.example
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` through a `VITE_*` variable or include it in a client build.

## 2. Configure authentication

The current UI accepts a phone number but adapts it to an internal email identifier (`<digits>@blockblast.app`) for legacy email/password accounts. It is **not phone verification**. For this legacy flow to create a usable session, enable the Email provider and disable email confirmation for these internal, non-deliverable addresses. Registration now requires an 8-character password and rejects a registration response without an active session.

This setting does not prove that a user owns the entered phone number. Before using this as a production identity or attaching valuable rewards to it, migrate to Supabase Phone OTP (with an SMS provider configured), or another verified identity provider. Changing the confirmation setting alone is not equivalent to phone verification.

## 3. Apply database migrations

Use the Supabase CLI from the repository root and apply **all migrations in order**. Do not run only `001_initial_schema.sql` and do not skip the later migrations:

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

The migration sequence is `001` through `008`. Migration `002_reset_schema.sql` no longer drops player tables; migration `008_verified_runs_and_safe_sync.sql` is additive. Nevertheless, take a database backup and inspect the generated migration plan before applying this to an existing production project.

Migration `008` adds save-state RPC writes, verified-run tables, and server-only score/reward recording. It also revokes client write access to best scores and task completions. The game will fall back to local-only saves and unverified local best scores until the server migration and Edge Function are deployed.

## 4. Deploy the verified-run Edge Function

Deploy `submit-game-run` after applying the database migrations:

```sh
npx supabase functions deploy submit-game-run
```

The project must provide these Edge Function environment values (Supabase normally injects them for linked projects):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — secret; server-side only

`supabase/functions/submit-game-run/config.toml` keeps JWT verification enabled. The function authenticates the caller, verifies that the run belongs to that account, replays moves from the stored seed, and then calls the service-only result RPC. Do not disable JWT verification or grant `record_verified_game_run` to `anon` or `authenticated`.

## 5. Build and verify

```sh
npm ci
npm run typecheck
npm test
npm run build
```

`npm run build` writes the static client to `.output/public` and copies the generated service worker and its Workbox runtime there. Serve the app over HTTPS (or localhost during development) for service-worker installation. After applying migrations and deploying the Edge Function, create a test account, save/continue a game, finish a run, and confirm that only verified scores and one eligible daily reward appear in Supabase.

## Important limitations

- This repository cannot apply migrations or deploy the Edge Function to your Supabase project; those commands require your project ref and operator approval.
- Phone ownership is not verified by the current legacy sign-in UI. Configure real Phone OTP before relying on account identity for production rewards.
- Offline runs are playable and their saves synchronize later, but they are not eligible for server-verified scores or rewards unless a server-issued run was started and the finished replay can be submitted.
- The score is verified server-side; no localStorage best score is published to the leaderboard.
