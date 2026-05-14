const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database');
const { hasPermission } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deletescoreboard')
    .setDescription('Permanently delete a scoreboard')
    .addStringOption(o => o.setName('scoreboard').setDescription('Scoreboard name').setRequired(true)),

  async execute(interaction) {
    const data = db.get();
    const guildId = interaction.guildId;
    const settings = data.settings[guildId] || {};
    if (!hasPermission(interaction.member, settings.allowedRoles || [])) {
      return interaction.reply({ content: '❌ No permission.', ephemeral: true });
    }

    const sbName = interaction.options.getString('scoreboard');
    const sb = Object.values(data.scoreboards || {}).find(
      s => s.guildId === guildId && s.name.toLowerCase() === sbName.toLowerCase()
    );

    if (!sb) return interaction.reply({ content: '❌ Scoreboard not found.', ephemeral: true });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`delete_confirm_${sb.id}`).setLabel('Yes, delete it').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('delete_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      content: `🗑️ Are you sure you want to permanently delete **${sb.name}**?`,
      components: [row],
      ephemeral: true
    });
  }
};
