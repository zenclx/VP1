const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');
const { DARK_BLUE } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('View everything at a glance: active matches, recent results, top scores, and scheduled matches'),

  async execute(interaction) {
    await interaction.deferReply();
    const data = db.get();
    const guildId = interaction.guildId;

    // Active matches
    const activeMatches = Object.values(data.matches || {}).filter(m => m.guildId === guildId && m.status !== 'complete');
    const activeLines = activeMatches.length
      ? activeMatches.map(m => {
          const statusLabel = m.status === 'queuing' ? `⏳ Queuing (${m.queue.length} players)` : `⚔️ Bracket Round ${(m.currentRound ?? 0) + 1}`;
          return `**Match #${m.matchNum ?? '?'}** (${m.type.toUpperCase()}) — ${statusLabel}${m.privateChannelId ? ` | <#${m.privateChannelId}>` : ''}`;
        })
      : ['*No active matches*'];

    // Recent results (last 5)
    const logs = (data.matchLogs?.[guildId] || []).slice(0, 5);
    const recentLines = logs.length
      ? logs.map(l => {
          const ts = `<t:${Math.floor(l.timestamp / 1000)}:R>`;
          return `${ts} **Match #${l.matchNum ?? '?'}** (${l.type}) — 🏆 <@${l.winner}>${l.prize ? ` 🎁 ${l.prize}` : ''}`;
        })
      : ['*No recent matches*'];

    // Top 3 from first scoreboard
    const boards = Object.values(data.scoreboards || {}).filter(s => s.guildId === guildId);
    let topLines = ['*No scoreboards*'];
    let sbTitle = '';
    if (boards.length) {
      const sb = boards[0];
      sbTitle = ` — ${sb.name}`;
      const sorted = Object.entries(sb.scores || {}).sort(([, a], [, b]) => b - a).slice(0, 3);
      topLines = sorted.length
        ? sorted.map(([id, w], i) => `${['🥇','🥈','🥉'][i]} <@${id}> — **${w}** win${w === 1 ? '' : 's'}`)
        : ['*No scores yet*'];
    }

    // Scheduled matches
    const scheduled = Object.values(data.scheduledMatches || {}).filter(
      s => s.guildId === guildId && s.startsAt > Date.now()
    ).sort((a, b) => a.startsAt - b.startsAt).slice(0, 3);
    const scheduledLines = scheduled.length
      ? scheduled.map(s => `📅 **${s.type.toUpperCase()}** — <t:${Math.floor(s.startsAt / 1000)}:F>`)
      : ['*No scheduled matches*'];

    const embed = new EmbedBuilder()
      .setTitle('📊 Server Dashboard')
      .setColor(DARK_BLUE)
      .addFields(
        { name: `⚔️ Active Matches (${activeMatches.length})`, value: activeLines.join('\n'), inline: false },
        { name: '📋 Recent Results', value: recentLines.join('\n'), inline: false },
        { name: `🏆 Top Scores${sbTitle}`, value: topLines.join('\n'), inline: true },
        { name: '📅 Upcoming Scheduled', value: scheduledLines.join('\n'), inline: true },
      )
      .setTimestamp()
      .setFooter({ text: 'Dashboard • Live data' });

    await interaction.editReply({ embeds: [embed] });
  },
};
