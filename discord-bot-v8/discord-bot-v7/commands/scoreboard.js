const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const { buildScoreboardEmbed } = require('../utils');

const SCOREBOARD_ROLES = ['1404660507108970566'];

function canMakeScoreboard(member) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.some(r => SCOREBOARD_ROLES.includes(r.id));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('scoreboard')
    .setDescription('Create a live scoreboard in this channel')
    .addStringOption(o => o.setName('name').setDescription('Name of the scoreboard').setRequired(true)),

  async execute(interaction) {
    if (!canMakeScoreboard(interaction.member)) {
      return interaction.reply({ content: '❌ You do not have permission to create scoreboards.', ephemeral: true });
    }

    const name = interaction.options.getString('name');
    const id = `sb-${interaction.guildId}-${Date.now()}`;

    const msg = await interaction.reply({ embeds: [buildScoreboardEmbed({ name, scores: {} })], fetchReply: true });

    const data = db.get();
    if (!data.scoreboards) data.scoreboards = {};
    data.scoreboards[id] = {
      id, name,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      messageId: msg.id,
      scores: {},
    };
    db.set(data);

    try { await msg.pin(); } catch {}
  }
};
