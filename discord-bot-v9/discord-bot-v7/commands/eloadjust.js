const { eloAdjustCommand } = require('./elo');
module.exports = { data: eloAdjustCommand.data, execute: eloAdjustCommand.execute };
