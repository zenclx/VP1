const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('spectate')
    .setDescription('Get read-only access to a match channel as a spectator')
    .addStringOption(o =>
      o.setName('matchid').setDescription('Match ID to spectate (shown in bracket footer)').setRequired(true)
    ),

  async execute(interaction) {
    const matchId = interaction.options.getString('matchid');
    const data = db.get();
    const match = data.matches?.[matchId];

    if (!match) return interaction.reply({ content: `❌ Match \`${matchId}\` not found.`, ephemeral: true });
    if (match.status === 'complete') return interaction.reply({ content: '❌ That match is already over.', ephemeral: true });
    if (!match.privateChannelId) return interaction.reply({ content: '❌ That match hasn\'t started yet — no channel to spectate.', ephemeral: true });

    // Don't spectate if already a participant
    if (match.queue.includes(interaction.user.id))
      return interaction.reply({ content: '⚠️ You\'re a participant in this match, not a spectator!', ephemeral: true });

    try {
      const channel = await interaction.client.channels.fetch(match.privateChannelId);
      await channel.permissionOverwrites.edit(interaction.user.id, {
        ViewChannel: true,
        SendMessages: false,
        ReadMessageHistory: true,
        AddReactions: false,
      });

      // Track spectators
      if (!match.spectators) match.spectators = [];
      if (!match.spectators.includes(interaction.user.id)) {
        match.spectators.push(interaction.user.id);
        data.matches[matchId] = match;
        db.set(data);
      }

      await channel.send({ content: `👀 **${interaction.user.displayName}** is now spectating this match.` });

      return interaction.reply({
        content: `✅ You now have read-only access to [the match channel](https://discord.com/channels/${match.guildId}/${match.privateChannelId})! You can watch but not send messages.`,
        ephemeral: true,
      });
    } catch (e) {
      console.error('Spectate error:', e.message);
      return interaction.reply({ content: '❌ Failed to grant spectator access.', ephemeral: true });
    }
  }
};
