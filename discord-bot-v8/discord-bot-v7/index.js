

// AUTO ELO LEADERBOARD UPDATE
async function refreshEloLeaderboard(channel, eloData) {
  if (!channel) return;

  const sorted = Object.entries(eloData)
    .sort((a, b) => (b[1].elo || 0) - (a[1].elo || 0))
    .slice(0, 20);

  const lines = await Promise.all(sorted.map(async ([id, data], i) => {
    let userTag = id;

    try {
      const user = await channel.client.users.fetch(id);
      userTag = user.tag;
    } catch {}

    return `**${i + 1}.** ${userTag} • ${data.elo || 0} ELO • ${data.wins || 0}W-${data.losses || 0}L`;
  }));

  return lines.join('\n');
}

require('dotenv').config();
require('./keepalive');
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('./database');
const { buildScoreboardEmbed } = require('./utils');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
client.commands = new Collection();

const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(f => f.endsWith('.js'));
const commandsData = [];
for (const file of commandFiles) {
  const imported = require(`./commands/${file}`);

  // Single command export
  if (imported.data && imported.execute) {
    client.commands.set(imported.data.name, imported);
    commandsData.push(imported.data.toJSON());
    continue;
  }

  // Multiple command exports
  for (const value of Object.values(imported)) {
    if (value?.data && value?.execute) {
      client.commands.set(value.data.name, value);
      commandsData.push(value.data.toJSON());
    }
  }
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commandsData });
    console.log('✅ Commands registered!');
  } catch (e) { console.error('Failed to register commands:', e); }
}

function restoreScheduledMatches() {
  const data = db.get();
  try {
    const { scheduledTimers } = require('./commands/schedulematch');
    for (const [id, s] of Object.entries(data.scheduledMatches || {})) {
      const delay = s.startsAt - Date.now();
      if (delay <= 0) { delete data.scheduledMatches[id]; continue; }
      const timer = setTimeout(async () => {
        scheduledTimers.delete(id);
        try {
          const fresh = db.get();
          if (!fresh.scheduledMatches?.[id]) return;
          delete fresh.scheduledMatches[id];
          db.set(fresh);
          const ch = await client.channels.fetch(s.channelId);
          const { EmbedBuilder } = require('discord.js');
          const embed = new EmbedBuilder().setTitle('⚔️ Scheduled Match — Queue Now Open!').setColor(0x00c853)
            .setDescription(`The scheduled ${s.type.toUpperCase()} match is now open! Use \`/creatematch\` to start.`).setTimestamp();
          if (s.prize) embed.addFields({ name: '🎁 Prize', value: s.prize });
          await ch.send({ content: '@here', embeds: [embed] });
        } catch (e) { console.error('Restore scheduled match error:', e.message); }
      }, delay);
      scheduledTimers.set(id, timer);
    }
    db.set(data);
  } catch {}
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
  restoreScheduledMatches();
});

// ── Match number helpers ──────────────────────────────────────────────────────
function getNextMatchNumber(guildId) {
  const data = db.get();
  if (!data.matchCounters) data.matchCounters = {};
  const next = (data.matchCounters[guildId] ?? -1) + 1;
  data.matchCounters[guildId] = next;
  db.set(data);
  return next;
}

function resetMatchCounter(guildId) {
  const data = db.get();
  if (!data.matchCounters) data.matchCounters = {};
  data.matchCounters[guildId] = -1;
  db.set(data);
}

client.on('interactionCreate', async interaction => {
  // Autocomplete
  if (interaction.isAutocomplete()) {
    const cmd = client.commands.get(interaction.commandName);
    if (cmd?.autocomplete) try { await cmd.autocomplete(interaction); } catch {}
    return;
  }

  // Slash commands
  if (interaction.isChatInputCommand()) {
    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) return;
    try { await cmd.execute(interaction, { getNextMatchNumber, resetMatchCounter }); }
    catch (e) {
      console.error(e);
      const p = { content: '❌ An error occurred.', flags: 64 };
      if (interaction.replied || interaction.deferred) await interaction.followUp(p).catch(() => {});
      else await interaction.reply(p).catch(() => {});
    }
    return;
  }

  if (!interaction.isButton()) return;
  const { customId } = interaction;

  // ── Scoreboard: reset ─────────────────────────────────────────────────────
  if (customId.startsWith('reset_confirm_')) {
    const sbId = customId.replace('reset_confirm_', '');
    const data = db.get();
    const sb = data.scoreboards[sbId];
    if (!sb) return interaction.update({ content: '❌ Not found.', components: [] });
    sb.scores = {};
    data.scoreboards[sbId] = sb;
    db.set(data);
    try {
      const ch = await client.channels.fetch(sb.channelId);
      const msg = await ch.messages.fetch(sb.messageId);
      await msg.edit({ embeds: [buildScoreboardEmbed(sb)] });
    } catch {}
    return interaction.update({ content: `✅ **${sb.name}** has been reset.`, components: [] });
  }
  if (customId === 'reset_cancel') return interaction.update({ content: 'Cancelled.', components: [] });

  // ── Scoreboard: delete ────────────────────────────────────────────────────
  if (customId.startsWith('delete_confirm_')) {
    const sbId = customId.replace('delete_confirm_', '');
    const data = db.get();
    const sb = data.scoreboards[sbId];
    if (!sb) return interaction.update({ content: '❌ Not found.', components: [] });
    try { const ch = await client.channels.fetch(sb.channelId); const msg = await ch.messages.fetch(sb.messageId); await msg.delete(); } catch {}
    const name = sb.name;
    delete data.scoreboards[sbId];
    db.set(data);
    return interaction.update({ content: `🗑️ **${name}** deleted.`, components: [] });
  }
  if (customId === 'delete_cancel') return interaction.update({ content: 'Cancelled.', components: [] });

  // Load match helpers
  const {
    buildQueueEmbed, timers, startBracket, canManageMatch, scheduleChannelDelete,
    buildNextRound, fetchDisplayNames, postOrUpdateBracket, logMatchResult,
    revealPrediction, scheduleMatchReminder, dmUser, postPredictionPoll,
  } = require('./commands/creatematch');
  const { checkAchievements } = require('./commands/achievements');
  const { applyMatchElo, buildMatchEloSummary, getEloData } = require('./commands/elo');

  function makeJoinRow(matchId) {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`join_queue_${matchId}`).setLabel('Join Queue').setStyle(ButtonStyle.Success).setEmoji('⚔️'),
      new ButtonBuilder().setCustomId(`leave_queue_${matchId}`).setLabel('Leave Queue').setStyle(ButtonStyle.Secondary).setEmoji('🚪'),
      new ButtonBuilder().setCustomId(`addminute_${matchId}`).setLabel('+1 Minute').setStyle(ButtonStyle.Secondary).setEmoji('⏱️'),
      new ButtonBuilder().setCustomId(`forcestart_${matchId}`).setLabel('Force Start').setStyle(ButtonStyle.Danger).setEmoji('🚀'),
    );
  }

  // ── Bo3 vote buttons ──────────────────────────────────────────────────────
  // Format: bo3|matchId|choice
  if (customId.startsWith('bo3|')) {
    const parts = customId.split('|');
    const choice = parts[parts.length - 1]; // all / finals / none / close
    const voteId = parts.slice(0, -1).join('|'); // bo3|matchId

    if (choice === 'close') {
      if (!canManageMatch(interaction.member)) return interaction.reply({ content: '❌ Staff only.', flags: 64 });
      const finisher = global._bo3Finishers?.get(voteId);
      if (finisher) { await finisher(); global._bo3Finishers.delete(voteId); }
      return interaction.reply({ content: '✅ Bo3 vote closed.', flags: 64 });
    }

    const data = db.get();
    const vote = data.bo3votes?.[voteId];
    if (!vote || vote.closed) return interaction.reply({ content: '❌ Vote is closed.', flags: 64 });
    vote.votes[interaction.user.id] = choice;
    db.set(data);
    const labels = { all: 'Bo3 All', finals: 'Finals Only Bo3', none: 'Standard Bo1' };
    return interaction.reply({ content: `✅ Vote recorded: **${labels[choice] || choice}**`, flags: 64 });
  }

  // ── Region vote buttons ───────────────────────────────────────────────────
  // Format: region|matchId|choice
  if (customId.startsWith('region|')) {
    const parts = customId.split('|');
    const choice = parts[parts.length - 1]; // NA / AEST / GMT / close
    const voteId = parts.slice(0, -1).join('|');

    if (choice === 'close') {
      if (!canManageMatch(interaction.member)) return interaction.reply({ content: '❌ Staff only.', flags: 64 });
      const finisher = global._regionFinishers?.get(voteId);
      if (finisher) { await finisher(); global._regionFinishers.delete(voteId); }
      return interaction.reply({ content: '✅ Region vote closed.', flags: 64 });
    }

    const data = db.get();
    const vote = data.regionvotes?.[voteId];
    if (!vote || vote.closed) return interaction.reply({ content: '❌ Vote is closed.', flags: 64 });
    vote.votes[interaction.user.id] = choice;
    db.set(data);
    const flags = { NA: '🌎', AEST: '🌏', GMT: '🌍' };
    return interaction.reply({ content: `✅ Voted for **${flags[choice] || ''} ${choice}**`, flags: 64 });
  }

  // ── Prediction vote buttons ───────────────────────────────────────────────
  // Format: pred|matchId|round|matchIndex|p1 or p2
  if (customId.startsWith('pred|')) {
    const parts = customId.split('|');
    const side = parts[parts.length - 1]; // p1 or p2
    const predId = parts.slice(0, -1).join('|'); // pred|matchId|round|matchIndex
    const data = db.get();
    const pred = data.predictions?.[predId];
    if (!pred) return interaction.reply({ content: '❌ Prediction not found.', flags: 64 });
    const already = pred.votes[interaction.user.id];
    pred.votes[interaction.user.id] = side;
    db.set(data);
    const label = side === 'p1' ? pred.p1Label : pred.p2Label;
    return interaction.reply({ content: already ? `✅ Vote changed to **${label}**` : `✅ Voted for **${label}**`, flags: 64 });
  }

  // ── Queue: join ───────────────────────────────────────────────────────────
  if (customId.startsWith('join_queue_')) {
    const matchId = customId.replace('join_queue_', '');
    const data = db.get();
    const match = data.matches[matchId];
    if (!match || match.status !== 'queuing') return interaction.reply({ content: '❌ Queue is closed.', flags: 64 });
    if (match.queue.includes(interaction.user.id)) return interaction.reply({ content: '⚠️ You are already in the queue!', flags: 64 });
    match.queue.push(interaction.user.id);
    data.matches[matchId] = match;
    db.set(data);
    return interaction.update({ embeds: [buildQueueEmbed(match)], components: [makeJoinRow(matchId)] });
  }

  // ── Queue: leave ──────────────────────────────────────────────────────────
  if (customId.startsWith('leave_queue_')) {
    const matchId = customId.replace('leave_queue_', '');
    const data = db.get();
    const match = data.matches[matchId];
    if (!match || match.status !== 'queuing') return interaction.reply({ content: '❌ Queue is closed.', flags: 64 });
    match.queue = match.queue.filter(id => id !== interaction.user.id);
    data.matches[matchId] = match;
    db.set(data);
    return interaction.update({ embeds: [buildQueueEmbed(match)], components: [makeJoinRow(matchId)] });
  }

  // ── Queue: +1 minute ─────────────────────────────────────────────────────
  if (customId.startsWith('addminute_')) {
    const matchId = customId.replace('addminute_', '');
    if (!canManageMatch(interaction.member)) return interaction.reply({ content: '❌ Staff only.', flags: 64 });
    const data = db.get();
    const match = data.matches[matchId];
    if (!match || match.status !== 'queuing') return interaction.reply({ content: '❌ Queue closed.', flags: 64 });
    match.endsAt += 60000;
    data.matches[matchId] = match;
    db.set(data);
    const t = timers.get(matchId);
    if (t) {
      clearTimeout(t.timer);
      const newTimer = setTimeout(async () => { clearInterval(t.interval); await startBracket(client, matchId); }, match.endsAt - Date.now());
      timers.set(matchId, { ...t, timer: newTimer });
    }
    return interaction.update({ embeds: [buildQueueEmbed(match)], components: [makeJoinRow(matchId)] });
  }

  // ── Queue: force start ────────────────────────────────────────────────────
  if (customId.startsWith('forcestart_')) {
    const matchId = customId.replace('forcestart_', '');
    if (!canManageMatch(interaction.member)) return interaction.reply({ content: '❌ Staff only.', flags: 64 });
    const data = db.get();
    const match = data.matches[matchId];
    if (!match || match.status !== 'queuing') return interaction.reply({ content: '❌ Queue not open.', flags: 64 });
    const minPlayers = match.type === '1v1' ? 4 : 6;
    if (match.queue.length < minPlayers) return interaction.reply({ content: `❌ Need **${minPlayers}** players. Have **${match.queue.length}**.`, flags: 64 });
    const t = timers.get(matchId);
    if (t) { clearTimeout(t.timer); clearInterval(t.interval); timers.delete(matchId); }
    await interaction.deferUpdate();
    await startBracket(client, matchId);
    return;
  }

  // ── Winner selection ──────────────────────────────────────────────────────
  // Format: win|matchId|round|matchIndex|winnerId  (pipe-separated, no ambiguity)
  if (customId.startsWith('win|')) {
    if (!canManageMatch(interaction.member)) return interaction.reply({ content: '❌ Staff only.', flags: 64 });

    const parts = customId.split('|');
    // parts: ['win', matchId, round, matchIndex, winnerId]
    if (parts.length !== 5) return interaction.reply({ content: '❌ Malformed button ID.', flags: 64 });

    const [, matchId, roundStr, matchIndexStr, winnerId] = parts;
    const round = parseInt(roundStr);
    const matchIndex = parseInt(matchIndexStr);

    const data = db.get();
    const match = data.matches[matchId];
    if (!match) return interaction.reply({ content: '❌ Match not found. It may have expired.', flags: 64 });

    const bracketRound = match.bracket[round];
    if (!bracketRound) return interaction.reply({ content: '❌ Round not found.', flags: 64 });

    const bracketMatch = bracketRound[matchIndex];
    if (!bracketMatch) return interaction.reply({ content: '❌ Match slot not found.', flags: 64 });
    if (bracketMatch.winner) return interaction.reply({ content: '⚠️ Winner already selected for that match.', flags: 64 });

    const loserId = bracketMatch.p1 === winnerId ? bracketMatch.p2 : bracketMatch.p1;
    bracketMatch.winner = winnerId;

    // Reveal prediction
    const predId = `pred|${matchId}|${round}|${matchIndex}`;
    await revealPrediction(client, predId, winnerId);

    // Credit scoreboard win
    if (match.scoreboardName) {
      const sb = Object.values(data.scoreboards || {}).find(
        s => s.guildId === match.guildId && s.name.toLowerCase() === match.scoreboardName.toLowerCase()
      );
      if (sb) {
        sb.scores[winnerId] = (sb.scores[winnerId] || 0) + 1;
        data.scoreboards[sb.id] = sb;
        try {
          const ch = await client.channels.fetch(sb.channelId);
          const msg = await ch.messages.fetch(sb.messageId);
          await msg.edit({ embeds: [buildScoreboardEmbed(sb)] });
        } catch {}
      }
    }

    // Check achievements
    try {
      const guild = await client.guilds.fetch(match.guildId);
      const newAchs = await checkAchievements(client, guild, winnerId, data);
      if (newAchs.length && match.privateChannelId) {
        const { ACHIEVEMENTS } = require('./commands/achievements');
        const earned = newAchs.map(id => ACHIEVEMENTS.find(a => a.id === id)).filter(Boolean);
        const ch = await client.channels.fetch(match.privateChannelId);
        await ch.send(`🏅 <@${winnerId}> earned: ${earned.map(a => `${a.emoji} **${a.name}**`).join(', ')}!`);
      }
    } catch {}

    // Log match result
    await logMatchResult(client, match, winnerId, loserId ? [loserId] : []);
    if (match.privateChannelId) {
      try {
        const ch = await client.channels.fetch(match.privateChannelId);
        await ch.send(`Winner recorded: <@${winnerId}> won Round ${round + 1}, Match ${matchIndex + 1}.`);
      } catch {}
    }

    const roundComplete = bracketRound.every(m => m.winner !== null);
    const uniqueWinners = roundComplete ? [...new Set(bracketRound.map(m => m.winner))] : [];
    const isTournamentFinal = roundComplete && uniqueWinners.length === 1;

    data.matches[matchId] = match;
    db.set(data);
    await applyMatchElo(client, match, winnerId, loserId || null, round, isTournamentFinal);

    if (roundComplete) {
      if (uniqueWinners.length === 1) {
        // 🏆 Tournament over
        const champion = uniqueWinners[0];
        match.status = 'complete';
        match.champion = champion;
        const completeData = db.get();
        completeData.matches[matchId] = match;
        db.set(completeData);

        try { const guild = await client.guilds.fetch(match.guildId); await checkAchievements(client, guild, champion, completeData); } catch {}
        await postOrUpdateBracket(client, match);

        if (match.privateChannelId) {
          try {
            const ch = await client.channels.fetch(match.privateChannelId);
            const { EmbedBuilder } = require('discord.js');
            const champEntry = bracketRound.find(m => m.winner === champion);
            const champTag = champEntry?.p1Tag || champEntry?.p2Tag || '';
            const eloData = getEloData(db.get());
            const eloSummary = buildMatchEloSummary(match, eloData);
            const finalEmbed = new EmbedBuilder()
              .setTitle('🏆 Tournament Complete!').setColor(0xffd700)
              .setDescription(`👑 **Champion: <@${champion}>**${champTag ? ` (${champTag})` : ''}\n\nGG to all players!${match.prize ? `\n\n🎁 **Prize:** ${match.prize}` : ''}`)
              .addFields({ name: 'Match ELO Changes', value: eloSummary.slice(0, 1024), inline: false })
              .setTimestamp();
            await ch.send({ embeds: [finalEmbed] });
          } catch {}
          scheduleChannelDelete(client, match.privateChannelId);
        }

        await dmUser(client, champion,
          `🏆 **Congratulations!** You won Match #${match.matchNum ?? '?'} (${match.type.toUpperCase()})!${match.prize ? `\n🎁 Prize: ${match.prize}` : ''}`
        );

        return interaction.reply({ content: `🏆 Tournament over! Champion: <@${champion}>`, flags: 64 });
      }

      // Advance to next round
      const nextRound = buildNextRound(bracketRound);
      try { const guild = await client.guilds.fetch(match.guildId); await fetchDisplayNames(guild, nextRound); } catch {}

      match.bracket.push(nextRound);
      match.currentRound = round + 1;
      const advanceData = db.get();
      advanceData.matches[matchId] = match;
      db.set(advanceData);

      for (let i = 0; i < nextRound.length; i++) {
        const bm = nextRound[i];
        if (!bm.bye && bm.p1 && bm.p2) await postPredictionPoll(client, match, bm, round + 1, i);
      }
      for (let i = 0; i < nextRound.length; i++) {
        if (!nextRound[i].bye) scheduleMatchReminder(client, match, matchId, i, round + 1);
      }
      for (const bm of nextRound) {
        if (bm.bye) continue;
        for (const pid of [bm.p1, bm.p2].filter(Boolean)) {
          await dmUser(client, pid, `⚔️ **Next round!** You're up in Round ${round + 2} of Match #${match.matchNum ?? '?'}. Head to <#${match.privateChannelId}>!`);
        }
      }

      await postOrUpdateBracket(client, match);
      return interaction.reply({ content: `✅ Round ${round + 1} complete — Round ${round + 2} is now live!`, flags: 64 });
    }

    // Round still going — grant ELO, update bracket image
    const pendingData = db.get();
    pendingData.matches[matchId] = match;
    db.set(pendingData);
    await postOrUpdateBracket(client, match);
    return interaction.reply({ content: `✅ Winner recorded for Match ${matchIndex + 1}. Select remaining winners above.`, flags: 64 });
  }
});

client.login(process.env.DISCORD_TOKEN);
