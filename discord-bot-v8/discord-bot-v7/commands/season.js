const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');
const { DARK_BLUE } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('season')
    .setDescription('View results from a past season')
    .addIntegerOption(o => o.setName('number').setDescription('Season number').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('scoreboard').setDescription('Scoreboard name').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const data = db.get();
    const boards = Object.values(data.scoreboards || {}).filter(s => s.guildId === interaction.guildId);
    const focused = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      boards.filter(s => s.name.toLowerCase().includes(focused)).slice(0, 25).map(s => ({ name: s.name, value: s.name }))
    );
  },

  async execute(interaction) {
    const data = db.get();
    const guildId = interaction.guildId;
    const seasonNum = interaction.options.getInteger('number');
    const sbName = interaction.options.getString('scoreboard');

    // Find scoreboard
    const boards = Object.values(data.scoreboards || {}).filter(s => s.guildId === guildId);
    const sb = sbName
      ? boards.find(s => s.name.toLowerCase() === sbName.toLowerCase())
      : boards[0];

    if (!sb) return interaction.reply({ content: '❌ No scoreboard found.', ephemeral: true });

    const history = data.seasons?.[guildId]?.[sb.id];
    if (!history || history.length === 0)
      return interaction.reply({ content: `❌ No archived seasons found for **${sb.name}**.`, ephemeral: true });

    const season = history.find(s => s.season === seasonNum);
    if (!season)
      return interaction.reply({ content: `❌ Season **${seasonNum}** not found. Available: 1–${history.length}`, ephemeral: true });

    const sorted = Object.entries(season.scores || {}).sort(([, a], [, b]) => b - a);
    const lines = sorted.length
      ? sorted.map(([id, w], i) => `${['🥇','🥈','🥉'][i] ?? `**#${i+1}**`} <@${id}> — **${w}** win${w === 1 ? '' : 's'}`)
      : ['*No scores recorded this season.*'];

    const embed = new EmbedBuilder()
      .setTitle(`📜 Season ${seasonNum} — ${sb.name}`)
      .setColor(DARK_BLUE)
      .setDescription(lines.join('\n'))
      .addFields({ name: '🗓️ Archived', value: `<t:${Math.floor(season.archivedAt / 1000)}:D>`, inline: true })
      .setTimestamp();

    if (season.champion) {
      embed.addFields({ name: '👑 Champion', value: `<@${season.champion}>`, inline: true });
    }

    await interaction.reply({ embeds: [embed] });
  },
};
