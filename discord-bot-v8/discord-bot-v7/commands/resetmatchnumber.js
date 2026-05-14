const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resetmatchnumber')
    .setDescription('Reset the match counter back to 0 (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const data = db.get();
    if (!data.matchCounters) data.matchCounters = {};
    data.matchCounters[interaction.guildId] = -1;
    db.set(data);
    await interaction.reply({ content: '✅ Match counter reset. Next match will be **#0**.', flags: 64 });
  }
};
