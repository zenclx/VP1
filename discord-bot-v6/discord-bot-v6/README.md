# Discord Tournament Bot — v6

A feature-rich Discord bot for managing tournaments, scoreboards, and match brackets.

---

## ⚙️ Setup

1. Copy `.env.example` → `.env` and fill in your tokens.
2. `npm install`
3. `node index.js`

The bot auto-registers slash commands on startup.

---

## 📋 All Commands

### 🏆 Scoreboard
| Command | Description |
|---|---|
| `/scoreboard name:X` | Create a live scoreboard in the channel |
| `/addwin user:@ scoreboard:X` | Add 1 win to a user |
| `/removewin user:@ scoreboard:X` | Remove 1 win from a user |
| `/score user:@` | Check a user's score and rank |
| `/listscoreboards` | List all scoreboards in this server |
| `/resetscoreboard` | Reset a scoreboard to zero |
| `/deletescoreboard` | Delete a scoreboard entirely |

### 📅 Season System
| Command | Description |
|---|---|
| `/newseason scoreboard:X` | Archive the current season and reset scores |
| `/season number:1 scoreboard:X` | View results from a past season |

### ⚔️ Match Management
| Command | Description |
|---|---|
| `/creatematch type:1v1\|2v2 scoreboard:X prize:X` | Open a match queue |
| `/pickwinner matchid: match_number: winner:@` | Manually declare a round winner |
| `/matchlog` | View recent match results |
| `/resetmatchnumber` | Reset the match counter |
| `/spectate matchid:X` | Get read-only access to a match channel |
| `/schedulematch time: type: prize:` | Schedule a match to auto-open at a time |

### 📊 Info & Analytics
| Command | Description |
|---|---|
| `/dashboard` | See active matches, recent results, top scores, and scheduled matches at a glance |
| `/mvp scoreboard:X` | Calculate and announce the MVP based on opponent quality |
| `/achievements user:@` | View earned achievement badges |

### 🛠️ Admin
| Command | Description |
|---|---|
| `/setroles` | Set which roles can use scoreboard commands |
| `/setlogchannel` | Set the match log channel |
| `/export type: scoreboard:` | Export scoreboard/match history as CSV |
| `/newseason` | Archive season & reset (Admin only) |

---

## 🆕 v6 Features

### 📦 Season System
- `/newseason` archives the current scoreboard into history and resets scores
- `/season 1` lets players look back at any past season's results and champion

### 🌟 Most Valuable Player
- `/mvp` calculates MVP at the end of a tournament based on who beat the highest-ranked opponents

### 🗳️ Bo3 Match Format Voting
- When a match starts, the private channel gets a **60-second vote** on format:
  - Best of 3 (all matches)
  - Finals only Bo3
  - Standard Bo1
- Results are displayed after the vote closes

### 👥 2v2 Team Auto-Pairing
- 2v2 queues now auto-pair players into **Team A vs Team B**
- Teams are shown in the bracket and the public queue message

### ⏰ Match Reminders
- If a bracket match has no winner after **15 minutes**, the bot pings both players in the private channel

### 👁️ Spectator Role
- `/spectate matchid:X` gives any server member read-only access to the match channel

### 🎯 Predictions
- Before each bracket match, a prediction poll appears in the match channel
- Anyone can vote on who they think will win
- Results are revealed automatically when the winner is selected

### 🏅 Achievement Badges
Roles are **auto-created** and assigned when milestones are hit:
| Achievement | Trigger |
|---|---|
| 🩸 First Blood | First win ever |
| 🎖️ Veteran | 10 total wins |
| 💎 Elite | 25 total wins |
| 🔱 Legend | 50 total wins |
| 🔥 On Fire | 5-win streak |
| 🏆 Tournament Champion | Won a tournament |

### 📅 Scheduled Matches
- `/schedulematch time:"Saturday 3pm" type:1v1` — bot posts a countdown and auto-opens at the right time
- Supports: `Saturday 3pm`, `tomorrow 5pm`, `in 2 hours`, `in 30 minutes`
- Timers survive bot restarts

### 📊 Dashboard
- `/dashboard` shows a single embed with:
  - Active matches (status + channel link)
  - Recent results
  - Top 3 scoreboard
  - Upcoming scheduled matches

### 📬 DM Notifications
- When a match starts, **all players are DM'd** with the match channel link
- When you advance to the next round, you get a DM
- Tournament winner gets a congratulations DM

### 📤 Export
- `/export type:Both` downloads scoreboard and match history as **CSV files**

---

## 🔧 Hardcoded IDs (update in `commands/creatematch.js`)

```js
const MATCH_MANAGER_ROLES = ['YOUR_ROLE_ID'];
const MATCH_CATEGORY_ID = 'YOUR_CATEGORY_ID';
```

And in `commands/addwin.js`:
```js
const ADDWIN_ROLES = ['YOUR_ROLE_ID'];
```
