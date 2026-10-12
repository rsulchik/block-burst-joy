# Supabase Setup Instructions

## 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Sign up / Log in
3. Click "New Project"
4. Choose a name (e.g., "block-blast")
5. Choose a database password (save it!)
6. Choose a region closest to your users
7. Click "Create new project"

## 2. Get Credentials

1. Go to Project Settings → API
2. Copy the **Project URL** - this is your `VITE_SUPABASE_URL`
3. Copy the **anon public key** - this is your `VITE_SUPABASE_ANON_KEY`

## 3. Run Migration

1. Go to SQL Editor in Supabase
2. Click "New Query"
3. Copy the contents of `supabase/migrations/001_initial_schema.sql`
4. Paste it into the editor
5. Click "Run"

This will create:
- `profiles` table (user profiles)
- `game_saves` table (game progress)
- `best_scores` table (high scores)
- Row Level Security (RLS) policies
- Triggers for automatic profile creation

## 4. Set Environment Variables

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=your_project_url_here
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

Replace with the values from step 2.

## 5. Install Supabase SDK

```bash
npm install @supabase/supabase-js
```

## 6. Test the Integration

1. Start the dev server: `npm run dev`
2. Try registering a new account
3. Check the Supabase dashboard → Table Editor → profiles to see the new user
4. Play the game and check game_saves and best_scores tables

## 7. Enable Referral Links

After the main schema is installed, open the Supabase SQL Editor and run
`supabase/migrations/006_referral_system.sql`. It adds referral codes to player
profiles and securely records which player invited a new user.

## 8. Enable Wallet Rewards

Run `supabase/migrations/007_wallet_and_daily_rewards.sql` after the previous
migrations. It creates a secure wallet balance and credits daily-task rewards
exactly once per player.

## Notes

- Phone numbers are converted to emails internally (e.g., `79991234567@blockblast.app`)
- All data is stored in Supabase, not localStorage
- RLS policies ensure users can only access their own data
- The old localStorage-based auth system is preserved in `src/lib/auth.ts` for reference
