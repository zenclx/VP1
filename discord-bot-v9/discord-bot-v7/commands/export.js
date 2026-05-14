const { SlashCommandBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('export')
    .setDescription('Export scoreboard and match history as CSV (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
      o.setName('type')
        .setDescription('What to export')
        .setRequired(true)
        .addChoices(
          { name: 'Scoreboard', value: 'scoreboard' },
          { name: 'Match History', value: 'matches' },
          { name: 'Both', value: 'both' },
        )
    )
    .addStringOption(o =>
      o.setName('scoreboard').setDescription('Scoreboard name (blank = all)').setRequired(false).setAutocomplete(true)
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
    await interaction.deferReply({ ephemeral: true });
    const data = db.get();
    const guildId = interaction.guildId;
    const type = interaction.options.getString('type');
    const sbName = interaction.options.getString('scoreboard');

    const files = [];

    if (type === 'scoreboard' || type === 'both') {
      const boards = Object.values(data.scoreboards || {}).filter(s => s.guildId === guildId);
      const filtered = sbName
        ? boards.filter(s => s.name.toLowerCase() === sbName.toLowerCase())
        : boards;

      let csv = 'Scoreboard,UserID,Wins\n';
      for (const sb of filtered) {
        const sorted = Object.entries(sb.scores || {}).sort(([, a], [, b]) => b - a);
        for (const [userId, wins] of sorted) {
          csv += `"${sb.name.replace(/"/g, '""')}",${userId},${wins}\n`;
        }
      }
      files.push(new AttachmentBuilder(Buffer.from(csv), { name: 'scoreboard.csv' }));
    }

    if (type === 'matches' || type === 'both') {
      const logs = data.matchLogs?.[guildId] || [];
      let csv = 'MatchID,MatchNum,Type,WinnerID,LoserIDs,Prize,Scoreboard,Timestamp\n';
      for (const log of logs) {
        const losers = (log.opponents || []).join(';');
        const ts = new Date(log.timestamp).toISOString();
        csv += `${log.matchId},${log.matchNum ?? ''},${log.type},"${log.winner}","${losers}","${log.prize ?? ''}","${log.scoreboard ?? ''}",${ts}\n`;
      }
      files.push(new AttachmentBuilder(Buffer.from(csv), { name: 'match_history.csv' }));
    }

    if (files.length === 0) return interaction.editReply({ content: '❌ No data to export.' });

    await interaction.editReply({ content: `✅ Here's your export (${new Date().toLocaleDateString()}):`, files });
  },
};
