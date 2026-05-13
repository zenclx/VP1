/**
 * ELO / Rank System
 *
 * Tiers (highest → lowest):
 *   Tier I   — Diamond  — 2000+ ELO
 *   Tier II  — Platinum — 1600–1999
 *   Tier III — Gold     — 1200–1599
 *   Tier IV  — Silver   — 800–1199
 *   Tier V   — Bronze   — 0–799  ← everyone starts here (1000 ELO)
 *
 * ELO gains per match result
 *   Win in Round 1 (first round)  → +20
 *   Win in Round 2                → +30
 *   Win in Round 3                → +45
 *   Win in Round 4+               → +60
 *   Win the Finals (champion)     → +100
 *
 * Loss penalty: -10 flat (small, to keep climbing easy)
 */

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');

// ── Role IDs ─────────────────────────────────────────────────────────────────
const TIER_ROLES = {
  I:   '1394141603962163373',
  II:  '1394141793142046750',
  III: '1394142018044690602',
  IV:  '1394142109463740446',
  V:   '1394142206218080265',
};

// ── Tier thresholds ───────────────────────────────────────────────────────────
const TIERS = [
  { tier: 'I',   label: 'Diamond',  emoji: '💎', min: 2000, roleId: TIER_ROLES.I   },
  { tier: 'II',  label: 'Platinum', emoji: '🔮', min: 1600, roleId: TIER_ROLES.II  },
  { tier: 'III', label: 'Gold',     emoji: '🥇', min: 1200, roleId: TIER_ROLES.III },
  { tier: 'IV',  label: 'Silver',   emoji: '🥈', min:  800, roleId: TIER_ROLES.IV  },
  { tier: 'V',   label: 'Bronze',   emoji: '🥉', min:    0, roleId: TIER_ROLES.V   },
];

const STARTING_ELO = 1000;

// ELO gain by round index (0-based). Round 0 = first round of bracket.
function getWinElo(roundIndex, isFinalRound) {
  if (isFinalRound) return 100;   // champion bonus
  if (roundIndex === 0) return 20;
  if (roundIndex === 1) return 30;
  if (roundIndex === 2) return 45;
  return 60; // round 4+
}

const LOSS_PENALTY = 10;

// ── Helpers ───────────────────────────────────────────────────────────────────
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

/** Update a player's ELO and return { oldElo, newElo, oldTier, newTier, changed } */
function applyEloChange(eloData, userId, delta) {
  const player = getPlayerElo(eloData, userId);
  const oldElo = player.elo;
  const oldTier = getTierForElo(oldElo);
  player.elo = Math.max(0, oldElo + delta);
  const newTier = getTierForElo(player.elo);
  return { oldElo, newElo: player.elo, oldTier, newTier, tierChanged: oldTier.tier !== newTier.tier };
}

/** Assign/remove Discord tier roles for a member */
async function syncRoles(guild, userId, newTier) {
  try {
    const member = await guild.members.fetch(userId);
    const allRoleIds = Object.values(TIER_ROLES);
    // Remove all tier roles first
    const toRemove = member.roles.cache.filter(r => allRoleIds.includes(r.id));
    if (toRemove.size) await member.roles.remove(toRemove);
    // Add correct role
    await member.roles.add(newTier.roleId);
  } catch (e) {
    console.error(`Failed to sync ELO role for ${userId}:`, e.message);
  }
}

/**
 * Called from index.js win_* handler and pickwinner when a match slot resolves.
 *
 * @param {object} client      Discord client
 * @param {object} match       Match object from DB
 * @param {string} winnerId    User ID of the winner
 * @param {string} loserId     User ID of the loser (null if bye)
 * @param {number} roundIndex  0-based round index
 * @param {boolean} isFinal    True when this win ends the tournament
 */
async function applyMatchElo(client, match, winnerId, loserId, roundIndex, isFinal) {
  try {
    const data = db.get();
    const eloData = getEloData(data);
    const guildId = match.guildId;

    const gainAmount = getWinElo(roundIndex, isFinal);

    // Winner
    const winResult = applyEloChange(eloData, winnerId, +gainAmount);
    eloData[winnerId].wins += 1;
    eloData[winnerId].matchHistory = [
      { type: 'win', delta: +gainAmount, elo: winResult.newElo, round: roundIndex, ts: Date.now() },
      ...(eloData[winnerId].matchHistory || [])
    ].slice(0, 50);

    // Loser (if real player, not bye)
    let lossResult = null;
    if (loserId) {
      lossResult = applyEloChange(eloData, loserId, -LOSS_PENALTY);
      eloData[loserId].losses += 1;
      eloData[loserId].matchHistory = [
        { type: 'loss', delta: -LOSS_PENALTY, elo: lossResult.newElo, round: roundIndex, ts: Date.now() },
        ...(eloData[loserId].matchHistory || [])
      ].slice(0, 50);
    }

    db.set(data);

    // Sync roles
    try {
      const guild = await client.guilds.fetch(guildId);
      await syncRoles(guild, winnerId, getTierForElo(winResult.newElo));
      if (loserId) await syncRoles(guild, loserId, getTierForElo(lossResult.newElo));
    } catch {}

    // Post ELO update to the match's private channel
    if (match.privateChannelId) {
      try {
        const ch = await client.channels.fetch(match.privateChannelId);
        const winTier = getTierForElo(winResult.newElo);
        const embed = new EmbedBuilder()
          .setTitle(`${isFinal ? '🏆 Finals' : `⚔️ Round ${roundIndex + 1}`} — ELO Update`)
          .setColor(isFinal ? 0xffd700 : 0x00c853)
          .addFields(
            {
              name: `${winTier.emoji} Winner`,
              value: `<@${winnerId}>\n**+${gainAmount} ELO** → \`${winResult.newElo}\`${winResult.tierChanged ? `\n🎉 Ranked up to **${winTier.label} (Tier ${winTier.tier})**!` : ''}`,
              inline: true,
            },
            loserId ? {
              name: '💔 Loser',
              value: `<@${loserId}>\n**-${LOSS_PENALTY} ELO** → \`${lossResult.newElo}\`${lossResult.tierChanged ? `\n📉 Dropped to **${getTierForElo(lossResult.newElo).label} (Tier ${getTierForElo(lossResult.newElo).tier})**` : ''}`,
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

// ── /elorank command ──────────────────────────────────────────────────────────
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
    const nextTier = TIERS[TIERS.indexOf(tier) - 1]; // one better

    const eloToNext = nextTier ? nextTier.min - player.elo : null;
    const progressBar = buildProgressBar(player.elo, tier, nextTier);

    const embed = new EmbedBuilder()
      .setTitle(`${tier.emoji} ${target.displayName}'s Rank`)
      .setColor(tierColor(tier.tier))
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        { name: 'Tier', value: `**${tier.label} (Tier ${tier.tier})**`, inline: true },
        { name: 'ELO',  value: `\`${player.elo}\``, inline: true },
        { name: 'Record', value: `${player.wins}W / ${player.losses}L`, inline: true },
        { name: 'Progress', value: progressBar + (eloToNext ? `\n\`${eloToNext} ELO\` to **${nextTier.label}**` : '\n👑 **Max Tier!**'), inline: false },
      )
      .setFooter({ text: 'Tier I = Diamond (top) · Tier V = Bronze (start)' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};

// ── /eloleaderboard command ───────────────────────────────────────────────────
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

    if (!sorted.length) {
      return interaction.reply({ content: 'No ELO data yet. Play some matches!', ephemeral: true });
    }

    const guild = interaction.guild;
    const lines = [];
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      const tier = getTierForElo(p.elo);
      let name = `<@${p.userId}>`;
      try {
        const mem = await guild.members.fetch(p.userId);
        name = mem.displayName;
      } catch {}
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
      lines.push(`${medal} ${tier.emoji} **${name}** — \`${p.elo} ELO\` (${p.wins}W/${p.losses}L)`);
    }

    const embed = new EmbedBuilder()
      .setTitle('🏆 ELO Leaderboard')
      .setColor(0xffd700)
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Earn ELO by winning tournament matches' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};

// ── /eloresetplayer command (admin only) ─────────────────────────────────────
const eloResetPlayerCommand = {
  data: new SlashCommandBuilder()
    .setName('eloresetplayer')
    .setDescription('Reset a player\'s ELO to starting value (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('Player to reset').setRequired(true)),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }
    const target = interaction.options.getUser('user');
    const data = db.get();
    const eloData = getEloData(data);
    eloData[target.id] = { elo: STARTING_ELO, wins: 0, losses: 0, matchHistory: [] };
    db.set(data);

    // Sync roles back to Tier V
    try {
      const guild = await interaction.client.guilds.fetch(interaction.guildId);
      await syncRoles(guild, target.id, getTierForElo(STARTING_ELO));
    } catch {}

    await interaction.reply({ content: `✅ Reset <@${target.id}>'s ELO to \`${STARTING_ELO}\` (Tier V Bronze).`, ephemeral: true });
  }
};

// ── /eloadjust command (admin only) ──────────────────────────────────────────
const eloAdjustCommand = {
  data: new SlashCommandBuilder()
    .setName('eloadjust')
    .setDescription('Manually adjust a player\'s ELO (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('Player').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount to add (use negative to subtract)').setRequired(true)),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }
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
    await interaction.reply({
      content: `✅ Adjusted <@${target.id}>'s ELO by **${sign}${amount}**: \`${result.oldElo}\` → \`${result.newElo}\``,
      ephemeral: true,
    });
  }
};

// ── UI helpers ────────────────────────────────────────────────────────────────
function buildProgressBar(elo, tier, nextTier) {
  const barLen = 12;
  if (!nextTier) return '█'.repeat(barLen) + ' MAX';
  const range = nextTier.min - tier.min;
  const progress = elo - tier.min;
  const filled = Math.round((progress / range) * barLen);
  return '█'.repeat(filled) + '░'.repeat(barLen - filled) + ` ${progress}/${range}`;
}

function tierColor(tier) {
  return { I: 0x00bfff, II: 0xab47bc, III: 0xffd700, IV: 0xb0bec5, V: 0xcd7f32 }[tier] || 0x7289da;
}

module.exports = {
  // Slash commands
  eloRankCommand,
  eloLeaderboardCommand,
  eloResetPlayerCommand,
  eloAdjustCommand,
  // Logic used by index.js
  applyMatchElo,
  getTierForElo,
  syncRoles,
  STARTING_ELO,
  TIERS,
};
