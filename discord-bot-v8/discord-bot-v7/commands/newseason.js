const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const { buildScoreboardEmbed, DARK_BLUE } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('newseason')
    .setDescription('Archive the current scoreboard and start a fresh season (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
      o.setName('scoreboard').setDescription('Scoreboard to archive').setRequired(true).setAutocomplete(true)
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
    const sbName = interaction.options.getString('scoreboard');

    const sb = Object.values(data.scoreboards || {}).find(
      s => s.guildId === guildId && s.name.toLowerCase() === sbName.toLowerCase()
    );
    if (!sb) return interaction.reply({ content: '❌ Scoreboard not found.', ephemeral: true });

    // Archive current season
    if (!data.seasons) data.seasons = {};
    if (!data.seasons[guildId]) data.seasons[guildId] = {};
    if (!data.seasons[guildId][sb.id]) data.seasons[guildId][sb.id] = [];

    const seasonNumber = data.seasons[guildId][sb.id].length + 1;
    const sorted = Object.entries(sb.scores || {}).sort(([, a], [, b]) => b - a);

    data.seasons[guildId][sb.id].push({
      season: seasonNumber,
      scores: { ...sb.scores },
      archivedAt: Date.now(),
      champion: sorted[0]?.[0] ?? null,
    });

    // Reset scores
    sb.scores = {};
    data.scoreboards[sb.id] = sb;
    db.set(data);

    // Update live scoreboard message
    try {
      const ch = await interaction.client.channels.fetch(sb.channelId);
      const msg = await ch.messages.fetch(sb.messageId);
      await msg.edit({ embeds: [buildScoreboardEmbed(sb)] });
    } catch {}

    const embed = new EmbedBuilder()
      .setTitle(`📦 Season ${seasonNumber} Archived!`)
      .setColor(DARK_BLUE)
      .setDescription(
        sorted.length
          ? `**Top players this season:**\n${sorted.slice(0, 5).map(([id, w], i) => `${['🥇','🥈','🥉'][i] ?? `#${i+1}`} <@${id}> — **${w}** wins`).join('\n')}\n\n✅ Scoreboard reset for Season ${seasonNumber + 1}!`
          : `No scores this season. Scoreboard reset for Season ${seasonNumber + 1}!`
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
