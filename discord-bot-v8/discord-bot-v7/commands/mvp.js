const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const { DARK_BLUE } = require('../utils');

/**
 * MVP Formula:
 * For each player, compute "opponent quality" score.
 * Each win against a higher-ranked player is worth more.
 * Score = sum of (loser's rank position inverted, higher rank = more points)
 * We use scoreboard rank as proxy for "strength".
 */
function calculateMVP(matchLogs, scores) {
  const ranked = Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .map(([id], i) => ({ id, rank: i + 1 }));
  const rankMap = Object.fromEntries(ranked.map(r => [r.id, r.rank]));
  const totalPlayers = ranked.length;

  const mvpScores = {};

  for (const log of matchLogs) {
    const winner = log.winner;
    const loserRank = rankMap[log.opponents?.[0]];
    if (!winner || !loserRank) continue;
    // Higher loser rank = easier opponent = less MVP points
    // Lower rank # = better opponent (rank 1 is best)
    const quality = totalPlayers - loserRank + 1; // rank 1 gives max points
    mvpScores[winner] = (mvpScores[winner] || 0) + quality;
  }

  const sorted = Object.entries(mvpScores).sort(([, a], [, b]) => b - a);
  return sorted[0]?.[0] ?? null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mvp')
    .setDescription('Calculate and announce the MVP of the most recent tournament')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('scoreboard').setDescription('Scoreboard to base rankings on').setRequired(false).setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const data = db.get();
    const boards = Object.values(data.scoreboards || {}).filter(s => s.guildId === interaction.guildId);
    const focused = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      boards.filter(s => s.name.toLowerCase().includes(focused)).slice(0, 25).map(s => ({ name: s.name, value: s.name }))
    );
  },

  async execute(interaction) {
    await interaction.deferReply();
    const data = db.get();
    const guildId = interaction.guildId;
    const sbName = interaction.options.getString('scoreboard');

    const boards = Object.values(data.scoreboards || {}).filter(s => s.guildId === guildId);
    const sb = sbName ? boards.find(s => s.name.toLowerCase() === sbName.toLowerCase()) : boards[0];

    if (!sb) return interaction.editReply({ content: '❌ No scoreboard found.' });

    const logs = (data.matchLogs?.[guildId] || []).filter(l => l.scoreboard?.toLowerCase() === sb.name.toLowerCase());

    if (!logs.length) return interaction.editReply({ content: '❌ No match history found for that scoreboard.' });

    const mvpId = calculateMVP(logs, sb.scores);
    if (!mvpId) return interaction.editReply({ content: '❌ Not enough data to calculate MVP.' });

    // Build win breakdown
    const wins = logs.filter(l => l.winner === mvpId);
    const ranked = Object.entries(sb.scores).sort(([, a], [, b]) => b - a);
    const rankMap = Object.fromEntries(ranked.map(([id], i) => [id, i + 1]));

    const embed = new EmbedBuilder()
      .setTitle('🌟 Most Valuable Player')
      .setColor(0xffd700)
      .setDescription(`👑 **<@${mvpId}>** is the MVP of this tournament!\n\nThey defeated the highest-ranked opponents, showing dominant performance across all rounds.`)
      .addFields(
        { name: '🏆 Wins', value: `${wins.length}`, inline: true },
        { name: '📊 Current Rank', value: rankMap[mvpId] ? `#${rankMap[mvpId]} on ${sb.name}` : 'Unranked', inline: true },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
