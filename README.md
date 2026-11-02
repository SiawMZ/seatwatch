# Seatwatch

Live seat map for ushers. Create a seating template, open a room, and invite other
ushers with a code or QR code. Everyone sees marks instantly. Counts and a JPG are
ready for the attendance report. Rooms clear 2 hours after everyone leaves.

## Run locally

```bash
npm install
npm run dev
```

With no Supabase settings, the app uses a throwaway in-memory database that runs the
real `supabase/schema.sql`. Its data is lost when the dev server restarts.

To test live sync with real Supabase on your computer (needs Docker running):

```bash
npx supabase start -x studio,storage-api,imgproxy,edge-runtime,logflare,vector,mailpit,supavisor,postgres-meta,gotrue
```

Then load `supabase/schema.sql` into it and point `.env.local` at `http://127.0.0.1:54321`.
Stop it with `npx supabase stop`.

## Go live

1. Create a free project at supabase.com.
2. In its SQL editor, run all of `supabase/schema.sql`.
3. Under Realtime settings, keep public channel access allowed.
4. Copy `.env.example` to `.env.local` and fill in the URL and publishable key.
5. Deploy to Vercel with the same variables. `vercel.json` adds a daily job that removes
   abandoned rooms and keeps the free database from pausing.

## Optional Google sign-in

Signing in keeps a person's templates in their account. Ushers never need it.

1. In Google Cloud Console, create an OAuth client (type: Web application) with this
   authorised redirect URI: `https://<your-project>.supabase.co/auth/v1/callback`.
2. In Supabase, under Authentication, then Sign In / Providers, turn on Google and paste the
   client ID and secret.
3. In Supabase, under Authentication, then URL Configuration, set the Site URL to the live
   site and add `https://<your-site>/**` to the redirect URLs (plus `http://localhost:3457/**`
   for local testing).

After pulling an update, run `supabase/schema.sql` again in the SQL editor. It's safe to re-run.

## How it's organised

- `lib/layout.ts`: turns sections into a flat list of seats. New arrangements only need a new generator.
- `lib/backend.ts`: database calls and live connection.
- `components/Room.tsx`: the live room. `components/TemplateEditor.tsx`: the template builder.
- `lib/export-jpg.ts`: draws the JPG report.
