const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setlogchannel')
    .setDescription('Set the channel where match results are logged')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName('channel').setDescription('Log channel').setRequired(true)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    const data = db.get();
    if (!data.settings) data.settings = {};
    if (!data.settings[interaction.guildId]) data.settings[interaction.guildId] = {};
    data.settings[interaction.guildId].logChannelId = channel.id;
    db.set(data);
    await interaction.reply({ content: `✅ Match results will be logged to <#${channel.id}>`, ephemeral: true });
  }
};
