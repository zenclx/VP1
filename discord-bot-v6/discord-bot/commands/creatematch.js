const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
  AttachmentBuilder,
} = require('discord.js');
const db = require('../database');
const { DARK_BLUE } = require('../utils');
const { buildBracketImage } = require('../bracketImage');

const QUEUE_DURATION_MS = 5 * 60 * 1000;
const MATCH_REMINDER_MS = 10 * 60 * 1000; // ping players after 10 min of no winner
const timers = new Map();
const reminderTimers = new Map(); // matchId -> timeoutId
const MATCH_MANAGER_ROLES = ['1387600871377993820'];
const MATCH_CATEGORY_ID = '1333182926858223718';

// ── DM helper ────────────────────────────────────────────────────────────────
async function dmUser(client, userId, content) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(content);
  } catch {} // DMs may be closed
}

// ── Achievement badge helper ─────────────────────────────────────────────────
const BADGES = [
  { id: 'first_win',       name: '🏅 First Win',         color: 0xcd7f32, check: (wins) => wins === 1 },
  { id: 'ten_wins',        name: '🔟 10 Wins',            color: 0xc0c0c0, check: (wins) => wins === 10 },
  { id: 'twenty_five',     name: '💪 25 Wins',            color: 0xffd700, check: (wins) => wins === 25 },
];

async function checkAndGrantBadges(client, guild, userId, wins, streakWins) {
  try {
    const data = db.get();
    if (!data.badges) data.badges = {};
    if (!data.badges[guild.id]) data.badges[guild.id] = {};
    const userBadges = data.badges[guild.id][userId] || [];

    for (const badge of BADGES) {
      if (badge.check(wins) && !userBadges.includes(badge.id)) {
        // Ensure role exists, create if needed
        let role = guild.roles.cache.find(r => r.name === badge.name);
        if (!role) {
          role = await guild.roles.create({ name: badge.name, color: badge.color, reason: 'Achievement badge auto-created' });
        }
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) await member.roles.add(role).catch(() => {});
        userBadges.push(badge.id);
        data.badges[guild.id][userId] = userBadges;
        db.set(data);
        await dmUser(client, userId, `🏅 **Achievement Unlocked:** ${badge.name}! You earned this role in the server.`);
      }
    }

    // Win streak of 5
    if (streakWins >= 5 && !userBadges.includes('streak_5')) {
      let role = guild.roles.cache.find(r => r.name === '🔥 5-Win Streak');
      if (!role) role = await guild.roles.create({ name: '🔥 5-Win Streak', color: 0xff4500, reason: 'Streak badge auto-created' });
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member) await member.roles.add(role).catch(() => {});
      userBadges.push('streak_5');
      data.badges[guild.id][userId] = userBadges;
      db.set(data);
      await dmUser(client, userId, `🔥 **Achievement Unlocked: 5-Win Streak!** You earned the streak role in the server.`);
    }
  } catch (e) { console.error('Badge error:', e.message); }
}

async function grantChampionBadge(client, guild, userId) {
  try {
    let role = guild.roles.cache.find(r => r.name === '👑 Tournament Champion');
    if (!role) role = await guild.roles.create({ name: '👑 Tournament Champion', color: 0xffd700, reason: 'Champion badge auto-created' });
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) await member.roles.add(role).catch(() => {});
    await dmUser(client, userId, `👑 **Achievement Unlocked: Tournament Champion!** You won a tournament and earned the Champion role!`);
  } catch (e) { console.error('Champion badge error:', e.message); }
}

// ── Schedule match reminder ──────────────────────────────────────────────────
function scheduleMatchReminder(client, matchId, channelId, playerIds) {
  // Cancel existing
  const existing = reminderTimers.get(matchId);
  if (existing) clearTimeout(existing);

  const t = setTimeout(async () => {
    reminderTimers.delete(matchId);
    const data = db.get();
    const match = data.matches?.[matchId];
    if (!match || match.status !== 'bracket') return;
    try {
      const ch = await client.channels.fetch(channelId);
      const mentions = playerIds.map(id => `<@${id}>`).join(' ');
      await ch.send(`⏰ **Reminder:** ${mentions} — your match hasn't had a winner selected yet! Please play your match and have a staff member record the result.`);
    } catch {}
  }, MATCH_REMINDER_MS);

  reminderTimers.set(matchId, t);
}

// ── MVP calculation ──────────────────────────────────────────────────────────
function calculateMVP(match) {
  // MVP = player who beat highest-seeded (earliest eliminated) opponents
  // We track this by opponent ranking in bracket
  const allRounds = match.bracket;
  const opponentScore = {}; // winnerId -> total opponent difficulty

  for (let r = 0; r < allRounds.length; r++) {
    for (const m of allRounds[r]) {
      if (!m.winner || m.bye) continue;
      const loserId = m.winner === m.p1 ? m.p2 : m.p1;
      if (!loserId) continue;
      // Higher round = higher-ranked opponent (harder to beat)
      const difficulty = r + 1;
      opponentScore[m.winner] = (opponentScore[m.winner] || 0) + difficulty;
    }
  }

  if (Object.keys(opponentScore).length === 0) return null;
  const sorted = Object.entries(opponentScore).sort(([, a], [, b]) => b - a);
  return sorted[0][0]; // userId of MVP
}

function canManageMatch(member) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.some(r => MATCH_MANAGER_ROLES.includes(r.id));
}

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

// Build the text embed that sits above the bracket image
function buildBracketTextEmbed(match, round) {
  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${match.type.toUpperCase()} Bracket — Round ${round + 1}`)
    .setColor(DARK_BLUE)
    .setImage('attachment://bracket.png')
    .setFooter({ text: `Match ID: ${match.id} • Use /pickwinner to manually set a winner` })
    .setTimestamp();

  if (match.prize) embed.addFields({ name: '🎁 Prize', value: `**${match.prize}**`, inline: false });
  return embed;
}

function buildBracketComponents(match, round) {
  const currentRound = match.bracket[round];
  const rows = [];
  currentRound.forEach((m, i) => {
    if (!m.winner && !m.bye) {
      const p1Label = m.p1Tag || 'Player 1';
      const p2Label = m.p2Tag || 'Player 2';
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`win_${match.id}_${round}_${i}_${m.p1}`)
          .setLabel(`M${i + 1}: ${p1Label.slice(0, 20)} wins`)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`win_${match.id}_${round}_${i}_${m.p2}`)
          .setLabel(`M${i + 1}: ${p2Label.slice(0, 20)} wins`)
          .setStyle(ButtonStyle.Primary)
      );
      rows.push(row);
    }
  });
  return rows.slice(0, 5);
}

// Generate bracket image buffer from current match state
function makeBracketAttachment(match) {
  const buf = buildBracketImage(match.bracket, match.currentRound, null);
  return new AttachmentBuilder(buf, { name: 'bracket.png' });
}

// ──────────────────────────────────────────────
// Bye logic
// ──────────────────────────────────────────────
function generateBracket(players, matchType) {
  const shuffled = [...players].sort(() => Math.random() - 0.5);

  // ── 2v2: auto-pair into teams ──────────────────────────────────────
  if (matchType === '2v2') {
    const teams = [];
    for (let i = 0; i + 1 < shuffled.length; i += 2) {
      teams.push({ members: [shuffled[i], shuffled[i + 1]], name: null });
    }
    if (shuffled.length % 2 !== 0) teams.push({ members: [shuffled[shuffled.length - 1]], name: null });

    const round = [];
    for (let i = 0; i + 1 < teams.length; i += 2) {
      round.push({
        p1: teams[i].members[0], p2: teams[i + 1].members[0], winner: null,
        p1Tag: null, p2Tag: null, bye: false,
        // Team data
        isTeamMatch: true,
        team1: teams[i].members, team2: teams[i + 1].members,
        team1Tags: [], team2Tags: [],
      });
    }
    if (teams.length % 2 !== 0) {
      const t = teams[teams.length - 1];
      round.push({
        p1: t.members[0], p2: null, winner: t.members[0], bye: true, byePlayer: true,
        p1Tag: null, isTeamMatch: true, team1: t.members, team2: [],
        team1Tags: [], team2Tags: [],
      });
    }
    return [round];
  }

  // ── 1v1 ───────────────────────────────────────────────────────────
  const round = [];
  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    round.push({ p1: shuffled[i], p2: shuffled[i + 1], winner: null, p1Tag: null, p2Tag: null, bye: false });
  }
  if (shuffled.length % 2 !== 0) {
    round.push({ p1: shuffled[shuffled.length - 1], p2: null, winner: shuffled[shuffled.length - 1], bye: true, byePlayer: true, p1Tag: null });
  }
  return [round];
}

function buildNextRound(currentRound) {
  const byeWinners = currentRound.filter(m => m.bye && m.byePlayer).map(m => ({ id: m.winner, tag: m.p1Tag }));
  const normalWinners = currentRound.filter(m => !m.bye).map(m => {
    const winnerTag = m.winner === m.p1 ? m.p1Tag : m.p2Tag;
    return { id: m.winner, tag: winnerTag };
  });

  const nextRound = [];
  const pool = [...normalWinners];

  // Each bye winner is paired with a normal winner
  for (const bye of byeWinners) {
    if (pool.length > 0) {
      const opp = pool.shift();
      nextRound.push({ p1: bye.id, p2: opp.id, winner: null, p1Tag: bye.tag, p2Tag: opp.tag, bye: false });
    } else {
      // No one to fight — give another bye (shouldn't happen in normal flow)
      nextRound.push({ p1: bye.id, p2: null, winner: bye.id, bye: true, byePlayer: true, p1Tag: bye.tag });
    }
  }

  // Pair remaining normal winners
  for (let i = 0; i + 1 < pool.length; i += 2) {
    nextRound.push({ p1: pool[i].id, p2: pool[i + 1].id, winner: null, p1Tag: pool[i].tag, p2Tag: pool[i + 1].tag, bye: false });
  }

  // Leftover odd winner gets a bye
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
    // 2v2 team names
    if (m.isTeamMatch) {
      m.team1Tags = [];
      m.team2Tags = [];
      for (const id of (m.team1 || [])) {
        try { m.team1Tags.push((await guild.members.fetch(id)).displayName); } catch { m.team1Tags.push(id); }
      }
      for (const id of (m.team2 || [])) {
        try { m.team2Tags.push((await guild.members.fetch(id)).displayName); } catch { m.team2Tags.push(id); }
      }
      // Override the p1Tag/p2Tag to show "Name1 & Name2"
      if (m.team1Tags.length) m.p1Tag = m.team1Tags.join(' & ');
      if (m.team2Tags.length) m.p2Tag = m.team2Tags.join(' & ');
    }
  }
}

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
  } catch (e) {
    console.error('Failed to create match channel:', e.message);
    return null;
  }
}

async function scheduleChannelDelete(client, channelId) {
  setTimeout(async () => {
    try { await (await client.channels.fetch(channelId)).send('⚠️ **This channel will be deleted in 10 seconds.**'); } catch {}
  }, 50000);
  setTimeout(async () => {
    try { await (await client.channels.fetch(channelId)).delete('Match complete'); } catch {}
  }, 60000);
}

async function logMatchResult(client, match, winnerId, loserIds) {
  try {
    const data = db.get();
    const guildId = match.guildId;
    if (!data.matchLogs) data.matchLogs = {};
    if (!data.matchLogs[guildId]) data.matchLogs[guildId] = [];

    data.matchLogs[guildId].unshift({
      matchId: match.id, matchNum: match.matchNum ?? 0, type: match.type, winner: winnerId,
      opponents: loserIds, prize: match.prize || null,
      timestamp: Date.now(), scoreboard: match.scoreboardName || null,
    });
    if (data.matchLogs[guildId].length > 100) data.matchLogs[guildId].length = 100;
    db.set(data);

    const settings = data.settings?.[guildId] || {};
    if (settings.logChannelId) {
      const ch = await client.channels.fetch(settings.logChannelId);
      const embed = new EmbedBuilder()
        .setTitle('📋 Match Result')
        .setColor(0x00c853)
        .addFields({ name: '🏆 Winner', value: `<@${winnerId}>`, inline: true },
                   { name: '🎮 Type', value: match.type.toUpperCase(), inline: true })
        .setTimestamp();
      if (match.prize) embed.addFields({ name: '🎁 Prize', value: match.prize, inline: false });
      await ch.send({ embeds: [embed] });
    }
  } catch (e) { console.error('Failed to log match:', e.message); }
}

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
    // Post new
    const msg = await ch.send({ embeds: [embed], files: [attachment], components });
    match.bracketMessageId = msg.id;
    const data = db.get();
    data.matches[match.id] = match;
    db.set(data);
  } catch (e) { console.error('Failed to post bracket:', e.message); }
}

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
          .setDescription(`Not enough players. Need **${minPlayers}**, only **${match.queue.length}** joined.`)],
        components: []
      });
    } catch {}
    delete data.matches[matchId];
    db.set(data);
    return;
  }

  match.status = 'bracket';
  match.bracket = generateBracket(match.queue, match.type);
  match.currentRound = 0;
  match.bo3Mode = 'none'; // default; updated by vote

  try {
    const guild = await client.guilds.fetch(match.guildId);
    await fetchDisplayNames(guild, match.bracket[0]);
  } catch {}

  data.matches[matchId] = match;
  db.set(data);

  const privateChannel = await createMatchChannel(client, match);
  if (privateChannel) {
    match.privateChannelId = privateChannel.id;
    data.matches[matchId] = match;
    db.set(data);

    // ── BO3 vote ──────────────────────────────────────────────────
    const voteEmbed = new EmbedBuilder()
      .setTitle('🗳️ Best-of-3 Vote')
      .setColor(DARK_BLUE)
      .setDescription('Vote on match format for this tournament. Vote lasts **60 seconds**.')
      .addFields(
        { name: '🎯 All Matches BO3', value: 'Every match is best of 3', inline: true },
        { name: '🏆 Finals Only BO3', value: 'Only the final match is best of 3', inline: true },
        { name: '❌ No BO3', value: 'All matches are single-game', inline: true },
      );

    const voteRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bo3vote_all_${matchId}`).setLabel('All Matches BO3').setStyle(ButtonStyle.Primary).setEmoji('🎯'),
      new ButtonBuilder().setCustomId(`bo3vote_finals_${matchId}`).setLabel('Finals Only').setStyle(ButtonStyle.Secondary).setEmoji('🏆'),
      new ButtonBuilder().setCustomId(`bo3vote_none_${matchId}`).setLabel('No BO3').setStyle(ButtonStyle.Danger).setEmoji('❌'),
    );

    const voteMsg = await privateChannel.send({ embeds: [voteEmbed], components: [voteRow] });

    // Tally votes after 60s
    const votes = { all: [], finals: [], none: [] };
    match.bo3Votes = votes;
    match.bo3VoteMsgId = voteMsg.id;
    data.matches[matchId] = match;
    db.set(data);

    setTimeout(async () => {
      const fresh = db.get();
      const m = fresh.matches[matchId];
      if (!m) return;
      const v = m.bo3Votes || { all: [], finals: [], none: [] };
      const winner = [
        { key: 'all', count: v.all.length },
        { key: 'finals', count: v.finals.length },
        { key: 'none', count: v.none.length },
      ].sort((a, b) => b.count - a.count)[0];

      m.bo3Mode = winner.key;
      fresh.matches[matchId] = m;
      db.set(fresh);

      const resultEmbed = new EmbedBuilder()
        .setTitle('🗳️ Vote Closed!')
        .setColor(0x00c853)
        .setDescription(
          `**Result: ${winner.key === 'all' ? '🎯 All Matches BO3' : winner.key === 'finals' ? '🏆 Finals Only BO3' : '❌ No BO3'}**\n` +
          `Votes — All: **${v.all.length}**, Finals: **${v.finals.length}**, None: **${v.none.length}**`
        );
      try {
        const ch = await client.channels.fetch(privateChannel.id);
        const msg = await ch.messages.fetch(m.bo3VoteMsgId);
        await msg.edit({ embeds: [resultEmbed], components: [] });
      } catch {}
    }, 60000);

    // ── Post bracket image ─────────────────────────────────────────
    await postOrUpdateBracket(client, match);

    // ── DM all players ─────────────────────────────────────────────
    const guild = await client.guilds.fetch(match.guildId).catch(() => null);
    for (const playerId of match.queue) {
      await dmUser(client, playerId,
        `⚔️ **Your match has started!**\nJump into your private match channel: https://discord.com/channels/${match.guildId}/${privateChannel.id}`
      );
    }

    // ── Schedule reminder for first round ─────────────────────────
    const firstRoundPlayers = match.bracket[0].flatMap(m => [m.p1, m.p2].filter(Boolean));
    scheduleMatchReminder(client, matchId, privateChannel.id, firstRoundPlayers);

    // ── Update public queue message ────────────────────────────────
    try {
      const ch = await client.channels.fetch(match.channelId);
      const msg = await ch.messages.fetch(match.messageId);
      const startEmbed = new EmbedBuilder()
        .setTitle('⚔️ Match Started!')
        .setColor(DARK_BLUE)
        .setDescription(`**${match.queue.length} players** locked in!\n\n➡️ **[Go to your match channel](https://discord.com/channels/${match.guildId}/${privateChannel.id})**`)
        .setTimestamp();
      if (match.prize) startEmbed.addFields({ name: '🎁 Prize', value: `**${match.prize}**` });
      await msg.edit({ embeds: [startEmbed], components: [] });
    } catch {}
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('creatematch')
    .setDescription('Create a match queue')
    .addStringOption(o =>
      o.setName('type').setDescription('Match type').setRequired(true)
        .addChoices({ name: '1v1', value: '1v1' }, { name: '2v2', value: '2v2' })
    )
    .addStringOption(o =>
      o.setName('scoreboard').setDescription('Scoreboard to credit wins to').setRequired(false).setAutocomplete(true)
    )
    .addStringOption(o =>
      o.setName('prize').setDescription('Prize for the winner (leave blank for none)').setRequired(false)
    ),

  async autocomplete(interaction) {
    const data = db.get();
    const boards = Object.values(data.scoreboards || {}).filter(s => s.guildId === interaction.guildId);
    const focused = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      boards.filter(s => s.name.toLowerCase().includes(focused)).slice(0, 25).map(s => ({ name: s.name, value: s.name }))
    );
  },

  async execute(interaction, helpers = {}) {
    if (!canManageMatch(interaction.member)) {
      return interaction.reply({ content: '❌ You do not have permission to create matches.', ephemeral: true });
    }

    const type = interaction.options.getString('type');
    const sbName = interaction.options.getString('scoreboard');
    const prize = interaction.options.getString('prize') || null;
    const matchNum = helpers?.getNextMatchNumber(interaction.guildId) ?? 0;
    const matchId = `match-${interaction.guildId}-${Date.now()}`;
    const endsAt = Date.now() + QUEUE_DURATION_MS;

    const match = {
      id: matchId, guildId: interaction.guildId, channelId: interaction.channelId,
      type, scoreboardName: sbName || null, prize, queue: [], status: 'queuing',
      endsAt, bracket: [], currentRound: 0, messageId: null,
      privateChannelId: null, bracketMessageId: null, hostId: interaction.user.id,
      matchNum: matchNum,
    };

    const joinRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`join_queue_${matchId}`).setLabel('Join Queue').setStyle(ButtonStyle.Success).setEmoji('⚔️'),
      new ButtonBuilder().setCustomId(`leave_queue_${matchId}`).setLabel('Leave Queue').setStyle(ButtonStyle.Secondary).setEmoji('🚪'),
      new ButtonBuilder().setCustomId(`addminute_${matchId}`).setLabel('+1 Minute').setStyle(ButtonStyle.Secondary).setEmoji('⏱️'),
      new ButtonBuilder().setCustomId(`forcestart_${matchId}`).setLabel('Force Start').setStyle(ButtonStyle.Danger).setEmoji('🚀'),
    );

    const msg = await interaction.reply({ embeds: [buildQueueEmbed(match)], components: [joinRow], fetchReply: true });
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

  buildBracketTextEmbed,
  buildBracketComponents,
  buildQueueEmbed,
  buildNextRound,
  fetchDisplayNames,
  makeBracketAttachment,
  postOrUpdateBracket,
  startBracket,
  scheduleChannelDelete,
  timers,
  canManageMatch,
  logMatchResult,
  MATCH_MANAGER_ROLES,
  dmUser,
  checkAndGrantBadges,
  grantChampionBadge,
  calculateMVP,
  scheduleMatchReminder,
  reminderTimers,
};
