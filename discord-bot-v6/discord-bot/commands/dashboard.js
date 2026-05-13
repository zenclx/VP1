const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');
const { DARK_BLUE } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('View an at-a-glance overview of everything going on'),

  async execute(interaction) {
    await interaction.deferReply();
    const data = db.get();
    const guildId = interaction.guildId;

    // ── Active matches ─────────────────────────────────────────────────
    const activeMatches = Object.values(data.matches || {})
      .filter(m => m.guildId === guildId && m.status !== 'complete');

    let matchesField = '*No active matches*';
    if (activeMatches.length > 0) {
      matchesField = activeMatches.map(m => {
        const status = m.status === 'queuing' ? '🟡 Queuing' : '🟢 In Progress';
        const link = m.privateChannelId
          ? `[#match-${m.matchNum ?? '?'}](https://discord.com/channels/${guildId}/${m.privateChannelId})`
          : `match-${m.matchNum ?? '?'}`;
        return `${status} • **${m.type.toUpperCase()}** • ${link} • ${m.queue.length} players`;
      }).join('\n');
    }

    // ── Recent results ─────────────────────────────────────────────────
    const logs = (data.matchLogs?.[guildId] || []).slice(0, 5);
    let recentField = '*No recent matches*';
    if (logs.length > 0) {
      recentField = logs.map(l => {
        const ago = Math.round((Date.now() - l.timestamp) / 60000);
        const timeLabel = ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
        return `🏆 <@${l.winner}> won **${l.type.toUpperCase()}** · ${timeLabel}`;
      }).join('\n');
    }

    // ── Top 3 scoreboard ───────────────────────────────────────────────
    const guildBoards = Object.values(data.scoreboards || {}).filter(s => s.guildId === guildId);
    let topField = '*No scoreboard data*';
    if (guildBoards.length > 0) {
      const sb = guildBoards[0];
      const sorted = Object.entries(sb.scores || {}).sort(([, a], [, b]) => b - a).slice(0, 3);
      const medals = ['🥇', '🥈', '🥉'];
      topField = sorted.length > 0
        ? sorted.map(([id, w], i) => `${medals[i]} <@${id}> — **${w}** win${w === 1 ? '' : 's'}`).join('\n')
        : '*No scores yet*';
      if (guildBoards.length > 1) topField += `\n*Showing: ${sb.name}*`;
    }

    // ── Next scheduled match ───────────────────────────────────────────
    const scheduled = Object.values(data.scheduledMatches || {})
      .filter(s => s.guildId === guildId && s.openAt > Date.now())
      .sort((a, b) => a.openAt - b.openAt);

    let scheduledField = '*No scheduled matches*';
    if (scheduled.length > 0) {
      const next = scheduled[0];
      const unixTs = Math.floor(next.openAt / 1000);
      scheduledField = `**${next.type.toUpperCase()}** opens <t:${unixTs}:R> (<t:${unixTs}:t>)` +
        (next.prize ? `\n🎁 Prize: ${next.prize}` : '');
    }

    const embed = new EmbedBuilder()
      .setTitle('📊 Server Dashboard')
      .setColor(DARK_BLUE)
      .addFields(
        { name: '⚔️ Active Matches', value: matchesField, inline: false },
        { name: '📋 Recent Results', value: recentField, inline: false },
        { name: '🏆 Top 3 — Scoreboard', value: topField, inline: true },
        { name: '📅 Next Scheduled Match', value: scheduledField, inline: true },
      )
      .setTimestamp()
      .setFooter({ text: 'Dashboard • Updates on command' });

    return interaction.editReply({ embeds: [embed] });
  }
};
