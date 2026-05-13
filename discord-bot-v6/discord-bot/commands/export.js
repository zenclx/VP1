const { SlashCommandBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('export')
    .setDescription('Export the full scoreboard and match history as a CSV (admin only)'),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Only administrators can export data.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const data = db.get();
    const guildId = interaction.guildId;

    // ── Scoreboard CSV ─────────────────────────────────────────────────
    const guildBoards = Object.values(data.scoreboards || {}).filter(s => s.guildId === guildId);
    let scoreboardCsv = 'Scoreboard,UserID,Wins\n';
    for (const sb of guildBoards) {
      const sorted = Object.entries(sb.scores || {}).sort(([, a], [, b]) => b - a);
      for (const [userId, wins] of sorted) {
        scoreboardCsv += `"${sb.name}",${userId},${wins}\n`;
      }
    }

    // ── Match history CSV ──────────────────────────────────────────────
    const logs = data.matchLogs?.[guildId] || [];
    let matchCsv = 'MatchID,MatchNum,Type,WinnerID,Opponents,Prize,Scoreboard,Timestamp\n';
    for (const log of logs) {
      const opponents = (log.opponents || []).join(';');
      const ts = new Date(log.timestamp).toISOString();
      matchCsv += `${log.matchId},${log.matchNum},${log.type},${log.winner},"${opponents}","${log.prize || ''}","${log.scoreboard || ''}",${ts}\n`;
    }

    // ── Season history CSV ─────────────────────────────────────────────
    let seasonCsv = 'Scoreboard,Season,UserID,Wins,ArchivedAt\n';
    for (const sb of guildBoards) {
      const seasons = data.seasons?.[guildId]?.[sb.id] || [];
      for (const season of seasons) {
        const sorted = Object.entries(season.scores || {}).sort(([, a], [, b]) => b - a);
        for (const [userId, wins] of sorted) {
          const ts = new Date(season.archivedAt).toISOString();
          seasonCsv += `"${sb.name}",${season.season},${userId},${wins},${ts}\n`;
        }
      }
    }

    const combined = `===== SCOREBOARD =====\n${scoreboardCsv}\n===== MATCH HISTORY =====\n${matchCsv}\n===== SEASON HISTORY =====\n${seasonCsv}`;
    const buffer = Buffer.from(combined, 'utf8');
    const filename = `export-${guildId}-${Date.now()}.csv`;
    const attachment = new AttachmentBuilder(buffer, { name: filename });

    return interaction.editReply({
      content: `✅ Here's your export — **${logs.length}** match logs, **${guildBoards.length}** scoreboards.`,
      files: [attachment],
    });
  }
};
