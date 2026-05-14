// deploy-commands.js
// Run this ONCE to register slash commands to your guild:
// node deploy-commands.js

const { REST, Routes } = require("@discordjs/rest");
require("dotenv").config();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error("Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID in .env");
  process.exit(1);
}

// Re-use command definitions from index.js
const {
  SlashCommandBuilder,
} = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("scoreboard")
    .setDescription("Create a live scoreboard")
    .addStringOption((o) =>
      o.setName("name").setDescription("Scoreboard name").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("addwin")
    .setDescription("Add a win to a user")
    .addUserOption((o) =>
      o.setName("user").setDescription("Tag the user").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("board").setDescription("Scoreboard name (optional)")
    )
    .addIntegerOption((o) =>
      o.setName("amount").setDescription("Number of wins to add (default: 1)")
    ),

  new SlashCommandBuilder()
    .setName("removewin")
    .setDescription("Remove a win from a user")
    .addUserOption((o) =>
      o.setName("user").setDescription("Tag the user").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("board").setDescription("Scoreboard name (optional)")
    )
    .addIntegerOption((o) =>
      o
        .setName("amount")
        .setDescription("Number of wins to remove (default: 1)")
    ),

  new SlashCommandBuilder()
    .setName("score")
    .setDescription("Get a user's score")
    .addUserOption((o) =>
      o.setName("user").setDescription("Tag the user").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("board").setDescription("Scoreboard name (optional)")
    ),

  new SlashCommandBuilder()
    .setName("reset")
    .setDescription("Reset all scores on a scoreboard")
    .addStringOption((o) =>
      o.setName("board").setDescription("Scoreboard name").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("deleteboard")
    .setDescription("Delete a scoreboard entirely")
    .addStringOption((o) =>
      o.setName("board").setDescription("Scoreboard name").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setrolesallowed")
    .setDescription("Set which roles can use bot commands (Admin only)")
    .addRoleOption((o) =>
      o.setName("role").setDescription("Role to allow").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("removerole")
    .setDescription("Remove a role from the allowed list (Admin only)")
    .addRoleOption((o) =>
      o.setName("role").setDescription("Role to remove").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("listboards")
    .setDescription("List all active scoreboards"),

  new SlashCommandBuilder()
    .setName("creatematch")
    .setDescription("Create a match queue (1v1 or 2v2)")
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("Match type")
        .setRequired(true)
        .addChoices({ name: "1v1", value: "1v1" }, { name: "2v2", value: "2v2" })
    )
    .addStringOption((o) =>
      o.setName("board").setDescription("Scoreboard to award wins to (optional)")
    ),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log("🔄 Registering slash commands...");
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });
    console.log("✅ Slash commands registered successfully!");
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
  }
})();
