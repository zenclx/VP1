const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const { DARK_BLUE } = require('../utils');

const ACHIEVEMENTS = [
  { id: 'first_win',        name: 'First Blood',        emoji: '🩸', description: 'First ever win',         roleName: '🩸 First Blood'        },
  { id: 'wins_10',          name: 'Veteran',             emoji: '🎖️', description: '10 total wins',          roleName: '🎖️ Veteran'            },
  { id: 'wins_25',          name: 'Elite',               emoji: '💎', description: '25 total wins',          roleName: '💎 Elite'               },
  { id: 'wins_50',          name: 'Legend',              emoji: '🔱', description: '50 total wins',          roleName: '🔱 Legend'              },
  { id: 'streak_5',         name: 'On Fire',             emoji: '🔥', description: '5-win streak',           roleName: '🔥 On Fire'             },
  { id: 'tournament_champ', name: 'Tournament Champion', emoji: '🏆', description: 'Won a tournament',       roleName: '🏆 Tournament Champion' },
];

async function checkAchievements(client, guild, userId, data) {
  const guildId = guild.id;
  if (!data.achievements) data.achievements = {};
  if (!data.achievements[guildId]) data.achievements[guildId] = {};
  const userAch = data.achievements[guildId][userId] || [];

  const allBoards = Object.values(data.scoreboards || {}).filter(s => s.guildId === guildId);
  const totalWins = allBoards.reduce((sum, sb) => sum + (sb.scores[userId] || 0), 0);
  const userLogs = (data.matchLogs?.[guildId] || []).filter(l => l.winner === userId);

  let streak = 0;
  for (const log of userLogs) { streak++; if (streak >= 5) break; }

  const isChamp = Object.values(data.matches || {}).some(
    m => m.guildId === guildId && m.champion === userId
  );

  const toGrant = [];
  if (totalWins >= 1  && !userAch.includes('first_win'))        toGrant.push('first_win');
  if (totalWins >= 10 && !userAch.includes('wins_10'))          toGrant.push('wins_10');
  if (totalWins >= 25 && !userAch.includes('wins_25'))          toGrant.push('wins_25');
  if (totalWins >= 50 && !userAch.includes('wins_50'))          toGrant.push('wins_50');
  if (streak >= 5     && !userAch.includes('streak_5'))         toGrant.push('streak_5');
  if (isChamp         && !userAch.includes('tournament_champ')) toGrant.push('tournament_champ');

  if (toGrant.length === 0) return [];

  for (const achId of toGrant) {
    const ach = ACHIEVEMENTS.find(a => a.id === achId);
    if (!ach) continue;
    let role = guild.roles.cache.find(r => r.name === ach.roleName);
    if (!role) {
      try {
        role = await guild.roles.create({
          name: ach.roleName,
          color: achId === 'tournament_champ' ? 0xffd700 : achId === 'streak_5' ? 0xff4500 : DARK_BLUE,
          reason: 'Auto-created achievement role',
          mentionable: false,
        });
      } catch (e) { console.error('Role create failed:', e.message); continue; }
    }
    try {
      const member = await guild.members.fetch(userId);
      await member.roles.add(role);
    } catch (e) { console.error('Role assign failed:', e.message); }
  }

  data.achievements[guildId][userId] = [...userAch, ...toGrant];
  return toGrant;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('achievements')
    .setDescription("View your or another user's earned achievement badges")
    .addUserOption(o => o.setName('user').setDescription('User to check (default: yourself)').setRequired(false)),

  async execute(interaction) {
    const data = db.get();
    const guildId = interaction.guildId;
    const target = interaction.options.getUser('user') || interaction.user;
    const earned = data.achievements?.[guildId]?.[target.id] || [];

    const lines = ACHIEVEMENTS.map(a =>
      `${earned.includes(a.id) ? a.emoji : '⬜'} **${a.name}** — ${a.description}`
    );

    const embed = new EmbedBuilder()
      .setTitle(`🏅 Achievements — ${target.username}`)
      .setColor(DARK_BLUE)
      .setDescription(lines.join('\n'))
      .addFields({ name: 'Earned', value: `${earned.length} / ${ACHIEVEMENTS.length}`, inline: true })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },

  checkAchievements,
  ACHIEVEMENTS,
};
