const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const { buildScoreboardEmbed, DARK_BLUE } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('newseason')
    .setDescription('Archive the current scoreboard into history and reset scores')
    .addStringOption(o =>
      o.setName('scoreboard').setDescription('Scoreboard to archive & reset').setRequired(false).setAutocomplete(true)
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
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Only administrators can start a new season.', ephemeral: true });
    }

    const data = db.get();
    const guildId = interaction.guildId;
    const sbName = interaction.options.getString('scoreboard');

    const guildBoards = Object.values(data.scoreboards || {}).filter(s => s.guildId === guildId);
    const sb = sbName
      ? guildBoards.find(s => s.name.toLowerCase() === sbName.toLowerCase())
      : guildBoards[0];

    if (!sb) return interaction.reply({ content: '❌ No scoreboard found.', ephemeral: true });

    // Archive current scores
    if (!data.seasons) data.seasons = {};
    if (!data.seasons[guildId]) data.seasons[guildId] = {};
    if (!data.seasons[guildId][sb.id]) data.seasons[guildId][sb.id] = [];

    const seasonNumber = data.seasons[guildId][sb.id].length + 1;
    data.seasons[guildId][sb.id].push({
      season: seasonNumber,
      scores: { ...sb.scores },
      archivedAt: Date.now(),
      scoreboardName: sb.name,
    });

    // Find MVP (highest scorer that season)
    const sorted = Object.entries(sb.scores).sort(([, a], [, b]) => b - a);
    const mvpId = sorted[0]?.[0];
    const mvpWins = sorted[0]?.[1];

    // Reset
    sb.scores = {};
    data.scoreboards[sb.id] = sb;
    db.set(data);

    // Update live scoreboard embed
    try {
      const ch = await interaction.client.channels.fetch(sb.channelId);
      const msg = await ch.messages.fetch(sb.messageId);
      await msg.edit({ embeds: [buildScoreboardEmbed(sb)] });
    } catch {}

    const embed = new EmbedBuilder()
      .setTitle(`🗓️ Season ${seasonNumber} Archived!`)
      .setColor(DARK_BLUE)
      .setDescription(
        `**${sb.name}** — Season ${seasonNumber} has been archived and scores reset.\n\n` +
        (mvpId ? `👑 **Season MVP:** <@${mvpId}> with **${mvpWins}** win${mvpWins === 1 ? '' : 's'}` : '*No scores were recorded this season.*')
      )
      .addFields({ name: '📚 View Past Seasons', value: `Use \`/season\` to browse archived seasons.` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }
};
