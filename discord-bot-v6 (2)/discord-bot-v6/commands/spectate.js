const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('spectate')
    .setDescription('Get read-only access to watch a live match channel')
    .addStringOption(o =>
      o.setName('matchid').setDescription('Match ID (found in the bracket embed footer)').setRequired(true)
    ),

  async execute(interaction) {
    const matchId = interaction.options.getString('matchid');
    const data = db.get();
    const match = data.matches?.[matchId];

    if (!match) return interaction.reply({ content: '❌ Match not found.', ephemeral: true });
    if (match.status === 'complete') return interaction.reply({ content: '❌ That match is already over.', ephemeral: true });
    if (!match.privateChannelId) return interaction.reply({ content: '❌ Match channel not set up yet — try again after the queue fills.', ephemeral: true });

    // Don't give spectate to actual participants
    if (match.queue.includes(interaction.user.id))
      return interaction.reply({ content: '⚠️ You are a participant in that match!', ephemeral: true });

    try {
      const ch = await interaction.client.channels.fetch(match.privateChannelId);
      await ch.permissionOverwrites.create(interaction.user.id, {
        ViewChannel: true,
        SendMessages: false,
        ReadMessageHistory: true,
      });
      await interaction.reply({ content: `👁️ You can now spectate **#${ch.name}**! You have read-only access.`, ephemeral: true });
    } catch (e) {
      console.error('spectate error:', e.message);
      await interaction.reply({ content: '❌ Failed to grant spectator access. Does the match channel still exist?', ephemeral: true });
    }
  },
};
