const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');
const { DARK_BLUE } = require('../utils');

const MEDAL = { 0: '🥇', 1: '🥈', 2: '🥉' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('season')
    .setDescription('View a past season\'s scoreboard')
    .addIntegerOption(o =>
      o.setName('number').setDescription('Season number to view (e.g. 1, 2, 3...)').setRequired(true).setMinValue(1)
    )
    .addStringOption(o =>
      o.setName('scoreboard').setDescription('Which scoreboard\'s history to view').setRequired(false).setAutocomplete(true)
    ),

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

    const guildBoards = Object.values(data.scoreboards || {}).filter(s => s.guildId === guildId);
    const sb = sbName
      ? guildBoards.find(s => s.name.toLowerCase() === sbName.toLowerCase())
      : guildBoards[0];

    if (!sb) return interaction.reply({ content: '❌ No scoreboard found.', ephemeral: true });

    const seasons = data.seasons?.[guildId]?.[sb.id];
    if (!seasons || seasons.length === 0)
      return interaction.reply({ content: `❌ No archived seasons for **${sb.name}** yet.`, ephemeral: true });

    const season = seasons.find(s => s.season === seasonNum);
    if (!season)
      return interaction.reply({ content: `❌ Season **${seasonNum}** not found. Latest is Season **${seasons.length}**.`, ephemeral: true });

    const sorted = Object.entries(season.scores).sort(([, a], [, b]) => b - a);
    const lines = sorted.length === 0
      ? ['*No scores recorded*']
      : sorted.map(([userId, wins], i) => {
          const medal = MEDAL[i] || `**#${i + 1}**`;
          return `${medal} <@${userId}> — **${wins}** win${wins === 1 ? '' : 's'}`;
        });

    const archivedDate = new Date(season.archivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    const embed = new EmbedBuilder()
      .setTitle(`📚 ${season.scoreboardName} — Season ${seasonNum}`)
      .setColor(DARK_BLUE)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Archived on ${archivedDate} • ${seasons.length} season${seasons.length === 1 ? '' : 's'} total` })
      .setTimestamp(season.archivedAt);

    return interaction.reply({ embeds: [embed] });
  }
};
