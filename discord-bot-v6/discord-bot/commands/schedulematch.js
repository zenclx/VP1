const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const { DARK_BLUE } = require('../utils');
const { canManageMatch } = require('./creatematch');

function parseTime(timeStr) {
  // Try to parse natural language like "Saturday 3pm", "tomorrow 5:30pm", "in 2 hours"
  const now = new Date();

  // "in X minutes/hours"
  const inMatch = timeStr.match(/in\s+(\d+)\s*(minute|hour|min|hr)s?/i);
  if (inMatch) {
    const amount = parseInt(inMatch[1]);
    const unit = inMatch[2].toLowerCase();
    const ms = (unit.startsWith('h') ? 3600000 : 60000) * amount;
    return new Date(Date.now() + ms);
  }

  // Try direct Date.parse (handles "Saturday 3pm", ISO strings, etc.)
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const dayMatch = timeStr.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  let targetDate = new Date(timeStr);

  if (dayMatch) {
    const targetDay = days.indexOf(dayMatch[1].toLowerCase());
    const currentDay = now.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    const d = new Date(now);
    d.setDate(d.getDate() + daysUntil);
    // Parse time portion
    const timeMatch = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const mins = parseInt(timeMatch[2] || '0');
      const meridiem = timeMatch[3].toLowerCase();
      if (meridiem === 'pm' && hours !== 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;
      d.setHours(hours, mins, 0, 0);
    }
    targetDate = d;
  }

  if (isNaN(targetDate.getTime())) return null;
  return targetDate;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedulematch')
    .setDescription('Schedule a match to auto-open at a specific time')
    .addStringOption(o =>
      o.setName('time').setDescription('When to open (e.g. "Saturday 3pm", "in 2 hours", "tomorrow 6pm")').setRequired(true)
    )
    .addStringOption(o =>
      o.setName('type').setDescription('Match type').setRequired(true)
        .addChoices({ name: '1v1', value: '1v1' }, { name: '2v2', value: '2v2' })
    )
    .addStringOption(o =>
      o.setName('scoreboard').setDescription('Scoreboard to credit wins').setRequired(false).setAutocomplete(true)
    )
    .addStringOption(o =>
      o.setName('prize').setDescription('Prize for the winner').setRequired(false)
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
    if (!canManageMatch(interaction.member)) {
      return interaction.reply({ content: '❌ You do not have permission to schedule matches.', ephemeral: true });
    }

    const timeStr = interaction.options.getString('time');
    const type = interaction.options.getString('type');
    const sbName = interaction.options.getString('scoreboard');
    const prize = interaction.options.getString('prize');

    const openAt = parseTime(timeStr);
    if (!openAt || openAt <= new Date()) {
      return interaction.reply({ content: '❌ Could not parse that time, or it\'s in the past. Try something like `Saturday 3pm` or `in 2 hours`.', ephemeral: true });
    }

    const msUntil = openAt.getTime() - Date.now();
    const unixTs = Math.floor(openAt.getTime() / 1000);

    const embed = new EmbedBuilder()
      .setTitle(`📅 Match Scheduled — ${type.toUpperCase()}`)
      .setColor(DARK_BLUE)
      .setDescription(
        `A **${type.toUpperCase()}** match will open for registration at <t:${unixTs}:F> (<t:${unixTs}:R>).\n\n` +
        `The queue will automatically open when the time arrives!`
      )
      .addFields(
        { name: '🎮 Type', value: type.toUpperCase(), inline: true },
        ...(prize ? [{ name: '🎁 Prize', value: prize, inline: true }] : []),
        ...(sbName ? [{ name: '📊 Scoreboard', value: sbName, inline: true }] : []),
      )
      .setTimestamp();

    const msg = await interaction.reply({ embeds: [embed], fetchReply: true });

    // Store in DB
    const data = db.get();
    if (!data.scheduledMatches) data.scheduledMatches = {};
    const scheduleId = `sched-${interaction.guildId}-${Date.now()}`;
    data.scheduledMatches[scheduleId] = {
      id: scheduleId,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      messageId: msg.id,
      openAt: openAt.getTime(),
      type,
      sbName: sbName || null,
      prize: prize || null,
    };
    db.set(data);

    // Schedule the auto-open
    setTimeout(async () => {
      try {
        // Remove from scheduled
        const d = db.get();
        delete d.scheduledMatches?.[scheduleId];
        db.set(d);

        // Trigger creatematch flow
        const { startBracket, timers, buildQueueEmbed } = require('./creatematch');
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

        const matchId = `match-${interaction.guildId}-${Date.now()}`;
        const QUEUE_DURATION_MS = 5 * 60 * 1000;
        const match = {
          id: matchId, guildId: interaction.guildId, channelId: interaction.channelId,
          type, scoreboardName: sbName || null, prize: prize || null,
          queue: [], status: 'queuing', endsAt: Date.now() + QUEUE_DURATION_MS,
          bracket: [], currentRound: 0, messageId: null,
          privateChannelId: null, bracketMessageId: null, hostId: 'scheduled',
          matchNum: 0,
        };

        const joinRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`join_queue_${matchId}`).setLabel('Join Queue').setStyle(ButtonStyle.Success).setEmoji('⚔️'),
          new ButtonBuilder().setCustomId(`leave_queue_${matchId}`).setLabel('Leave Queue').setStyle(ButtonStyle.Secondary).setEmoji('🚪'),
          new ButtonBuilder().setCustomId(`addminute_${matchId}`).setLabel('+1 Minute').setStyle(ButtonStyle.Secondary).setEmoji('⏱️'),
          new ButtonBuilder().setCustomId(`forcestart_${matchId}`).setLabel('Force Start').setStyle(ButtonStyle.Danger).setEmoji('🚀'),
        );

        const ch = await interaction.client.channels.fetch(interaction.channelId);
        const openMsg = await ch.send({ content: `@everyone 🔔 **Scheduled match is now open!** Queue up below!`, embeds: [buildQueueEmbed(match)], components: [joinRow] });
        match.messageId = openMsg.id;

        const d2 = db.get();
        if (!d2.matches) d2.matches = {};
        d2.matches[matchId] = match;
        db.set(d2);

        const intervalId = setInterval(async () => {
          const fresh = db.get();
          const m = fresh.matches[matchId];
          if (!m || m.status !== 'queuing') { clearInterval(intervalId); return; }
          try {
            const ch2 = await interaction.client.channels.fetch(m.channelId);
            const ms2 = await ch2.messages.fetch(m.messageId);
            await ms2.edit({ embeds: [buildQueueEmbed(m)], components: [joinRow] });
          } catch {}
        }, 30000);

        const timer = setTimeout(async () => {
          clearInterval(intervalId);
          await startBracket(interaction.client, matchId);
        }, QUEUE_DURATION_MS);

        timers.set(matchId, { timer, interval: intervalId });
      } catch (e) { console.error('Failed to auto-open scheduled match:', e); }
    }, msUntil);
  }
};
