const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('enablepredictions')
    .setDescription('Toggle prediction voting on/off for matches (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const data = db.get();
    if (!data.settings) data.settings = {};
    if (!data.settings[interaction.guildId]) data.settings[interaction.guildId] = {};
    const current = data.settings[interaction.guildId].predictionsEnabled || false;
    data.settings[interaction.guildId].predictionsEnabled = !current;
    db.set(data);
    const state = !current ? '✅ **Enabled**' : '❌ **Disabled**';
    await interaction.reply({ content: `🎯 Match predictions are now ${state}.\nWhen enabled, a prediction vote appears in the match channel before each matchup.`, flags: 64 });
  }
};
