const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');
const { DARK_BLUE } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listscoreboards')
    .setDescription('List all scoreboards in this server'),

  async execute(interaction) {
    const data = db.get();
    const boards = Object.values(data.scoreboards || {}).filter(s => s.guildId === interaction.guildId);

    if (boards.length === 0) {
      return interaction.reply({ content: 'No scoreboards exist yet. Use `/scoreboard` to create one.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 Scoreboards')
      .setColor(DARK_BLUE)
      .setDescription(boards.map(sb => {
        const count = Object.keys(sb.scores).length;
        return `**${sb.name}** — ${count} player(s) — <#${sb.channelId}>`;
      }).join('\n'));

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
