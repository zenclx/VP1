const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');
const { buildScoreboardEmbed, hasPermission, DARK_BLUE } = require('../utils');
const { buildBracketEmbed, buildBracketComponents } = require('./creatematch');
const { applyMatchElo } = require('./elo');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pickwinner')
    .setDescription('Manually declare a winner for the current match round')
    .addStringOption(o =>
      o.setName('matchid')
        .setDescription('Match ID (shown in the bracket embed footer)')
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('match_number')
        .setDescription('Which match slot in the current round (1, 2, 3...)')
        .setRequired(true)
        .setMinValue(1)
    )
    .addUserOption(o =>
      o.setName('winner')
        .setDescription('The user who won this match')
        .setRequired(true)
    ),

  async execute(interaction) {
    const data = db.get();
    const guildId = interaction.guildId;
    const settings = data.settings[guildId] || {};

    if (!hasPermission(interaction.member, settings.allowedRoles || [])) {
      return interaction.reply({ content: '❌ You do not have permission to pick winners.', ephemeral: true });
    }

    const matchId = interaction.options.getString('matchid');
    const matchNumber = interaction.options.getInteger('match_number') - 1; // 0-indexed
    const winnerUser = interaction.options.getUser('winner');

    const match = data.matches[matchId];
    if (!match) {
      return interaction.reply({ content: `❌ Match \`${matchId}\` not found. Check the ID in the bracket embed footer.`, ephemeral: true });
    }
    if (match.status !== 'bracket') {
      return interaction.reply({ content: '❌ This match is not in bracket stage yet.', ephemeral: true });
    }

    const round = match.currentRound;
    const bracketMatch = match.bracket[round]?.[matchNumber];
    if (!bracketMatch) {
      return interaction.reply({ content: `❌ Match slot ${matchNumber + 1} not found in round ${round + 1}.`, ephemeral: true });
    }
    if (bracketMatch.winner) {
      return interaction.reply({ content: `⚠️ A winner is already recorded for match ${matchNumber + 1}.`, ephemeral: true });
    }

    // Validate the winner is actually a participant in this slot
    const validPlayers = [bracketMatch.p1, bracketMatch.p2].filter(Boolean);
    if (!validPlayers.includes(winnerUser.id)) {
      return interaction.reply({
        content: `❌ <@${winnerUser.id}> is not a participant in match ${matchNumber + 1}. Valid players: ${validPlayers.map(id => `<@${id}>`).join(', ')}`,
        ephemeral: true
      });
    }

    bracketMatch.winner = winnerUser.id;

    // Credit win to scoreboard
    if (match.scoreboardName) {
      const sb = Object.values(data.scoreboards || {}).find(
        s => s.guildId === guildId && s.name.toLowerCase() === match.scoreboardName.toLowerCase()
      );
      if (sb) {
        sb.scores[winnerUser.id] = (sb.scores[winnerUser.id] || 0) + 1;
        data.scoreboards[sb.id] = sb;
        try {
          const ch = await interaction.client.channels.fetch(sb.channelId);
          const msg = await ch.messages.fetch(sb.messageId);
          await msg.edit({ embeds: [buildScoreboardEmbed(sb)] });
        } catch {}
      }
    }

    // Check if round is complete
    const roundComplete = match.bracket[round].every(m => m.winner !== null);
    if (roundComplete) {
      const winners = match.bracket[round].filter(m => !m.bye).map(m => m.winner);

      if (winners.length === 1) {
        // Grant finals ELO
        const loserInFinal = match.bracket[round].find(m => !m.bye && m.winner === winners[0]);
        const finalLoserId = loserInFinal ? (loserInFinal.p1 === winners[0] ? loserInFinal.p2 : loserInFinal.p1) : null;
        await applyMatchElo(interaction.client, match, winners[0], finalLoserId, round, true);
        match.status = 'complete';
        match.champion = winners[0];
        data.matches[matchId] = match;
        db.set(data);

        // Update bracket message
        try {
          const ch = await interaction.client.channels.fetch(match.channelId);
          const msg = await ch.messages.fetch(match.messageId);
          const finalEmbed = new EmbedBuilder()
            .setTitle('🏆 Tournament Complete!')
            .setColor(0xffd700)
            .setDescription(`👑 **Champion:** <@${winners[0]}>\n\nCongratulations!`)
            .setTimestamp();
          await msg.edit({ embeds: [finalEmbed], components: [] });
        } catch {}

        return interaction.reply({
          content: `✅ Winner recorded. 🏆 Tournament over — <@${winners[0]}> is the champion!`,
          ephemeral: true
        });
      }

      // Advance to next round
      const nextRound = [];
      for (let i = 0; i < winners.length - 1; i += 2) {
        nextRound.push({ p1: winners[i], p2: winners[i + 1], winner: null });
      }
      if (winners.length % 2 !== 0) {
        nextRound.push({ p1: winners[winners.length - 1], p2: null, winner: winners[winners.length - 1], bye: true });
      }

      // Fetch display names
      try {
        const guild = await interaction.client.guilds.fetch(guildId);
        for (const m of nextRound) {
          if (m.p1) { const mem = await guild.members.fetch(m.p1); m.p1Tag = mem.displayName; }
          if (m.p2) { const mem = await guild.members.fetch(m.p2); m.p2Tag = mem.displayName; }
        }
      } catch {}

      match.bracket.push(nextRound);
      match.currentRound = round + 1;
      data.matches[matchId] = match;
      db.set(data);

      // Update bracket message
      try {
        const ch = await interaction.client.channels.fetch(match.channelId);
        const msg = await ch.messages.fetch(match.messageId);
        await msg.edit({
          embeds: [buildBracketEmbed(match, match.currentRound)],
          components: buildBracketComponents(match, match.currentRound)
        });
      } catch {}

      return interaction.reply({
        content: `✅ Winner recorded! Round ${round + 1} complete — advancing to Round ${round + 2}.`,
        ephemeral: true
      });
    }

    // Round still in progress — grant ELO for this win
    const bm = match.bracket[round]?.[matchNumber];
    const ongoingLoserId = bm ? (bm.p1 === winnerUser.id ? bm.p2 : bm.p1) : null;
    await applyMatchElo(interaction.client, match, winnerUser.id, ongoingLoserId, round, false);
    // Round still in progress — just update the message
    data.matches[matchId] = match;
    db.set(data);

    try {
      const ch = await interaction.client.channels.fetch(match.channelId);
      const msg = await ch.messages.fetch(match.messageId);
      await msg.edit({
        embeds: [buildBracketEmbed(match, round)],
        components: buildBracketComponents(match, round)
      });
    } catch {}

    return interaction.reply({
      content: `✅ <@${winnerUser.id}> recorded as winner of match ${matchNumber + 1}.`,
      ephemeral: true
    });
  }
};
