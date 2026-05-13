# 🏆 Discord Scoreboard & Match Bot

A fully featured Discord bot for competitive tracking with live scoreboards, win management, and auto-bracketed matches.

---

## ⚡ Quick Setup

### 1. Create your Discord Bot

1. Go to https://discord.com/developers/applications
2. Click **New Application** → give it a name
3. Go to **Bot** tab → click **Add Bot**
4. Under **Token**, click **Reset Token** and copy it
5. Enable **Server Members Intent** under Privileged Gateway Intents
6. Go to **OAuth2 → URL Generator**
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Read Messages/View Channels`, `Embed Links`, `Read Message History`, `Manage Messages` (for pinning)
7. Copy the generated URL and open it to invite the bot to your server

### 2. Get your IDs

- **CLIENT_ID**: Discord Developer Portal → Your App → General Information → Application ID
- **GUILD_ID**: Right-click your server name in Discord → Copy Server ID (enable Developer Mode in settings first)

### 3. Configure the bot

```bash
cp .env.example .env
```

Edit `.env`:
```
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_client_id_here
GUILD_ID=your_server_id_here
```

### 4. Run it

```bash
npm start
```

---

## 📋 Commands

| Command | Description |
|---|---|
| `/scoreboard name:X` | Create a live scoreboard in the current channel |
| `/addwin user:@X [scoreboard:Y] [amount:N]` | Add win(s) to a user |
| `/removewin user:@X [scoreboard:Y] [amount:N]` | Remove win(s) from a user |
| `/score user:@X [scoreboard:Y]` | View a user's score and rank |
| `/resetscoreboard scoreboard:X` | Reset all scores (with confirmation) |
| `/deletescoreboard scoreboard:X` | Delete a scoreboard permanently |
| `/listscoreboards` | Show all scoreboards in the server |
| `/setroles role1:X [role2..5]` | Set which roles can use bot commands (Admin only) |
| `/creatematch type:1v1\|2v2 [scoreboard:Y]` | Open a 5-minute queue, then auto-bracket |

---

## 🎮 Match Flow

1. Run `/creatematch type:1v1` (or `2v2`)
2. Players click **Join Queue** ⚔️
3. After **5 minutes** (or when queue fills), bracket auto-generates
4. Authorized roles click **[Player] wins** buttons to advance the bracket
5. Wins are **automatically credited** to the scoreboard you specified
6. Final winner is announced 🏆

---

## 🏅 Scoreboard Features

- **Live updates** — scoreboard message edits in place automatically
- **Rank medals** — 🥇 🥈 🥉 for top 3
- **User mentions** — players are tagged with @
- **Dark blue** outline on all embeds
- **Pinned message** — scoreboard is auto-pinned in the channel

---

## 🔐 Role Permissions

- Run `/setroles` as a server admin to pick which roles can use bot commands
- Admins can always use all commands regardless
- If no roles are set, all members can use commands

---

## 📁 File Structure

```
discord-bot/
├── index.js           ← Main entry point + button handler
├── database.js        ← JSON file storage
├── utils.js           ← Shared helpers
├── commands/
│   ├── scoreboard.js
│   ├── addwin.js
│   ├── removewin.js
│   ├── score.js
│   ├── resetscoreboard.js
│   ├── deletescoreboard.js
│   ├── listscoreboards.js
│   ├── setroles.js
│   └── creatematch.js
├── data.json          ← Auto-created on first run
├── .env               ← Your secrets (never commit this)
└── package.json
```

---

## 🚀 Running 24/7

- **Free cloud**: Use [Railway](https://railway.app) or [Render](https://render.com) — push this folder and set the env vars in their dashboard
- **VPS**: Use `pm2 start index.js --name scorebot` to keep it alive
- **Local**: Just `npm start` in your terminal


---

## ☁️ Deploying to Render (Free)

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "initial bot"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 2. Create a Render Web Service
1. Go to https://render.com and sign up / log in
2. Click **New → Web Service**
3. Connect your GitHub repo
4. Render will auto-detect `render.yaml` — just confirm the settings
5. Under **Environment Variables**, add:
   - `DISCORD_TOKEN` = your bot token
   - `CLIENT_ID` = your application ID
   - `GUILD_ID` = your server ID
6. Click **Deploy**

### 3. Keep it alive (free tier)
Render free instances sleep after 15 minutes of inactivity. The bot includes a built-in HTTP server on `process.env.PORT` that Render pings to keep it awake. For extra reliability, use a free uptime monitor like https://uptimerobot.com pointing at your Render URL.

### Adding `/pickwinner` — Manual Winner Override
If buttons aren't accessible (e.g. on mobile or the match message is gone), admins can run:
```
/pickwinner matchid:<ID shown in bracket footer> match_number:1 winner:@username
```
- The Match ID is displayed in the **footer of every bracket embed**
- Only the two actual participants can be declared winner — bot validates this
- Works identically to the button: credits the win, advances the bracket, updates the live embed

