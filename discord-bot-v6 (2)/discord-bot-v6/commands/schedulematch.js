const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const { DARK_BLUE } = require('../utils');
const { canManageMatch } = require('./creatematch');

// Simple natural-language time parsing
function parseTime(input) {
  const now = new Date();
  const str = input.toLowerCase().trim();

  // Try direct timestamp like "3:00pm" or "15:00" with optional day prefix
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  let dayOffset = 0;
  let timeStr = str;

  const dayMatch = days.findIndex(d => str.startsWith(d));
  if (dayMatch !== -1) {
    const currentDay = now.getDay();
    dayOffset = (dayMatch - currentDay + 7) % 7 || 7; // next occurrence
    timeStr = str.replace(days[dayMatch], '').trim();
  } else if (str.startsWith('tomorrow')) {
    dayOffset = 1;
    timeStr = str.replace('tomorrow', '').trim();
  } else if (str.startsWith('today')) {
    dayOffset = 0;
    timeStr = str.replace('today', '').trim();
  }

  // Parse time part: 3pm, 3:30pm, 15:00
  const timeRegex = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/;
  const m = timeStr.match(timeRegex);
  if (!m) return null;

  let hours = parseInt(m[1]);
  const minutes = parseInt(m[2] || '0');
  const meridiem = m[3];

  if (meridiem === 'pm' && hours !== 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;

  const result = new Date(now);
  result.setDate(now.getDate() + dayOffset);
  result.setHours(hours, minutes, 0, 0);

  // If in the past and no day specified, add a day
  if (result <= now && dayOffset === 0) result.setDate(result.getDate() + 1);

  return result.getTime() > now.getTime() ? result.getTime() : null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedulematch')
    .setDescription('Schedule a match to auto-open queue at a specific time')
    .addStringOption(o => o.setName('type').setDescription('Match type').setRequired(true)
      .addChoices({ name: '1v1', value: '1v1' }, { name: '2v2', value: '2v2' }))
    .addStringOption(o => o.setName('time').setDescription('When to open queue e.g. "Saturday 3pm", "tomorrow 7:30pm", "Friday 8pm"').setRequired(true))
    .addStringOption(o => o.setName('scoreboard').setDescription('Scoreboard to credit wins to').setRequired(false).setAutocomplete(true))
    .addStringOption(o => o.setName('prize').setDescription('Prize for the winner').setRequired(false)),

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

    const timeInput = interaction.options.getString('time');
    const type = interaction.options.getString('type');
    const sbName = interaction.options.getString('scoreboard') || null;
    const prize = interaction.options.getString('prize') || null;

    const startsAt = parseTime(timeInput);
    if (!startsAt) {
      return interaction.reply({
        content: `❌ Couldn't parse time **"${timeInput}"**. Try formats like:\n• \`Saturday 3pm\`\n• \`tomorrow 7:30pm\`\n• \`Friday 8pm\`\n• \`today 6:00pm\``,
        ephemeral: true
      });
    }

    const schedId = `sched-${interaction.guildId}-${Date.now()}`;
    const data = db.get();
    if (!data.scheduledMatches) data.scheduledMatches = {};
    data.scheduledMatches[schedId] = {
      id: schedId,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      type, sbName, prize,
      startsAt,
      createdBy: interaction.user.id,
      announceMessageId: null,
    };
    db.set(data);

    const embed = new EmbedBuilder()
      .setTitle('📅 Match Scheduled!')
      .setColor(DARK_BLUE)
      .addFields(
        { name: '🎮 Type', value: type.toUpperCase(), inline: true },
        { name: '⏰ Opens At', value: `<t:${Math.floor(startsAt / 1000)}:F>`, inline: true },
        { name: '⏳ Countdown', value: `<t:${Math.floor(startsAt / 1000)}:R>`, inline: true },
      )
      .setFooter({ text: `Scheduled by ${interaction.user.displayName} • Queue opens automatically` })
      .setTimestamp();

    if (prize) embed.addFields({ name: '🎁 Prize', value: prize, inline: false });

    const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
    data.scheduledMatches[schedId].announceMessageId = msg.id;
    db.set(data);

    // Schedule the queue open
    const delay = startsAt - Date.now();
    setTimeout(async () => {
      try {
        const fresh = db.get();
        const sched = fresh.scheduledMatches?.[schedId];
        if (!sched) return;

        // Import and invoke creatematch logic directly
        const { startScheduledMatch } = require('./creatematch');
        await startScheduledMatch(interaction.client, sched);

        delete fresh.scheduledMatches[schedId];
        db.set(fresh);
      } catch (e) {
        console.error('Scheduled match failed:', e.message);
      }
    }, delay);
  },
};
