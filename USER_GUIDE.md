# Deal me in — User Guide

This guide walks through running a poker tournament from start to finish. No technical knowledge required.

The app has these sections, reachable from the left sidebar:

- **Control Panel** — start, run, and manage tournaments.
- **Players** — your roster of players, with a profile page for each.
- **History** — past tournaments and their results.
- **Structure** — reusable blind schedules.
- **Settings** — language, accent color, and currency.
- **Projector** — design the look of the full-screen room display.

---

## 1. Before your first tournament

### Add your players

Go to **Players**. Fill in a name (required), and optionally a nickname, email, and photo, then click **Add Player**. Players appear in the table below.

- **Click a player's row** to open their **profile**, where you can change their info and photo, and review their stats and play history (see [section 8](#8-player-profiles)).
- Use **Delete** on a row to remove a player. Their personal info is cleared and they leave the roster, but their results in past tournaments are kept (they appear as `???` there).

> The app ships with a few sample players so you can try things immediately. You can delete them once you've added your own.

### Build a blind structure

A *structure* is the schedule of blind levels your tournament follows. Go to **Structure** → **Create New Structure** (this opens a separate editor window).

- Give the structure a **name** and a **starting chip** count.
- Click **Add Level** to add a blind level. Each level has a small blind, big blind, ante, and a **duration in minutes**. New levels pre-fill by doubling the previous blinds — adjust as needed.
- Click **Add Break** to insert a break (used by the projector's "next break" countdown).
- **Drag the ☰ handle** on any row to reorder levels and breaks.
- **Save & Close** when done.

> The app ships with two sample structures ("Standard Turbo" and "Deep Stack").

---

## 2. Creating a tournament

On the **Control Panel**, click **New Tournament** and fill in:

- **Tournament name** (required).
- **Structure** — which blind schedule to use.
- **Number of tables** and **Max players / table** — used to check you have enough seats. A warning appears if you've selected more players than seats.
- **Auto-Balance Tables** — when on, the app rebalances tables (and pauses the clock) when they become uneven by 2+ players.
- **Auto-Merge Tables** — when on, the app collapses a table once the remaining players fit on fewer tables.
- **Entry fee** — the amount each player pays to enter, in your chosen currency. A player's earnings for the tournament are their prize minus this fee, so a player who doesn't cash ends up negative. Leave it at 0 for a free game.
- **Prize distribution** — add a payout amount per finishing place. Empty places are ignored.
- **Select players** — tick everyone playing (use Select All / Deselect All).

Click **Create Tournament**. Players start **unassigned** — they aren't seated yet.

---

## 3. Seating players

Open **Players** on the running tournament card (the *Manage Players* window).

- Click **Randomize** to seat all unassigned players across tables automatically.
- Or **drag** an unassigned player onto any empty seat to place them manually.
- Use the **search box** to find a specific player.

The clock **cannot be started until every player is seated** — a reminder appears if players are still unassigned.

---

## 4. Running the clock

On the Control Panel tournament card:

- **Play / Pause** controls the level timer. The current level, time remaining, and blinds are shown.
- The timer advances levels automatically. When the last level ends, the clock stops.

> If auto-balance or auto-merge moves players, the clock pauses and a **Seat Movements** popup shows exactly who moved, from where, to where, and why. Resume with **Play** when the room is ready.

### Busting and un-busting players

In the **Manage Players** window:

- Click **Bust** on a seated player when they're eliminated. Their seat empties and "players remaining" decreases. The app then auto-balances or auto-merges if enabled.
- Click **Unbust** to bring a player back — they return to **unassigned** and must be re-seated (Randomize or drag). You can still pause the clock while they're unassigned.

---

## 5. The projector display

Click **Projector** on the tournament card to open a full-screen window — put it on a second monitor or projector for the room. It shows:

- The wall clock, total elapsed time, and a **countdown to the next break**.
- The big level countdown, current blinds/ante, and the **next** level's blinds.
- **Players remaining / total entries** and the **average stack**.
- The **prize distribution**.

It updates live and needs no interaction. Close it any time; the tournament keeps running.

---

## 6. Ending a tournament

When you're done, click **Terminate** on the tournament card. This opens the **Finalize Standings** dialog so the results get recorded correctly:

- **Eliminated players** are already placed by the order they busted out (first out = last place). Their time played is how long they lasted.
- **Players still in** are listed at the top. Use the **↑ / ↓** arrows to put them in their finishing order (1st, 2nd, …). Usually you'll just confirm the winner.
- Each row shows the place, time played, prize, and **earnings** (prize minus the entry fee).

Then choose:

- **Save Results & Archive** — records every player's place, playtime, and earnings, and moves the tournament to **History**.
- **Archive without results** — just files the tournament away with no per-player results (it will show an empty results page in History).
- **Cancel** — keeps the tournament running; nothing is saved.

> Running several tournaments at once? Others appear under **Other Running Tournaments** with a **Switch to** button. Tournaments are saved automatically and restored (paused) if you close and reopen the app.

---

## 7. History

The **History** section lists every past tournament with its date, name, structure, number of players, winner, and prize pool.

**Click a tournament** to open its results page:

- A summary (structure, entrants, entry fee, prize pool, total duration).
- The full **rankings** — place, player, time played, prize, and earnings. Green earnings mean a profit, red a loss.
- Click any (non-deleted) player to jump to their profile.

Use **Delete** on a row to permanently remove a tournament and its results. This cannot be undone.

---

## 8. Player profiles

Click any player in the **Players** list to open their profile:

- **Player info** — edit name, nickname, email, and photo, then **Save**. (This is where player editing lives now.)
- **Statistics** — tournaments played, total playtime, total earnings, best finish, wins, and number of cashes.
- **Play history** — every tournament they entered, with date, place, playtime, and earnings. Click a row to open that tournament's results.

---

## 9. Settings

Under **Settings** you can change:

- **Language** — English or Français.
- **Accent color** — the highlight color used across the app.
- **Currency** — how prize amounts are formatted (EUR / USD / GBP / CHF). The currency is recorded with each tournament when it's created, so past results keep the currency they were played in.

Changes apply immediately to every open window.
