const { eloLeaderboardCommand } = require('./elo');
module.exports = { data: eloLeaderboardCommand.data, execute: eloLeaderboardCommand.execute };
