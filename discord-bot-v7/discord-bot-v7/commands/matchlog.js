const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');
const { DARK_BLUE } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('matchlog')
    .setDescription('View recent match results')
    .addIntegerOption(o => o.setName('count').setDescription('How many to show (default 10, max 25)').setMinValue(1).setMaxValue(25).setRequired(false)),

  async execute(interaction) {
    const data = db.get();
    const guildId = interaction.guildId;
    const logs = (data.matchLogs || {})[guildId] || [];
    const count = interaction.options.getInteger('count') || 10;
    const recent = logs.slice(0, count);

    if (recent.length === 0) {
      return interaction.reply({ content: '📋 No match history yet.', flags: 64 });
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 Match Log')
      .setColor(DARK_BLUE)
      .setTimestamp();

    const lines = recent.map(log => {
      const date = `<t:${Math.floor(log.timestamp / 1000)}:d>`;
      const prize = log.prize ? ` 🎁 *${log.prize}*` : '';
      const num = log.matchNum !== undefined ? `Match #${log.matchNum}` : 'Match';
      return `**${num}** [${log.type.toUpperCase()}] 🏆 <@${log.winner}>${prize} — ${date}`;
    });

    embed.setDescription(lines.join('\n'));
    await interaction.reply({ embeds: [embed] });
  }
};
