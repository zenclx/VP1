const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const { buildScoreboardEmbed } = require('../utils');
const { checkAchievements } = require('./achievements');

const ADDWIN_ROLES = ['1333145733968302164', '1333145733968302162'];

function canAddWin(member) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.some(r => ADDWIN_ROLES.includes(r.id));
}

async function updateScoreboardMessage(client, sb) {
  try {
    const channel = await client.channels.fetch(sb.channelId);
    const msg = await channel.messages.fetch(sb.messageId);
    await msg.edit({ embeds: [buildScoreboardEmbed(sb)] });
  } catch (e) { console.error('Failed to update scoreboard:', e.message); }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addwin')
    .setDescription('Add 1 win to a user on a scoreboard')
    .addUserOption(o => o.setName('user').setDescription('User to add win to').setRequired(true))
    .addStringOption(o => o.setName('scoreboard').setDescription('Scoreboard').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const data = db.get();
    const boards = Object.values(data.scoreboards || {}).filter(s => s.guildId === interaction.guildId);
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = boards.filter(s => s.name.toLowerCase().includes(focused)).slice(0, 25).map(s => ({ name: s.name, value: s.name }));
    await interaction.respond(choices);
  },

  async execute(interaction) {
    if (!canAddWin(interaction.member)) {
      return interaction.reply({ content: '❌ You do not have permission to add wins.', ephemeral: true });
    }

    const data = db.get();
    const guildId = interaction.guildId;
    const target = interaction.options.getUser('user');
    const sbName = interaction.options.getString('scoreboard');

    const guildBoards = Object.values(data.scoreboards || {}).filter(s => s.guildId === guildId);
    const sb = sbName ? guildBoards.find(s => s.name.toLowerCase() === sbName.toLowerCase()) : guildBoards[0];

    if (!sb) return interaction.reply({ content: '❌ No scoreboard found.', ephemeral: true });

    sb.scores[target.id] = (sb.scores[target.id] || 0) + 1;
    data.scoreboards[sb.id] = sb;
    db.set(data);

    await updateScoreboardMessage(interaction.client, sb);

    // Check achievements for the winner
    try {
      const guild = await interaction.client.guilds.fetch(guildId);
      const newAchs = await checkAchievements(interaction.client, guild, target.id, data);
      if (newAchs.length) {
        const { ACHIEVEMENTS } = require('./achievements');
        const earned = newAchs.map(id => ACHIEVEMENTS.find(a => a.id === id)).filter(Boolean);
        await interaction.channel.send(`🏅 <@${target.id}> earned: ${earned.map(a => `${a.emoji} **${a.name}**`).join(', ')}!`);
      }
    } catch {}

    await interaction.reply({ content: `✅ Added **1** win to <@${target.id}> on **${sb.name}**! (Total: ${sb.scores[target.id]})`, ephemeral: true });
  }
};
