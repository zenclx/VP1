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
  const cmd = require(`./commands/${file}`);
  if (cmd.data && cmd.execute) {
    client.commands.set(cmd.data.name, cmd);
    commandsData.push(cmd.data.toJSON());
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

// ── Restore scheduled match timers on startup ────────────────────────────────
function restoreScheduledMatches() {
  const data = db.get();
  const { scheduledTimers, parseTime } = require('./commands/schedulematch');
  for (const [id, s] of Object.entries(data.scheduledMatches || {})) {
    const delay = s.startsAt - Date.now();
    if (delay <= 0) {
      // Already past — clean up
      delete data.scheduledMatches[id];
      continue;
    }
    const timer = setTimeout(async () => {
      scheduledTimers.delete(id);
      try {
        const fresh = db.get();
        if (!fresh.scheduledMatches?.[id]) return;
        delete fresh.scheduledMatches[id];
        db.set(fresh);
        const ch = await client.channels.fetch(s.channelId);
        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
          .setTitle('⚔️ Scheduled Match — Queue Now Open!')
          .setColor(0x00c853)
          .setDescription(`The scheduled ${s.type.toUpperCase()} match is now open! Use \`/creatematch\` to start the queue.`)
          .setTimestamp();
        if (s.prize) embed.addFields({ name: '🎁 Prize', value: s.prize });
        await ch.send({ content: '@here', embeds: [embed] });
      } catch (e) { console.error('Restore scheduled match error:', e.message); }
    }, delay);
    scheduledTimers.set(id, timer);
  }
  db.set(data);
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
  restoreScheduledMatches();
});

// ── Match number counter helpers ─────────────────────────────────────────────
function getNextMatchNumber(guildId) {
  const data = db.get();
  if (!data.matchCounters) data.matchCounters = {};
  const current = data.matchCounters[guildId] ?? -1;
  const next = current + 1;
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

  // ── Scoreboard: reset ────────────────────────────────────────────────────
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

  // ── Scoreboard: delete ───────────────────────────────────────────────────
  if (customId.startsWith('delete_confirm_')) {
    const sbId = customId.replace('delete_confirm_', '');
    const data = db.get();
    const sb = data.scoreboards[sbId];
    if (!sb) return interaction.update({ content: '❌ Not found.', components: [] });
    try {
      const ch = await client.channels.fetch(sb.channelId);
      const msg = await ch.messages.fetch(sb.messageId);
      await msg.delete();
    } catch {}
    const name = sb.name;
    delete data.scoreboards[sbId];
    db.set(data);
    return interaction.update({ content: `🗑️ **${name}** deleted.`, components: [] });
  }
  if (customId === 'delete_cancel') return interaction.update({ content: 'Cancelled.', components: [] });

  // Load match helpers
  const {
    buildQueueEmbed, timers, startBracket, canManageMatch, scheduleChannelDelete,
    buildNextRound, postOrUpdateBracket, logMatchResult, revealPrediction,
    scheduleMatchReminder, dmUser, fetchDisplayNames, postPredictionPoll,
  } = require('./commands/creatematch');

  const { checkAchievements } = require('./commands/achievements');
  const { applyMatchElo } = require('./commands/elo');

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
  if (customId.startsWith('bo3vote_')) {
    const parts = customId.split('_');
    const choice = parts[parts.length - 1]; // 'all', 'finals', 'none'
    const voteId = parts.slice(0, -1).join('_');
    const data = db.get();
    const vote = data.bo3votes?.[voteId];
    if (!vote) return interaction.reply({ content: '❌ Vote not found.', flags: 64 });
    vote.votes[interaction.user.id] = choice;
    db.set(data);
    return interaction.reply({ content: `✅ Vote recorded: **${choice === 'all' ? 'Bo3 All' : choice === 'finals' ? 'Finals Bo3' : 'Standard'}**`, flags: 64 });
  }

  // ── Prediction vote buttons ───────────────────────────────────────────────
  if (customId.includes('_vote_p')) {
    const voteFor = customId.endsWith('_vote_p1') ? 'p1' : 'p2';
    const predId = customId.replace('_vote_p1', '').replace('_vote_p2', '');
    const data = db.get();
    const pred = data.predictions?.[predId];
    if (!pred) return interaction.reply({ content: '❌ Prediction not found.', flags: 64 });
    const already = pred.votes[interaction.user.id];
    pred.votes[interaction.user.id] = voteFor;
    db.set(data);
    const label = voteFor === 'p1' ? pred.p1Label : pred.p2Label;
    return interaction.reply({
      content: already ? `✅ Vote changed to **${label}**` : `✅ Voted for **${label}**`,
      flags: 64,
    });
  }

  // ── Queue: join ──────────────────────────────────────────────────────────
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

  // ── Queue: leave ─────────────────────────────────────────────────────────
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

  // ── Queue: force start ───────────────────────────────────────────────────
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

  // ── Winner selection ─────────────────────────────────────────────────────
  if (customId.startsWith('win_')) {
    if (!canManageMatch(interaction.member)) return interaction.reply({ content: '❌ Staff only.', flags: 64 });

    const withoutPrefix = customId.slice(4);
    const segments = withoutPrefix.split('_');
    const winnerId = segments[segments.length - 1];
    const matchIndex = parseInt(segments[segments.length - 2]);
    const round = parseInt(segments[segments.length - 3]);
    const matchId = segments.slice(0, segments.length - 3).join('_');

    const data = db.get();
    const match = data.matches[matchId];
    if (!match) return interaction.reply({ content: '❌ Match not found.', flags: 64 });

    const bracketMatch = match.bracket[round][matchIndex];
    if (!bracketMatch) return interaction.reply({ content: '❌ Match slot not found.', flags: 64 });
    if (bracketMatch.winner) return interaction.reply({ content: '⚠️ Winner already selected for that match.', flags: 64 });

    const loserId = bracketMatch.p1 === winnerId ? bracketMatch.p2 : bracketMatch.p1;
    bracketMatch.winner = winnerId;

    // Reveal prediction for this match
    const predId = `pred_${matchId}_${round}_${matchIndex}`;
    await revealPrediction(client, predId, winnerId);

    // Credit win to scoreboard
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

    // Check achievements for winner
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

    // ── ELO: grant ELO for non-final round win ─────────────────────────────
    // Finals ELO is granted separately below when champion is determined
    const roundComplete = match.bracket[round].every(m => m.winner !== null);

    if (roundComplete) {
      const uniqueWinners = [...new Set(match.bracket[round].map(m => m.winner))];

      if (uniqueWinners.length === 1) {
        // 🏆 Tournament over
        const champion = uniqueWinners[0];
        // Grant finals ELO (biggest bonus)
        await applyMatchElo(client, match, champion, loserId || null, round, true);
        match.status = 'complete';
        match.champion = champion;
        data.matches[matchId] = match;
        db.set(data);

        // Check champion achievement
        try {
          const guild = await client.guilds.fetch(match.guildId);
          await checkAchievements(client, guild, champion, data);
        } catch {}

        await postOrUpdateBracket(client, match);

        if (match.privateChannelId) {
          try {
            const ch = await client.channels.fetch(match.privateChannelId);
            const { EmbedBuilder } = require('discord.js');
            const champEntry = match.bracket[round].find(m => m.winner === champion);
            const champTag = champEntry?.p1Tag || champEntry?.p2Tag || '';
            const finalEmbed = new EmbedBuilder()
              .setTitle('🏆 Tournament Complete!')
              .setColor(0xffd700)
              .setDescription(`👑 **Champion: <@${champion}>**${champTag ? ` (${champTag})` : ''}\n\nGG to all players!${match.prize ? `\n\n🎁 **Prize:** ${match.prize}` : ''}`)
              .setTimestamp();
            await ch.send({ embeds: [finalEmbed] });
          } catch {}
          scheduleChannelDelete(client, match.privateChannelId);
        }

        // DM the champion
        await dmUser(client, champion,
          `🏆 **Congratulations!** You won the tournament (Match #${match.matchNum ?? '?'}, ${match.type.toUpperCase()})!${match.prize ? `\n🎁 Prize: ${match.prize}` : ''}`
        );

        return interaction.reply({ content: `🏆 Tournament over! Champion: <@${champion}>`, flags: 64 });
      }

      // ── Advance to next round ────────────────────────────────────────────
      const nextRound = buildNextRound(match.bracket[round]);

      // Fetch display names for new round if needed
      try {
        const guild = await client.guilds.fetch(match.guildId);
        await fetchDisplayNames(guild, nextRound);
      } catch {}

      match.bracket.push(nextRound);
      match.currentRound = round + 1;
      data.matches[matchId] = match;
      db.set(data);

      // Post prediction polls for next round
      for (let i = 0; i < nextRound.length; i++) {
        const bm = nextRound[i];
        if (!bm.bye && bm.p1 && bm.p2) {
          await postPredictionPoll(client, match, bm, round + 1, i);
        }
      }

      // Schedule reminders for next round
      for (let i = 0; i < nextRound.length; i++) {
        if (!nextRound[i].bye) scheduleMatchReminder(client, match, matchId, i, round + 1);
      }

      // DM players advancing to next round
      for (const bm of nextRound) {
        if (bm.bye) continue;
        const players = [bm.p1, bm.p2].filter(Boolean);
        for (const pid of players) {
          await dmUser(client, pid,
            `⚔️ **Next round!** You're up in Round ${round + 2} of Match #${match.matchNum ?? '?'}. Head to <#${match.privateChannelId}>!`
          );
        }
      }

      await postOrUpdateBracket(client, match);
      return interaction.reply({ content: `✅ Round ${round + 1} complete — Round ${round + 2} is now live!`, flags: 64 });
    }

    // ── Round still in progress ──────────────────────────────────────────────
    // Grant ELO for this individual match win (non-finals)
    await applyMatchElo(client, match, winnerId, loserId || null, round, false);
    data.matches[matchId] = match;
    db.set(data);
    await postOrUpdateBracket(client, match);
    return interaction.reply({ content: `✅ Winner recorded for Match ${matchIndex + 1}.`, flags: 64 });
  }
});

client.login(process.env.DISCORD_TOKEN);
