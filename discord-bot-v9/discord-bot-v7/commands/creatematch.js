const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, PermissionFlagsBits,
  ChannelType, AttachmentBuilder,
} = require('discord.js');
const db = require('../database');
const { DARK_BLUE } = require('../utils');
const { buildBracketImage } = require('../bracketImage');

const QUEUE_DURATION_MS = 5 * 60 * 1000;
const timers = new Map();
const matchReminderTimers = new Map();
const MATCH_MANAGER_ROLES = ['1387600871377993820'];
const MATCH_CATEGORY_ID = '1333182926858223718';
const REMINDER_AFTER_MS = 15 * 60 * 1000;

// ── Permission ────────────────────────────────────────────────────────────────
function canManageMatch(member) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.some(r => MATCH_MANAGER_ROLES.includes(r.id));
}

// ── Queue embed ───────────────────────────────────────────────────────────────
function buildQueueEmbed(match) {
  const typeLabel = match.type === '1v1' ? '1v1' : '2v2';
  const minPlayers = match.type === '1v1' ? 4 : 6;
  const timeLeft = Math.max(0, Math.round((match.endsAt - Date.now()) / 1000));
  const mins = Math.floor(timeLeft / 60);
  const secs = String(timeLeft % 60).padStart(2, '0');
  const playerMentions = match.queue.map(id => `<@${id}>`).join('\n') || '*None yet*';

  const embed = new EmbedBuilder()
    .setTitle(`⚔️ ${typeLabel} Match Queue`)
    .setColor(DARK_BLUE)
    .addFields(
      { name: '👥 Players Queued', value: `**${match.queue.length}** joined\n${playerMentions}`, inline: true },
      { name: '⏳ Time Remaining', value: `**${mins}m ${secs}s**`, inline: true },
      { name: '📋 Min to Start', value: `**${minPlayers}** players`, inline: true },
    )
    .setFooter({ text: 'Click Join Queue to enter! Host can force-start anytime.' })
    .setTimestamp();

  if (match.prize) embed.addFields({ name: '🎁 Prize', value: `**${match.prize}**`, inline: false });
  return embed;
}

// ── Bracket embed + components ────────────────────────────────────────────────
function buildBracketTextEmbed(match, round) {
  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${match.type.toUpperCase()} Bracket — Round ${round + 1}`)
    .setColor(DARK_BLUE)
    .setImage('attachment://bracket.png')
    .setFooter({ text: `Match ID: ${match.id}` })
    .setTimestamp();

  if (match.prize) embed.addFields({ name: '🎁 Prize', value: `**${match.prize}**`, inline: false });
  if (match.region) embed.addFields({ name: '🌍 Region', value: match.region, inline: true });
  if (match.bo3Mode && match.bo3Mode !== 'none') {
    const label = match.bo3Mode === 'all' ? 'Best of 3 (All)' : 'Finals Bo3';
    embed.addFields({ name: '🎮 Format', value: label, inline: true });
  }
  if (match.type === '2v2' && match.teams) {
    const teamLines = match.teams.map((t, i) =>
      `**Team ${String.fromCharCode(65 + i)}:** ${t.map(id => `<@${id}>`).join(' & ')}`
    );
    embed.addFields({ name: '👥 Teams', value: teamLines.join('\n'), inline: false });
  }
  return embed;
}

function buildBracketComponents(match, round) {
  const currentRound = match.bracket[round];
  const rows = [];
  currentRound.forEach((m, i) => {
    if (!m.winner && !m.bye) {
      const p1Label = m.teamLabel1 || m.p1Tag || 'Player 1';
      const p2Label = m.teamLabel2 || m.p2Tag || 'Player 2';
      // Use base64-safe IDs to avoid _ collision in customId parsing
      // Format: win|matchId|round|index|winnerId  (pipe separator)
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`win|${match.id}|${round}|${i}|${m.p1}`)
          .setLabel(`M${i + 1}: ${p1Label.slice(0, 20)} wins`)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`win|${match.id}|${round}|${i}|${m.p2}`)
          .setLabel(`M${i + 1}: ${p2Label.slice(0, 20)} wins`)
          .setStyle(ButtonStyle.Primary),
      );
      rows.push(row);
    }
  });
  return rows.slice(0, 5);
}

function makeBracketAttachment(match) {
  const buf = buildBracketImage(match.bracket, match.currentRound, null);
  return new AttachmentBuilder(buf, { name: 'bracket.png' });
}

// ── Bracket generation ────────────────────────────────────────────────────────
function generateBracket(players) {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const round = [];
  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    round.push({ p1: shuffled[i], p2: shuffled[i + 1], winner: null, p1Tag: null, p2Tag: null, bye: false });
  }
  if (shuffled.length % 2 !== 0) {
    round.push({ p1: shuffled[shuffled.length - 1], p2: null, winner: shuffled[shuffled.length - 1], bye: true, byePlayer: true, p1Tag: null });
  }
  return [round];
}

function pairIntoTeams(players) {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const teams = [];
  for (let i = 0; i < shuffled.length; i += 2) teams.push([shuffled[i], shuffled[i + 1]].filter(Boolean));
  return teams;
}

function generateTeamBracket(teams) {
  const round = [];
  for (let i = 0; i + 1 < teams.length; i += 2) {
    round.push({
      p1: teams[i][0], p2: teams[i + 1][0],
      p1Tag: `Team ${String.fromCharCode(65 + i)}`,
      p2Tag: `Team ${String.fromCharCode(65 + i + 1)}`,
      teamLabel1: `Team ${String.fromCharCode(65 + i)}`,
      teamLabel2: `Team ${String.fromCharCode(65 + i + 1)}`,
      teamA: teams[i], teamB: teams[i + 1],
      winner: null, bye: false,
    });
  }
  if (teams.length % 2 !== 0) {
    const t = teams[teams.length - 1];
    round.push({ p1: t[0], p2: null, winner: t[0], bye: true, byePlayer: true, p1Tag: `Team ${String.fromCharCode(65 + teams.length - 1)}`, teamA: t });
  }
  return [round];
}

function buildNextRound(currentRound) {
  const byeWinners = currentRound.filter(m => m.bye && m.byePlayer).map(m => ({ id: m.winner, tag: m.p1Tag }));
  const normalWinners = currentRound.filter(m => !m.bye).map(m => ({
    id: m.winner,
    tag: m.winner === m.p1 ? m.p1Tag : m.p2Tag,
  }));

  const nextRound = [];
  const pool = [...normalWinners];

  for (const bye of byeWinners) {
    if (pool.length > 0) {
      const opp = pool.shift();
      nextRound.push({ p1: bye.id, p2: opp.id, winner: null, p1Tag: bye.tag, p2Tag: opp.tag, bye: false });
    } else {
      nextRound.push({ p1: bye.id, p2: null, winner: bye.id, bye: true, byePlayer: true, p1Tag: bye.tag });
    }
  }

  for (let i = 0; i + 1 < pool.length; i += 2) {
    nextRound.push({ p1: pool[i].id, p2: pool[i + 1].id, winner: null, p1Tag: pool[i].tag, p2Tag: pool[i + 1].tag, bye: false });
  }

  if (pool.length % 2 !== 0) {
    const leftover = pool[pool.length - 1];
    nextRound.push({ p1: leftover.id, p2: null, winner: leftover.id, bye: true, byePlayer: true, p1Tag: leftover.tag });
  }

  return nextRound;
}

async function fetchDisplayNames(guild, round) {
  for (const m of round) {
    if (m.p1 && !m.p1Tag) { try { m.p1Tag = (await guild.members.fetch(m.p1)).displayName; } catch {} }
    if (m.p2 && !m.p2Tag) { try { m.p2Tag = (await guild.members.fetch(m.p2)).displayName; } catch {} }
  }
}

// ── DM helper ─────────────────────────────────────────────────────────────────
async function dmUser(client, userId, content) {
  try { await (await client.users.fetch(userId)).send(content); } catch {}
}

// ── Match reminder ────────────────────────────────────────────────────────────
function scheduleMatchReminder(client, match, matchId, bracketMatchIndex, round) {
  const key = `${matchId}|${round}|${bracketMatchIndex}`;
  if (matchReminderTimers.has(key)) clearTimeout(matchReminderTimers.get(key));
  const timer = setTimeout(async () => {
    matchReminderTimers.delete(key);
    const data = db.get();
    const m = data.matches?.[matchId];
    if (!m || m.status === 'complete') return;
    const bm = m.bracket?.[round]?.[bracketMatchIndex];
    if (!bm || bm.winner) return;
    if (!m.privateChannelId) return;
    try {
      const ch = await client.channels.fetch(m.privateChannelId);
      const mentions = [bm.p1, bm.p2].filter(Boolean).map(id => `<@${id}>`).join(' ');
      await ch.send(`⏰ **Reminder:** ${mentions} — Round ${round + 1}, Match ${bracketMatchIndex + 1} still needs a winner!`);
    } catch {}
  }, REMINDER_AFTER_MS);
  matchReminderTimers.set(key, timer);
}

// ── Channel ───────────────────────────────────────────────────────────────────
async function createMatchChannel(client, match) {
  try {
    const guild = await client.guilds.fetch(match.guildId);
    const overwrites = [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      ...match.queue.map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
      ...MATCH_MANAGER_ROLES.map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
    ];
    return await guild.channels.create({
      name: `match-${match.matchNum ?? 0}`,
      type: ChannelType.GuildText,
      parent: MATCH_CATEGORY_ID,
      permissionOverwrites: overwrites,
      topic: `Private match | ${match.type.toUpperCase()} | ID: ${match.id}`,
    });
  } catch (e) { console.error('createMatchChannel error:', e.message); return null; }
}

async function scheduleChannelDelete(client, channelId) {
  setTimeout(async () => {
    try { await (await client.channels.fetch(channelId)).send('⚠️ **This channel will be deleted in 10 seconds.**'); } catch {}
  }, 50000);
  setTimeout(async () => {
    try { await (await client.channels.fetch(channelId)).delete('Match complete'); } catch {}
  }, 60000);
}

// ── Logging ───────────────────────────────────────────────────────────────────
async function logMatchResult(client, match, winnerId, loserIds) {
  try {
    const data = db.get();
    const guildId = match.guildId;
    if (!data.matchLogs) data.matchLogs = {};
    if (!data.matchLogs[guildId]) data.matchLogs[guildId] = [];
    data.matchLogs[guildId].unshift({
      matchId: match.id, matchNum: match.matchNum ?? 0, type: match.type,
      winner: winnerId, opponents: loserIds, prize: match.prize || null,
      timestamp: Date.now(), scoreboard: match.scoreboardName || null,
    });
    if (data.matchLogs[guildId].length > 100) data.matchLogs[guildId].length = 100;
    db.set(data);

    const settings = data.settings?.[guildId] || {};
    if (settings.logChannelId) {
      const ch = await client.channels.fetch(settings.logChannelId);
      const embed = new EmbedBuilder()
        .setTitle('📋 Match Result').setColor(0x00c853)
        .addFields(
          { name: '🏆 Winner', value: `<@${winnerId}>`, inline: true },
          { name: '🎮 Type', value: match.type.toUpperCase(), inline: true },
        ).setTimestamp();
      if (match.prize) embed.addFields({ name: '🎁 Prize', value: match.prize });
      const playerPing = match.queue.map(id => `<@${id}>`).join(' ');

      await ch.send({
        content: playerPing,
        embeds: [embed],
        allowedMentions: { parse: ['users'] }
      });
    }
  } catch (e) { console.error('logMatchResult error:', e.message); }
}

// ── Bracket post/update ───────────────────────────────────────────────────────
async function postOrUpdateBracket(client, match) {
  if (!match.privateChannelId) return;
  try {
    const ch = await client.channels.fetch(match.privateChannelId);
    const attachment = makeBracketAttachment(match);
    const embed = buildBracketTextEmbed(match, match.currentRound);
    const components = buildBracketComponents(match, match.currentRound);

    if (match.bracketMessageId) {
      try {
        const msg = await ch.messages.fetch(match.bracketMessageId);
        await msg.edit({ embeds: [embed], files: [attachment], components });
        return;
      } catch {}
    }
    const msg = await ch.send({ embeds: [embed], files: [attachment], components });
    match.bracketMessageId = msg.id;
    const data = db.get();
    data.matches[match.id] = match;
    db.set(data);
  } catch (e) { console.error('postOrUpdateBracket error:', e.message); }
}

// ── Predictions (opt-in per guild via /enablepredictions) ─────────────────────
async function postPredictionPoll(client, match, bracketMatch, round, matchIndex) {
  // Check if predictions are enabled for this guild
  const data = db.get();
  const settings = data.settings?.[match.guildId] || {};
  if (!settings.predictionsEnabled) return;
  if (!match.privateChannelId) return;

  const p1Label = bracketMatch.teamLabel1 || bracketMatch.p1Tag || `<@${bracketMatch.p1}>`;
  const p2Label = bracketMatch.teamLabel2 || bracketMatch.p2Tag || `<@${bracketMatch.p2}>`;
  const predId = `pred|${match.id}|${round}|${matchIndex}`;

  try {
    const ch = await client.channels.fetch(match.privateChannelId);
    const embed = new EmbedBuilder()
      .setTitle('🎯 Match Prediction!')
      .setColor(0x9b59b6)
      .setDescription(`Who will win Match ${matchIndex + 1}?\nVote below — results shown after the match!`)
      .addFields(
        { name: '🟢 Option A', value: p1Label, inline: true },
        { name: '🔵 Option B', value: p2Label, inline: true },
      )
      .setFooter({ text: 'Anyone can vote!' })
      .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${predId}|p1`).setLabel(`Vote: ${p1Label.slice(0, 30)}`).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${predId}|p2`).setLabel(`Vote: ${p2Label.slice(0, 30)}`).setStyle(ButtonStyle.Primary),
    );

    const msg = await ch.send({ embeds: [embed], components: [row] });

    const freshData = db.get();
    if (!freshData.predictions) freshData.predictions = {};
    freshData.predictions[predId] = {
      matchId: match.id, round, matchIndex,
      p1: bracketMatch.p1, p2: bracketMatch.p2,
      p1Label, p2Label, votes: {}, messageId: msg.id,
      channelId: match.privateChannelId,
    };
    db.set(freshData);
  } catch (e) { console.error('postPredictionPoll error:', e.message); }
}

async function revealPrediction(client, predId, winnerId) {
  try {
    const data = db.get();
    const pred = data.predictions?.[predId];
    if (!pred) return;
    const ch = await client.channels.fetch(pred.channelId);
    const msg = await ch.messages.fetch(pred.messageId);
    const p1Votes = Object.values(pred.votes).filter(v => v === 'p1').length;
    const p2Votes = Object.values(pred.votes).filter(v => v === 'p2').length;
    const total = p1Votes + p2Votes;
    const winnerLabel = winnerId === pred.p1 ? pred.p1Label : pred.p2Label;
    const bar = n => { const p = total ? Math.round((n / total) * 10) : 0; return '█'.repeat(p) + '░'.repeat(10 - p); };

    const embed = new EmbedBuilder()
      .setTitle('🎯 Prediction Results').setColor(0x9b59b6)
      .setDescription(`**Winner: ${winnerLabel}** 🏆`)
      .addFields(
        { name: pred.p1Label, value: `${bar(p1Votes)} ${p1Votes} votes (${total ? Math.round(p1Votes / total * 100) : 0}%)` },
        { name: pred.p2Label, value: `${bar(p2Votes)} ${p2Votes} votes (${total ? Math.round(p2Votes / total * 100) : 0}%)` },
      ).setTimestamp();

    await msg.edit({ embeds: [embed], components: [] });
  } catch (e) { console.error('revealPrediction error:', e.message); }
}

// ── Bo3 vote ──────────────────────────────────────────────────────────────────
// Returns a promise that resolves when the 60s vote is done, with the result
async function postBo3Vote(client, match) {
  if (!match.privateChannelId) return 'none';
  return new Promise(async (resolve) => {
    try {
      const ch = await client.channels.fetch(match.privateChannelId);
      const embed = new EmbedBuilder()
        .setTitle('🗳️ Step 1 of 2 — Match Format Vote')
        .setColor(DARK_BLUE)
        .setDescription('Vote on the match format! Poll ends in **60 seconds** or when host force-closes.')
        .addFields(
          { name: '🟢 Best of 3 (All)', value: 'Every match is Bo3', inline: true },
          { name: '🔵 Finals Only', value: 'Only the final is Bo3', inline: true },
          { name: '⚫ Standard (Bo1)', value: 'All matches single game', inline: true },
        ).setTimestamp();

      const voteId = `bo3|${match.id}`;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${voteId}|all`).setLabel('Bo3 All').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${voteId}|finals`).setLabel('Finals Only Bo3').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${voteId}|none`).setLabel('Standard Bo1').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${voteId}|close`).setLabel('Close Vote Now').setStyle(ButtonStyle.Danger),
      );

      const msg = await ch.send({ embeds: [embed], components: [row] });

      const data = db.get();
      if (!data.bo3votes) data.bo3votes = {};
      data.bo3votes[voteId] = { matchId: match.id, votes: {}, messageId: msg.id, channelId: match.privateChannelId, closed: false };
      db.set(data);

      const finish = async () => {
        const fresh = db.get();
        const vote = fresh.bo3votes?.[voteId];
        if (!vote) return resolve('none');
        vote.closed = true;
        const tally = { all: 0, finals: 0, none: 0 };
        for (const v of Object.values(vote.votes)) tally[v] = (tally[v] || 0) + 1;
        const winner = Object.entries(tally).sort(([, a], [, b]) => b - a)[0][0];
        if (fresh.matches[match.id]) { fresh.matches[match.id].bo3Mode = winner; }
        db.set(fresh);

        const labels = { all: 'Best of 3 (All Matches)', finals: 'Finals Only Bo3', none: 'Standard Bo1' };
        const resultEmbed = new EmbedBuilder()
          .setTitle('✅ Format Decided!').setColor(0x00c853)
          .setDescription(`**${labels[winner]}** wins!\nBo3 All: ${tally.all} | Finals: ${tally.finals} | Standard: ${tally.none}`)
          .setTimestamp();
        try { await msg.edit({ embeds: [resultEmbed], components: [] }); } catch {}
        resolve(winner);
      };

      // Store finish fn so close button can call it
      if (!global._bo3Finishers) global._bo3Finishers = new Map();
      global._bo3Finishers.set(voteId, finish);

      setTimeout(finish, 60000);
    } catch (e) { console.error('postBo3Vote error:', e.message); resolve('none'); }
  });
}

// ── Region vote ───────────────────────────────────────────────────────────────
async function postRegionVote(client, match) {
  if (!match.privateChannelId) return 'NA';
  return new Promise(async (resolve) => {
    try {
      const ch = await client.channels.fetch(match.privateChannelId);
      const embed = new EmbedBuilder()
        .setTitle('🌍 Step 2 of 2 — Server Region Vote')
        .setColor(DARK_BLUE)
        .setDescription('Vote on which server region to play on! Poll ends in **60 seconds** or when host force-closes.')
        .addFields(
          { name: '🌎 NA', value: 'North America', inline: true },
          { name: '🌏 AEST', value: 'Australia / Oceania', inline: true },
          { name: '🌍 GMT', value: 'Europe / UK', inline: true },
        ).setTimestamp();

      const voteId = `region|${match.id}`;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${voteId}|NA`).setLabel('🌎 NA').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${voteId}|AEST`).setLabel('🌏 AEST').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${voteId}|GMT`).setLabel('🌍 GMT').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${voteId}|close`).setLabel('Close Vote Now').setStyle(ButtonStyle.Danger),
      );

      const msg = await ch.send({ embeds: [embed], components: [row] });

      const data = db.get();
      if (!data.regionvotes) data.regionvotes = {};
      data.regionvotes[voteId] = { matchId: match.id, votes: {}, messageId: msg.id, channelId: match.privateChannelId, closed: false };
      db.set(data);

      const finish = async () => {
        const fresh = db.get();
        const vote = fresh.regionvotes?.[voteId];
        if (!vote) return resolve('NA');
        vote.closed = true;
        const tally = { NA: 0, AEST: 0, GMT: 0 };
        for (const v of Object.values(vote.votes)) tally[v] = (tally[v] || 0) + 1;
        const winner = Object.entries(tally).sort(([, a], [, b]) => b - a)[0][0];
        if (fresh.matches[match.id]) { fresh.matches[match.id].region = winner; }
        db.set(fresh);

        const flags = { NA: '🌎', AEST: '🌏', GMT: '🌍' };
        const resultEmbed = new EmbedBuilder()
          .setTitle('✅ Region Decided!').setColor(0x00c853)
          .setDescription(`Playing on **${flags[winner]} ${winner}**!\nNA: ${tally.NA} | AEST: ${tally.AEST} | GMT: ${tally.GMT}`)
          .setTimestamp();
        try { await msg.edit({ embeds: [resultEmbed], components: [] }); } catch {}
        resolve(winner);
      };

      if (!global._regionFinishers) global._regionFinishers = new Map();
      global._regionFinishers.set(voteId, finish);

      setTimeout(finish, 60000);
    } catch (e) { console.error('postRegionVote error:', e.message); resolve('NA'); }
  });
}

// ── Start bracket ─────────────────────────────────────────────────────────────
async function startBracket(client, matchId) {
  const data = db.get();
  const match = data.matches[matchId];
  if (!match || match.status !== 'queuing') return;

  const minPlayers = match.type === '1v1' ? 4 : 6;
  if (match.queue.length < minPlayers) {
    try {
      const ch = await client.channels.fetch(match.channelId);
      const msg = await ch.messages.fetch(match.messageId);
      await msg.edit({
        embeds: [new EmbedBuilder().setTitle('❌ Match Cancelled').setColor(0xff0000)
          .setDescription(`Queue cancelled: not enough players joined.\n\nNeed **${minPlayers}** players, but only **${match.queue.length}** joined.`)],
        components: [],
      });
    } catch {}
    delete data.matches[matchId];
    db.set(data);
    return;
  }

  match.status = 'bracket';

  if (match.type === '2v2') {
    match.teams = pairIntoTeams(match.queue);
    match.bracket = generateTeamBracket(match.teams);
  } else {
    match.bracket = generateBracket(match.queue);
  }
  match.currentRound = 0;

  try {
    const guild = await client.guilds.fetch(match.guildId);
    if (match.type === '1v1') await fetchDisplayNames(guild, match.bracket[0]);
  } catch {}

  data.matches[matchId] = match;
  db.set(data);

  const privateChannel = await createMatchChannel(client, match);
  if (!privateChannel) return;

  match.privateChannelId = privateChannel.id;
  data.matches[matchId] = match;
  db.set(data);

  // DM all players with channel link
  for (const playerId of match.queue) {
    await dmUser(client, playerId,
      `⚔️ **Your match has started!** Go to <#${privateChannel.id}>\n> Match #${match.matchNum ?? '?'} (${match.type.toUpperCase()})${match.prize ? `\n> 🎁 Prize: ${match.prize}` : ''}`
    );
  }

  // Update public queue message with link
  try {
    const ch = await client.channels.fetch(match.channelId);
    const msg = await ch.messages.fetch(match.messageId);
    const startEmbed = new EmbedBuilder()
      .setTitle('⚔️ Match Started!')
      .setColor(DARK_BLUE)
      .setDescription(`**${match.queue.length} players** locked in!\n\n➡️ **[Go to your match channel](https://discord.com/channels/${match.guildId}/${privateChannel.id})**`)
      .setTimestamp();
    if (match.prize) startEmbed.addFields({ name: '🎁 Prize', value: `**${match.prize}**` });
    startEmbed.addFields({
      name: 'Queue Status',
      value: 'Queue started. Use `/spectate` if you want to spectate the match.',
      inline: false,
    });
    await msg.edit({ embeds: [startEmbed], components: [] });
  } catch {}

  // ── ORDER: 1) Bo3 vote (60s) → 2) Region vote (60s) → 3) Bracket ──────────
  await postBo3Vote(client, match);
  await postRegionVote(client, match);

  // Re-fetch match after votes to get bo3Mode + region saved
  const freshData = db.get();
  const freshMatch = freshData.matches[matchId];

  await postOrUpdateBracket(client, freshMatch);

  // Post prediction polls for round 0
  for (let i = 0; i < freshMatch.bracket[0].length; i++) {
    const bm = freshMatch.bracket[0][i];
    if (!bm.bye && bm.p1 && bm.p2) await postPredictionPoll(client, freshMatch, bm, 0, i);
  }

  // Schedule reminders
  for (let i = 0; i < freshMatch.bracket[0].length; i++) {
    if (!freshMatch.bracket[0][i].bye) scheduleMatchReminder(client, freshMatch, matchId, i, 0);
  }
}

// ── Slash command ─────────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('creatematch')
    .setDescription('Create a match queue')
    .addStringOption(o => o.setName('type').setDescription('Match type').setRequired(true)
      .addChoices({ name: '1v1', value: '1v1' }, { name: '2v2', value: '2v2' }))
    .addStringOption(o => o.setName('scoreboard').setDescription('Scoreboard to credit wins to').setRequired(false).setAutocomplete(true))
    .addStringOption(o => o.setName('prize').setDescription('Prize for the winner').setRequired(false)),

  async autocomplete(interaction) {
    const data = db.get();
    const boards = Object.values(data.scoreboards || {}).filter(s => s.guildId === interaction.guildId);
    const focused = interaction.options.getFocused().toLowerCase();
    await interaction.respond(boards.filter(s => s.name.toLowerCase().includes(focused)).slice(0, 25).map(s => ({ name: s.name, value: s.name })));
  },

  async execute(interaction, helpers = {}) {
    if (!canManageMatch(interaction.member)) return interaction.reply({ content: '❌ You do not have permission to create matches.', flags: 64 });

    const type = interaction.options.getString('type');
    const sbName = interaction.options.getString('scoreboard');
    const prize = interaction.options.getString('prize') || null;
    const matchNum = helpers?.getNextMatchNumber?.(interaction.guildId) ?? 0;
    const matchId = `match-${interaction.guildId}-${Date.now()}`;
    const endsAt = Date.now() + QUEUE_DURATION_MS;

    const match = {
      id: matchId, guildId: interaction.guildId, channelId: interaction.channelId,
      type, scoreboardName: sbName || null, prize, queue: [], status: 'queuing',
      endsAt, bracket: [], currentRound: 0, messageId: null,
      privateChannelId: null, bracketMessageId: null, hostId: interaction.user.id,
      matchNum, teams: null, bo3Mode: 'none', region: null,
    };

    const joinRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`join_queue_${matchId}`).setLabel('Join Queue').setStyle(ButtonStyle.Success).setEmoji('⚔️'),
      new ButtonBuilder().setCustomId(`leave_queue_${matchId}`).setLabel('Leave Queue').setStyle(ButtonStyle.Secondary).setEmoji('🚪'),
      new ButtonBuilder().setCustomId(`addminute_${matchId}`).setLabel('+1 Minute').setStyle(ButtonStyle.Secondary).setEmoji('⏱️'),
      new ButtonBuilder().setCustomId(`forcestart_${matchId}`).setLabel('Force Start').setStyle(ButtonStyle.Danger).setEmoji('🚀'),
    );

    const { resource: msg } = await interaction.reply({ embeds: [buildQueueEmbed(match)], components: [joinRow], withResponse: true });
    match.messageId = msg.id;

    const data = db.get();
    if (!data.matches) data.matches = {};
    data.matches[matchId] = match;
    db.set(data);

    const intervalId = setInterval(async () => {
      const fresh = db.get();
      const m = fresh.matches[matchId];
      if (!m || m.status !== 'queuing') { clearInterval(intervalId); return; }
      try {
        const ch = await interaction.client.channels.fetch(m.channelId);
        const ms = await ch.messages.fetch(m.messageId);
        await ms.edit({ embeds: [buildQueueEmbed(m)], components: [joinRow] });
      } catch {}
    }, 30000);

    const timer = setTimeout(async () => {
      clearInterval(intervalId);
      await startBracket(interaction.client, matchId);
    }, QUEUE_DURATION_MS);

    timers.set(matchId, { timer, interval: intervalId });
  },

  // Exports
  buildBracketTextEmbed, buildBracketComponents, buildQueueEmbed,
  buildNextRound, fetchDisplayNames, makeBracketAttachment,
  postOrUpdateBracket, startBracket, scheduleChannelDelete,
  timers, canManageMatch, logMatchResult, MATCH_MANAGER_ROLES,
  postPredictionPoll, revealPrediction, scheduleMatchReminder,
  matchReminderTimers, dmUser,
};


// Queue status announcements patch
async function announceQueueStarted(interaction, match) {
  try {
    const startedEmbed = new EmbedBuilder()
      .setTitle('✅ Queue Started')
      .setDescription(
        'The queue has started and players have been moved into the match channel.\n\nUse `/spectate` if you want to spectate the match.'
      )
      .setColor(0x57F287)
      .setTimestamp();

    await interaction.channel.send({
      content: match.queue.map(id => `<@${id}>`).join(' '),
      embeds: [startedEmbed],
      allowedMentions: { parse: ['users'] }
    });
  } catch (err) {
    console.error('Failed to announce queue start:', err);
  }
}

async function announceQueueCancelled(interaction, match) {
  try {
    const cancelledEmbed = new EmbedBuilder()
      .setTitle('❌ Queue Cancelled')
      .setDescription('The queue was cancelled before the match started.')
      .setColor(0xED4245)
      .setTimestamp();

    await interaction.channel.send({
      content: match.queue?.map(id => `<@${id}>`).join(' ') || '',
      embeds: [cancelledEmbed],
      allowedMentions: { parse: ['users'] }
    });
  } catch (err) {
    console.error('Failed to announce queue cancellation:', err);
  }
}
