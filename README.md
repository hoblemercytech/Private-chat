# Threadline — Private Chat App Setup

## 1. Supabase project setup

1. Go to [supabase.com](https://supabase.com) → create a new project.
2. Once it's ready, open **SQL Editor** → **New query**.
3. Paste the entire contents of `supabase-setup.sql` and click **Run**.
   This creates all tables, the `join_room_safely` / `create_room_safely` /
   `get_room_preview` functions, RLS policies, and the private `chat-images`
   storage bucket, and enables Realtime on `messages` and `room_members`.
4. Go to **Storage** and confirm a bucket named `chat-images` exists and is
   **not public**.
5. Go to **Database → Replication** and confirm `messages` and
   `room_members` are listed as enabled (the SQL script does this
   automatically, but it's worth a glance).
6. Go to **Project Settings → API** and copy:
   - Project URL
   - `anon` public API key

## 2. Connect the frontend to your project

Open `supabase.js` and replace:

```js
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
```

with your actual values from step 1.6. That's the only file you need to edit.

## 3. Test locally

Since this is plain HTML/CSS/JS with no build step, you can open it with any
static file server. From the project folder:

```bash
npx serve .
```

or, in Python:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000/index.html`. Opening `index.html` directly
via `file://` will NOT work — the browser blocks `fetch`/CORS requests
Supabase needs from `file://` origins, so use a local server.

## 4. Deploying to Vercel

**Option A — Vercel dashboard (easiest from a phone):**

1. Push this project folder to a GitHub repo (GitHub's mobile web UI lets
   you create a repo and upload files directly, no git CLI needed).
2. Go to [vercel.com](https://vercel.com) → **Add New → Project**.
3. Import the GitHub repo.
4. Framework preset: choose **Other** (this is a static site, no build
   command needed).
5. Leave build command and output directory blank — Vercel will serve the
   files as-is.
6. Click **Deploy**.

**Option B — Vercel CLI (if you get shell/terminal access later):**

```bash
npm i -g vercel
vercel --prod
```

Once deployed, your invite links will look like:

```
https://your-project.vercel.app/join-room.html?token=abc123...
```

## 5. How the pieces fit together

| File | Purpose |
|---|---|
| `app.js` | Guest ID, profile, recent chats (Local Storage), HTML escaping, image compression, formatting helpers |
| `supabase.js` | Supabase client — **edit this with your project keys** |
| `rooms.js` | Create room, join room, homepage recent-chats rendering |
| `chat.js` | Membership verification, message history, realtime messages, presence (online/offline), image upload + full-screen viewer |
| `index.html` | Homepage (recent chats list) |
| `create-room.html` | Create-room form |
| `join-room.html` | Join-room form (opened via invite link) |
| `chat.html` | The chat room itself |
| `style.css` | All styling, mobile-first with a desktop split-view breakpoint |
| `supabase-setup.sql` | Run once in Supabase SQL Editor — tables, functions, RLS, storage bucket |

## 6. Security notes (read before sharing widely)

This app has **no login system** — every browser generates a random guest ID
stored in Local Storage, and Supabase Row Level Security policies use that ID
(sent as an `x-guest-id` header on every request) to decide who can read or
write what. This is enough to keep a casual private chat link private between
the people who joined it, but it is **not strong authentication**:

- Anyone who could inspect or guess another person's guest ID could
  theoretically act as them — there's no password behind it.
- Clearing Local Storage loses that browser's identity in every room.
- There's no account recovery.

Use this for casual group chats you share via link — not for anything
confidential, financial, medical, or otherwise sensitive.

## 7. Room capacity enforcement

Room capacity (2–10 members) is enforced **inside Postgres**, not just in the
browser: `join_room_safely()` locks the room row (`FOR UPDATE`) before
counting members, so two people opening the same invite link at the exact
same moment can't both take the last open seat.

When a room is full or an invite link is invalid, `join-room.html` and
`chat.html` show **only a spinner** — no "room full" or "access denied"
message, and no room data is ever fetched for that visitor (RLS blocks it at
the database level even if someone tampers with the JavaScript).
