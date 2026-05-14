const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');

const TIER_ROLES = {
  I: '1394141603962163373',
  II: '1394141793142046750',
  III: '1394142018044690602',
  IV: '1394142109463740446',
  V: '1394142206218080265',
};

const TIERS = [
  { tier: 'I', emoji: 'Crown', min: 2000, roleId: TIER_ROLES.I },
  { tier: 'II', emoji: 'Diamond', min: 1600, roleId: TIER_ROLES.II },
  { tier: 'III', emoji: 'Arcane', min: 1200, roleId: TIER_ROLES.III },
  { tier: 'IV', emoji: 'Spark', min: 800, roleId: TIER_ROLES.IV },
  { tier: 'V', emoji: 'Shield', min: 0, roleId: TIER_ROLES.V },
];

const STARTING_ELO = 0;
const LOSS_PENALTY = 10;

function getWinElo(roundIndex, isFinalRound) {
  if (isFinalRound) return 100;
  if (roundIndex === 0) return 20;
  if (roundIndex === 1) return 30;
  if (roundIndex === 2) return 45;
  return 60;
}

function getTierForElo(elo) {
  return TIERS.find(t => elo >= t.min) || TIERS[TIERS.length - 1];
}

function getEloData(data) {
  if (!data.elo) data.elo = {};
  return data.elo;
}

function getPlayerElo(eloData, userId) {
  if (!eloData[userId]) {
    eloData[userId] = { elo: STARTING_ELO, wins: 0, losses: 0, matchHistory: [] };
  }
  return eloData[userId];
}

function applyEloChange(eloData, userId, delta) {
  const player = getPlayerElo(eloData, userId);
  const oldElo = player.elo;
  const oldTier = getTierForElo(oldElo);
  player.elo = Math.max(0, oldElo + delta);
  const newTier = getTierForElo(player.elo);
  return { oldElo, newElo: player.elo, oldTier, newTier, tierChanged: oldTier.tier !== newTier.tier };
}

async function syncRoles(guild, userId, newTier) {
  try {
    const member = await guild.members.fetch(userId);
    const allRoleIds = Object.values(TIER_ROLES);
    const toRemove = member.roles.cache.filter(r => allRoleIds.includes(r.id));
    if (toRemove.size) await member.roles.remove(toRemove);
    await member.roles.add(newTier.roleId);
  } catch (e) {
    console.error(`Failed to sync ELO role for ${userId}:`, e.message);
  }
}

async function applyMatchElo(client, match, winnerId, loserId, roundIndex, isFinal) {
  try {
    const data = db.get();
    const eloData = getEloData(data);
    const gainAmount = getWinElo(roundIndex, isFinal);

    const winResult = applyEloChange(eloData, winnerId, gainAmount);
    const winner = getPlayerElo(eloData, winnerId);
    winner.wins = (winner.wins || 0) + 1;
    winner.matchHistory = [
      { matchId: match.id, type: 'win', delta: gainAmount, elo: winResult.newElo, round: roundIndex, ts: Date.now() },
      ...(winner.matchHistory || []),
    ].slice(0, 50);

    let lossResult = null;
    if (loserId) {
      lossResult = applyEloChange(eloData, loserId, -LOSS_PENALTY);
      const loser = getPlayerElo(eloData, loserId);
      loser.losses = (loser.losses || 0) + 1;
      loser.matchHistory = [
        { matchId: match.id, type: 'loss', delta: -LOSS_PENALTY, elo: lossResult.newElo, round: roundIndex, ts: Date.now() },
        ...(loser.matchHistory || []),
      ].slice(0, 50);
    }

    db.set(data);

    try {
      const guild = await client.guilds.fetch(match.guildId);
      await syncRoles(guild, winnerId, getTierForElo(winResult.newElo));
      if (loserId && lossResult) await syncRoles(guild, loserId, getTierForElo(lossResult.newElo));
    } catch {}
  } catch (e) {
    console.error('applyMatchElo error:', e.message);
  }
}

function buildProgressBar(elo, tier, nextTier) {
  const barLen = 12;
  if (!nextTier) return '#'.repeat(barLen) + ' MAX';
  const range = Math.max(1, nextTier.min - tier.min);
  const progress = Math.max(0, elo - tier.min);
  const filled = Math.min(barLen, Math.max(0, Math.round((progress / range) * barLen)));
  return '#'.repeat(filled) + '-'.repeat(barLen - filled) + ` ${progress}/${range}`;
}

function tierColor(tier) {
  return { I: 0xffd700, II: 0x00bfff, III: 0xab47bc, IV: 0x78909c, V: 0x546e7a }[tier] || 0x7289da;
}

function buildMatchEloSummary(match, eloData) {
  const startElo = match.eloStart || {};
  const players = (match.queue || []).map(userId => {
    const player = eloData[userId] || { elo: STARTING_ELO, wins: 0, losses: 0 };
    const starting = startElo[userId] ?? STARTING_ELO;
    const current = player.elo ?? STARTING_ELO;
    return {
      userId,
      starting,
      current,
      delta: current - starting,
      wins: player.wins || 0,
      losses: player.losses || 0,
    };
  });

  players.sort((a, b) => b.delta - a.delta || b.current - a.current);

  return players.map((p, i) => {
    const sign = p.delta >= 0 ? '+' : '';
    return `**${i + 1}.** <@${p.userId}> - ${sign}${p.delta} ELO (${p.starting} -> ${p.current}) - ${p.wins}W/${p.losses}L`;
  }).join('\n') || 'No ELO changes recorded.';
}

const eloRankCommand = {
  data: new SlashCommandBuilder()
    .setName('elorank')
    .setDescription('Check ELO rank for yourself or another player')
    .addUserOption(o => o.setName('user').setDescription('Player to look up').setRequired(false)),

  async execute(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const data = db.get();
    const eloData = getEloData(data);
    const player = getPlayerElo(eloData, target.id);
    db.set(data);

    const tier = getTierForElo(player.elo);
    const nextTier = TIERS[TIERS.indexOf(tier) - 1] || null;
    const eloToNext = nextTier ? Math.max(0, nextTier.min - player.elo) : null;
    const progressBar = buildProgressBar(player.elo, tier, nextTier);

    const embed = new EmbedBuilder()
      .setTitle(`Tier ${tier.tier}`)
      .setColor(tierColor(tier.tier))
      .addFields(
        { name: 'Player', value: `<@${target.id}>`, inline: true },
        { name: 'ELO', value: `\`${player.elo}\``, inline: true },
        { name: 'Record', value: `${player.wins || 0}W / ${player.losses || 0}L`, inline: true },
        { name: 'Progress', value: progressBar + (nextTier ? `\n\`${eloToNext} ELO\` to **Tier ${nextTier.tier}**` : '\nMax tier reached.'), inline: false },
      )
      .setFooter({ text: 'Tier I = top rank | Tier V = starting rank' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

const eloLeaderboardCommand = {
  data: new SlashCommandBuilder()
    .setName('eloleaderboard')
    .setDescription('Top ELO rankings for this server'),

  async execute(interaction) {
    const data = db.get();
    const eloData = getEloData(data);
    const sorted = Object.entries(eloData)
      .map(([userId, p]) => ({ userId, elo: p.elo || 0, wins: p.wins || 0, losses: p.losses || 0 }))
      .sort((a, b) => b.elo - a.elo || b.wins - a.wins)
      .slice(0, 20);

    if (!sorted.length) return interaction.reply({ content: 'No ELO data yet. Play some matches!', flags: 64 });

    const lines = sorted.map((p, i) => {
      const tier = getTierForElo(p.elo);
      return `**${i + 1}.** <@${p.userId}> - \`${p.elo} ELO\` - Tier ${tier.tier} - ${p.wins}W/${p.losses}L`;
    });

    const embed = new EmbedBuilder()
      .setTitle('ELO Leaderboard')
      .setColor(0xffd700)
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Everyone starts at Tier V | 0 ELO' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

const eloResetPlayerCommand = {
  data: new SlashCommandBuilder()
    .setName('eloresetplayer')
    .setDescription('Reset a player\'s ELO to 0 (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('Player to reset').setRequired(true)),

  async execute(interaction) {
    const target = interaction.options.getUser('user');
    const data = db.get();
    const eloData = getEloData(data);
    eloData[target.id] = { elo: STARTING_ELO, wins: 0, losses: 0, matchHistory: [] };
    db.set(data);
    try {
      const guild = await interaction.client.guilds.fetch(interaction.guildId);
      await syncRoles(guild, target.id, getTierForElo(STARTING_ELO));
    } catch {}
    await interaction.reply({ content: `Reset <@${target.id}>'s ELO to \`0\` (Tier V).`, flags: 64 });
  },
};

const eloAdjustCommand = {
  data: new SlashCommandBuilder()
    .setName('eloadjust')
    .setDescription('Manually adjust a player\'s ELO (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('Player').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount to add (negative to subtract)').setRequired(true)),

  async execute(interaction) {
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    const data = db.get();
    const eloData = getEloData(data);
    const result = applyEloChange(eloData, target.id, amount);
    db.set(data);
    try {
      const guild = await interaction.client.guilds.fetch(interaction.guildId);
      await syncRoles(guild, target.id, getTierForElo(result.newElo));
    } catch {}
    const sign = amount >= 0 ? '+' : '';
    await interaction.reply({ content: `Adjusted <@${target.id}>'s ELO by **${sign}${amount}**: \`${result.oldElo}\` -> \`${result.newElo}\` (Tier ${getTierForElo(result.newElo).tier})`, flags: 64 });
  },
};

module.exports = {
  eloRankCommand,
  eloLeaderboardCommand,
  eloResetPlayerCommand,
  eloAdjustCommand,
  applyMatchElo,
  buildMatchEloSummary,
  getTierForElo,
  getEloData,
  getPlayerElo,
  syncRoles,
  STARTING_ELO,
  TIERS,
};
