const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const { buildScoreboardEmbed } = require('../utils');

const REMOVEWIN_ROLES = ['1333145733968302164', '1333145733968302162'];

function canRemoveWin(member) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.some(r => REMOVEWIN_ROLES.includes(r.id));
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
    .setName('removewin')
    .setDescription('Remove 1 win from a user on a scoreboard')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('scoreboard').setDescription('Scoreboard').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const data = db.get();
    const boards = Object.values(data.scoreboards || {}).filter(s => s.guildId === interaction.guildId);
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = boards.filter(s => s.name.toLowerCase().includes(focused)).slice(0, 25).map(s => ({ name: s.name, value: s.name }));
    await interaction.respond(choices);
  },

  async execute(interaction) {
    if (!canRemoveWin(interaction.member)) {
      return interaction.reply({ content: '❌ You do not have permission to remove wins.', ephemeral: true });
    }

    const data = db.get();
    const guildId = interaction.guildId;
    const target = interaction.options.getUser('user');
    const sbName = interaction.options.getString('scoreboard');

    const guildBoards = Object.values(data.scoreboards || {}).filter(s => s.guildId === guildId);
    const sb = sbName ? guildBoards.find(s => s.name.toLowerCase() === sbName.toLowerCase()) : guildBoards[0];

    if (!sb) return interaction.reply({ content: '❌ No scoreboard found.', ephemeral: true });

    const current = sb.scores[target.id] || 0;
    if (current === 0) return interaction.reply({ content: `⚠️ <@${target.id}> already has 0 wins.`, ephemeral: true });

    sb.scores[target.id] = current - 1;
    data.scoreboards[sb.id] = sb;
    db.set(data);

    await updateScoreboardMessage(interaction.client, sb);
    await interaction.reply({ content: `✅ Removed **1** win from <@${target.id}> on **${sb.name}**. (Total: ${sb.scores[target.id]})`, ephemeral: true });
  }
};
