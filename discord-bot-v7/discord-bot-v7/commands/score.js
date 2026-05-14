const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');
const { DARK_BLUE } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('score')
    .setDescription('Get a user\'s score on a scoreboard')
    .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(true))
    .addStringOption(o => o.setName('scoreboard').setDescription('Scoreboard name (blank = all)').setRequired(false)),

  async execute(interaction) {
    const data = db.get();
    const guildId = interaction.guildId;
    const target = interaction.options.getUser('user');
    const sbName = interaction.options.getString('scoreboard');

    const guildBoards = Object.values(data.scoreboards || {}).filter(s => s.guildId === guildId);
    const boards = sbName
      ? guildBoards.filter(s => s.name.toLowerCase() === sbName.toLowerCase())
      : guildBoards;

    if (boards.length === 0) {
      return interaction.reply({ content: '❌ No scoreboards found.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle(`📊 Score Report — <@${target.id}>`)
      .setColor(DARK_BLUE)
      .setTimestamp();

    const lines = boards.map(sb => {
      const wins = sb.scores[target.id] || 0;
      const rank = Object.entries(sb.scores)
        .sort(([, a], [, b]) => b - a)
        .findIndex(([id]) => id === target.id);
      const rankStr = rank === -1 ? 'Unranked' : `#${rank + 1}`;
      return `**${sb.name}** — ${wins} win(s) (${rankStr})`;
    });

    embed.setDescription(lines.join('\n'));
    await interaction.reply({ embeds: [embed] });
  }
};
