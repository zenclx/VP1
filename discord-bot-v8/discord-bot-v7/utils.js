const { EmbedBuilder } = require('discord.js');

const MEDAL = { 0: '🥇', 1: '🥈', 2: '🥉' };
const DARK_BLUE = 0x1a2a6c;

/**
 * Build the scoreboard embed from a scoreboard object.
 */
function buildScoreboardEmbed(scoreboard) {
  const sorted = Object.entries(scoreboard.scores || {})
    .sort(([, a], [, b]) => b - a);

  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${scoreboard.name}`)
    .setColor(DARK_BLUE)
    .setTimestamp()
    .setFooter({ text: 'Live Scoreboard • Last updated' });

  if (sorted.length === 0) {
    embed.setDescription('*No scores yet. Use `/addwin` to record a win!*');
    return embed;
  }

  const lines = sorted.map(([userId, wins], i) => {
    const medal = MEDAL[i] || `**#${i + 1}**`;
    const tag = `<@${userId}>`;
    const winsLabel = wins === 1 ? 'win' : 'wins';
    return `${medal} ${tag} — **${wins}** ${winsLabel}`;
  });

  embed.setDescription(lines.join('\n'));
  return embed;
}

/**
 * Check if a member has any of the allowed roles for this guild.
 */
function hasPermission(member, allowedRoles) {
  if (!allowedRoles || allowedRoles.length === 0) return true; // open to all
  if (member.permissions.has('Administrator')) return true;
  return member.roles.cache.some(r => allowedRoles.includes(r.id));
}

module.exports = { buildScoreboardEmbed, hasPermission, DARK_BLUE };
