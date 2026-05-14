const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

function load() {
  if (!fs.existsSync(DB_PATH)) {
    const defaults = { scoreboards: {}, matches: {}, settings: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { scoreboards: {}, matches: {}, settings: {} };
  }
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function get() {
  return load();
}

function set(data) {
  save(data);
}

module.exports = { get, set };
