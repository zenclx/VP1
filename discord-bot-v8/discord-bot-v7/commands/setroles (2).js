const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setroles')
    .setDescription('Set which roles can use scoreboard commands (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(o => o.setName('role1').setDescription('Allowed role').setRequired(true))
    .addRoleOption(o => o.setName('role2').setDescription('Allowed role').setRequired(false))
    .addRoleOption(o => o.setName('role3').setDescription('Allowed role').setRequired(false))
    .addRoleOption(o => o.setName('role4').setDescription('Allowed role').setRequired(false))
    .addRoleOption(o => o.setName('role5').setDescription('Allowed role').setRequired(false)),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const roles = ['role1','role2','role3','role4','role5']
      .map(k => interaction.options.getRole(k))
      .filter(Boolean)
      .map(r => r.id);

    const data = db.get();
    if (!data.settings) data.settings = {};
    data.settings[guildId] = { ...(data.settings[guildId] || {}), allowedRoles: roles };
    db.set(data);

    const mentions = roles.map(id => `<@&${id}>`).join(', ');
    await interaction.reply({ content: `✅ Allowed roles updated: ${mentions}`, ephemeral: true });
  }
};
