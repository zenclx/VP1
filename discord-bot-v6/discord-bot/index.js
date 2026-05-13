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

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
});

// ── Match number counter helpers ────────────────────────────────────────────
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

  // ── Scoreboard: reset ───────────────────────────────────────────────
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

  // ── Scoreboard: delete ──────────────────────────────────────────────
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
    buildNextRound, postOrUpdateBracket, logMatchResult,
    dmUser, checkAndGrantBadges, grantChampionBadge, calculateMVP, scheduleMatchReminder,
  } = require('./commands/creatematch');

  function makeJoinRow(matchId) {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`join_queue_${matchId}`).setLabel('Join Queue').setStyle(ButtonStyle.Success).setEmoji('⚔️'),
      new ButtonBuilder().setCustomId(`leave_queue_${matchId}`).setLabel('Leave Queue').setStyle(ButtonStyle.Secondary).setEmoji('🚪'),
      new ButtonBuilder().setCustomId(`addminute_${matchId}`).setLabel('+1 Minute').setStyle(ButtonStyle.Secondary).setEmoji('⏱️'),
      new ButtonBuilder().setCustomId(`forcestart_${matchId}`).setLabel('Force Start').setStyle(ButtonStyle.Danger).setEmoji('🚀'),
    );
  }

  // ── Queue: join ─────────────────────────────────────────────────────
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

  // ── Queue: leave ────────────────────────────────────────────────────
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

  // ── Queue: +1 minute ───────────────────────────────────────────────
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

  // ── Queue: force start ──────────────────────────────────────────────
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

  // ── BO3 vote buttons ────────────────────────────────────────────────
  if (customId.startsWith('bo3vote_')) {
    const parts = customId.split('_');
    const voteType = parts[1]; // all / finals / none
    const matchId = parts.slice(2).join('_');
    const data = db.get();
    const match = data.matches[matchId];
    if (!match) return interaction.reply({ content: '❌ Match not found.', flags: 64 });
    if (!match.bo3Votes) match.bo3Votes = { all: [], finals: [], none: [] };
    // Remove previous vote
    for (const key of ['all', 'finals', 'none']) {
      match.bo3Votes[key] = match.bo3Votes[key].filter(id => id !== interaction.user.id);
    }
    match.bo3Votes[voteType].push(interaction.user.id);
    data.matches[matchId] = match;
    db.set(data);
    const labels = { all: '🎯 All Matches BO3', finals: '🏆 Finals Only', none: '❌ No BO3' };
    return interaction.reply({ content: `✅ You voted for **${labels[voteType]}**! Votes tallied in 60 seconds.`, flags: 64 });
  }

  // ── Prediction vote buttons ─────────────────────────────────────────
  if (customId.startsWith('predict_')) {
    const parts = customId.split('_');
    const predictedWinner = parts[1];
    const matchId = parts.slice(2).join('_');
    const data = db.get();
    const match = data.matches[matchId];
    if (!match) return interaction.reply({ content: '❌ Match not found.', flags: 64 });
    if (match.queue.includes(interaction.user.id))
      return interaction.reply({ content: '⚠️ Participants can\'t vote in predictions!', flags: 64 });
    if (!match.predictions) match.predictions = {};
    match.predictions[interaction.user.id] = predictedWinner;
    data.matches[matchId] = match;
    db.set(data);
    return interaction.reply({ content: `🔮 You predicted <@${predictedWinner}> will win!`, flags: 64 });
  }

  // ── Winner selection ────────────────────────────────────────────────
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

    // Log match result
    await logMatchResult(client, match, winnerId, loserId ? [loserId] : []);

    const roundComplete = match.bracket[round].every(m => m.winner !== null);

    if (roundComplete) {
      const uniqueWinners = [...new Set(match.bracket[round].map(m => m.winner))];

      if (uniqueWinners.length === 1) {
        // 🏆 Tournament over
        const champion = uniqueWinners[0];
        match.status = 'complete';
        match.champion = champion;
        data.matches[matchId] = match;
        db.set(data);

        await postOrUpdateBracket(client, match);

        // Calculate MVP
        const mvpId = calculateMVP(match);

        if (match.privateChannelId) {
          try {
            const ch = await client.channels.fetch(match.privateChannelId);
            const { EmbedBuilder } = require('discord.js');
            const champEntry = match.bracket[round].find(m => m.winner === champion);
            const champTag = champEntry?.p1Tag || champEntry?.p2Tag || '';
            const finalEmbed = new EmbedBuilder()
              .setTitle('🏆 Tournament Complete!')
              .setColor(0xffd700)
              .setDescription(
                `👑 **Champion: <@${champion}>**${champTag ? ` (${champTag})` : ''}\n\nGG to all players!` +
                (match.prize ? `\n\n🎁 **Prize:** ${match.prize}` : '') +
                (mvpId && mvpId !== champion ? `\n\n🌟 **MVP: <@${mvpId}>** — beat the highest-ranked opponents!` : '')
              )
              .setTimestamp();

            // Reveal predictions
            if (match.predictions && Object.keys(match.predictions).length > 0) {
              const predEntries = Object.entries(match.predictions);
              const correct = predEntries.filter(([, v]) => v === champion);
              const pct = Math.round((correct.length / predEntries.length) * 100);
              finalEmbed.addFields({
                name: '🔮 Predictions',
                value: `**${correct.length}/${predEntries.length}** predicted correctly (${pct}%)\n` +
                  (correct.length > 0 ? `Correct: ${correct.slice(0, 5).map(([id]) => `<@${id}>`).join(', ')}${correct.length > 5 ? ` +${correct.length - 5} more` : ''}` : 'Nobody guessed right!')
              });
            }

            await ch.send({ embeds: [finalEmbed] });
          } catch {}
          scheduleChannelDelete(client, match.privateChannelId);
        }

        // Grant badges
        try {
          const guild = await client.guilds.fetch(match.guildId);
          // Champion badge
          await grantChampionBadge(client, guild, champion);
          // DM champion
          await dmUser(client, champion, `🏆 **Congratulations!** You won the tournament! ${match.prize ? `Your prize: ${match.prize}` : ''}`);

          // Win count badges for champion
          const data2 = db.get();
          const guildBoards = Object.values(data2.scoreboards || {}).filter(s => s.guildId === match.guildId);
          if (guildBoards.length > 0) {
            const sb = guildBoards[0];
            const wins = sb.scores?.[champion] || 0;
            // Calculate streak (simplified: count consecutive wins from match logs)
            const logs = (data2.matchLogs?.[match.guildId] || []);
            let streak = 0;
            for (const log of logs) {
              if (log.winner === champion) streak++;
              else break;
            }
            await checkAndGrantBadges(client, guild, champion, wins, streak);
          }
        } catch {}

        return interaction.reply({ content: `🏆 Tournament over! Champion: <@${champion}>`, flags: 64 });
      }

      // ── Advance to next round ────────────────────────────────────────
      const nextRound = buildNextRound(match.bracket[round]);
      match.bracket.push(nextRound);
      match.currentRound = round + 1;
      data.matches[matchId] = match;
      db.set(data);

      // Post updated bracket image with new round buttons
      await postOrUpdateBracket(client, match);

      // DM players in the new round
      if (match.privateChannelId) {
        const nextPlayers = nextRound.flatMap(m => [m.p1, m.p2].filter(Boolean));
        for (const pid of nextPlayers) {
          await dmUser(client, pid, `⚔️ **Round ${round + 2} is starting!** Head to your match channel: https://discord.com/channels/${match.guildId}/${match.privateChannelId}`);
        }
        // Schedule reminder for this round
        scheduleMatchReminder(client, matchId, match.privateChannelId, nextPlayers);

        // Post predictions for next round matches
        for (const bm of nextRound) {
          if (!bm.bye && bm.p1 && bm.p2) {
            try {
              const ch = await client.channels.fetch(match.privateChannelId);
              const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
              const predEmbed = new EmbedBuilder()
                .setTitle('🔮 Match Prediction')
                .setColor(0x9b59b6)
                .setDescription(`Who will win this match?\n<@${bm.p1}> vs <@${bm.p2}>\n\nServer members can vote!`);
              const predRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`predict_${bm.p1}_${matchId}`).setLabel(bm.p1Tag || 'Player 1').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`predict_${bm.p2}_${matchId}`).setLabel(bm.p2Tag || 'Player 2').setStyle(ButtonStyle.Secondary),
              );
              await ch.send({ embeds: [predEmbed], components: [predRow] });
            } catch {}
          }
        }
      }

      return interaction.reply({ content: `✅ Round ${round + 1} complete — Round ${round + 2} is now live in the match channel!`, flags: 64 });
    }

    // ── Round still in progress — update bracket image, keep buttons ──
    data.matches[matchId] = match;
    db.set(data);

    // Update the bracket image in the private channel (buttons stay, image updates)
    await postOrUpdateBracket(client, match);

    // Acknowledge the button press without touching the original message
    return interaction.reply({ content: `✅ Winner recorded for Match ${matchIndex + 1}. Select remaining match winners in the bracket above.`, flags: 64 });
  }
});

client.login(process.env.DISCORD_TOKEN);
