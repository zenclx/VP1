/**
 * ELO / Rank System
 *
 * Tiers (highest → lowest):
 *   Tier I   — 2000+ ELO
 *   Tier II  — 1600–1999
 *   Tier III — 1200–1599
 *   Tier IV  — 800–1199
 *   Tier V   — 0–799  ← everyone starts here (0 ELO)
 *
 * ELO gains per match result:
 *   Win Round 1  → +20
 *   Win Round 2  → +30
 *   Win Round 3  → +45
 *   Win Round 4+ → +60
 *   Champion     → +100
 *   Loss penalty → -10
 */

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');

const TIER_ROLES = {
  I:   '1394141603962163373',
  II:  '1394141793142046750',
  III: '1394142018044690602',
  IV:  '1394142109463740446',
  V:   '1394142206218080265',
};

const TIERS = [
  { tier: 'I',   emoji: '👑', min: 2000, roleId: TIER_ROLES.I   },
  { tier: 'II',  emoji: '💎', min: 1600, roleId: TIER_ROLES.II  },
  { tier: 'III', emoji: '🔮', min: 1200, roleId: TIER_ROLES.III },
  { tier: 'IV',  emoji: '⚡', min:  800, roleId: TIER_ROLES.IV  },
  { tier: 'V',   emoji: '🛡️', min:    0, roleId: TIER_ROLES.V   },
];

const STARTING_ELO = 0;

function getWinElo(roundIndex, isFinalRound) {
  if (isFinalRound) return 100;
  if (roundIndex === 0) return 20;
  if (roundIndex === 1) return 30;
  if (roundIndex === 2) return 45;
  return 60;
}

const LOSS_PENALTY = 10;

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

async 
  player.wins = player.wins || 0;
  player.losses = player.losses || 0;
  player.matchHistory = player.matchHistory || [];

function applyMatchElo(client, match, winnerId, loserId, roundIndex, isFinal) {
  try {
    const data = db.get();
    const eloData = getEloData(data);
    const guildId = match.guildId;
    const gainAmount = getWinElo(roundIndex, isFinal);

    const winResult = applyEloChange(eloData, winnerId, +gainAmount);
    eloData[winnerId].wins = (eloData[winnerId].wins || 0) + 1;
    eloData[winnerId].matchHistory = [
      { type: 'win', delta: +gainAmount, elo: winResult.newElo, round: roundIndex, ts: Date.now() },
      ...(eloData[winnerId].matchHistory || [])
    ].slice(0, 50);

    let lossResult = null;
    if (loserId) {
      lossResult = applyEloChange(eloData, loserId, -LOSS_PENALTY);
      eloData[loserId].losses = (eloData[loserId].losses || 0) + 1;
      eloData[loserId].matchHistory = [
        { type: 'loss', delta: -LOSS_PENALTY, elo: lossResult.newElo, round: roundIndex, ts: Date.now() },
        ...(eloData[loserId].matchHistory || [])
      ].slice(0, 50);
    }

    db.set(data);

    try {
      const guild = await client.guilds.fetch(guildId);
      await syncRoles(guild, winnerId, getTierForElo(winResult.newElo));
      if (loserId) await syncRoles(guild, loserId, getTierForElo(lossResult.newElo));
    } catch {}

    if (match.privateChannelId) {
      try {
        const ch = await client.channels.fetch(match.privateChannelId);
        const winTier = getTierForElo(winResult.newElo);
        const embed = new EmbedBuilder()
          .setTitle(`${isFinal ? '🏆 Finals' : `⚔️ Round ${roundIndex + 1}`} — ELO Update`)
          .setColor(isFinal ? 0xffd700 : 0x00c853)
          .addFields(
      {
        name: 'Record',
        value: `${player.wins || 0} Wins / ${player.losses || 0} Losses`,
        inline: true
      },
            {
              name: `${winTier.emoji} Winner`,
              value: `<@${winnerId}>\n**+${gainAmount} ELO** → \`${winResult.newElo}\` (Tier ${winTier.tier})${winResult.tierChanged ? `\n🎉 **Promoted to Tier ${winTier.tier}!**` : ''}`,
              inline: true,
            },
            loserId ? {
              name: '💔 Loser',
              value: `<@${loserId}>\n**-${LOSS_PENALTY} ELO** → \`${lossResult.newElo}\` (Tier ${getTierForElo(lossResult.newElo).tier})${lossResult.tierChanged ? `\n📉 **Dropped to Tier ${getTierForElo(lossResult.newElo).tier}**` : ''}`,
              inline: true,
            } : { name: '\u200b', value: '\u200b', inline: true },
          )
          .setFooter({ text: 'Use /elorank to check your rating' })
          .setTimestamp();
        await ch.send({ embeds: [embed] });
      } catch {}
    }
  } catch (e) {
    console.error('applyMatchElo error:', e.message);
  }
}

// ── /elorank ──────────────────────────────────────────────────────────────────
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
    const tier = getTierForElo(player.elo);
    const nextTier = TIERS[TIERS.indexOf(tier) - 1];
    const eloToNext = nextTier ? nextTier.min - player.elo : null;
    const progressBar = buildProgressBar(player.elo, tier, nextTier);

    const embed = new EmbedBuilder()
      .setTitle(`${tier.emoji} Tier ${tier.tier}`)
      .setColor(tierColor(tier.tier))
      .addFields(
        { name: 'Player', value: `<@${target.id}>`, inline: true },
        { name: 'ELO',    value: `\`${player.elo}\``, inline: true },
        { name: 'Record', value: `${player.wins}W / ${player.losses}L`, inline: true },
        { name: 'Progress', value: progressBar + (eloToNext ? `\n\`${eloToNext} ELO\` to **Tier ${nextTier.tier}**` : '\n👑 **Max Tier!**'), inline: false },
      )
      .setFooter({ text: 'Tier I = Top · Tier V = Start' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};

// ── /eloleaderboard ───────────────────────────────────────────────────────────
const eloLeaderboardCommand = {
  data: new SlashCommandBuilder()
    .setName('eloleaderboard')
    .setDescription('Top 10 ELO rankings for this server'),

  async execute(interaction) {
    const data = db.get();
    const eloData = getEloData(data);
    const sorted = Object.entries(eloData)
      .map(([userId, p]) => ({ userId, ...p }))
      .sort((a, b) => b.elo - a.elo)
      .slice(0, 10);

    if (!sorted.length) return interaction.reply({ content: 'No ELO data yet. Play some matches!', flags: 64 });

    const lines = [];
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      const tier = getTierForElo(p.elo);
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
      lines.push(`${medal} ${tier.emoji} <@${p.userId}> — \`${p.elo} ELO\` · Tier ${tier.tier} · ${p.wins}W/${p.losses}L`);
    }

    const embed = new EmbedBuilder()
      .setTitle('🏆 ELO Leaderboard')
      .setColor(0xffd700)
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Everyone starts at Tier V · 0 ELO' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};

// ── /eloresetplayer ───────────────────────────────────────────────────────────
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
    await interaction.reply({ content: `✅ Reset <@${target.id}>'s ELO to \`0\` (Tier V).`, flags: 64 });
  }
};

// ── /eloadjust ────────────────────────────────────────────────────────────────
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
    await interaction.reply({ content: `✅ Adjusted <@${target.id}>'s ELO by **${sign}${amount}**: \`${result.oldElo}\` → \`${result.newElo}\` (Tier ${getTierForElo(result.newElo).tier})`, flags: 64 });
  }
};

function buildProgressBar(elo, tier, nextTier) {
  const barLen = 12;
  if (!nextTier) return '█'.repeat(barLen) + ' MAX';
  const range = Math.max(1, nextTier.min - tier.min);
  const progress = Math.max(0, elo - tier.min);
  const filled = Math.min(barLen, Math.round((progress / range) * barLen));
  return '█'.repeat(filled) + '░'.repeat(barLen - filled) + ` ${progress}/${range}`;
}

function tierColor(tier) {
  return { I: 0xffd700, II: 0x00bfff, III: 0xab47bc, IV: 0x78909c, V: 0x546e7a }[tier] || 0x7289da;
}



function buildMatchEloSummary(match, eloData) {
  const players = [];

  for (const userId of match.queue || []) {
    const player = eloData[userId];
    if (!player) continue;

    const recent = player.matchHistory?.[0];
    if (!recent) continue;

    players.push({
      userId,
      elo: player.elo,
      delta: recent.delta,
      wins: player.wins,
      losses: player.losses,
    });
  }

  players.sort((a, b) => b.delta - a.delta);

  return players
    .map((p, i) => {
      const sign = p.delta >= 0 ? '+' : '';
      return `**${i + 1}.** <@${p.userId}> · ${sign}${p.delta} ELO · ${p.elo} total`;
    })
    .join('\n');
}

module.exports = {
  eloRankCommand, eloLeaderboardCommand, eloResetPlayerCommand, eloAdjustCommand,
  applyMatchElo, getTierForElo, syncRoles, STARTING_ELO, TIERS,
};
