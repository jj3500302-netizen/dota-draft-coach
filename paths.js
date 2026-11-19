// Where the app keeps data it writes (matches, reports, caches).
// From source: ./data. In the exe the app folder is unpacked fresh each launch, so main.js points
// DRAFTCOACH_DATA at a folder in AppData that survives restarts.
const path = require("path");
module.exports = { DATA: process.env.DRAFTCOACH_DATA || path.join(__dirname, "data") };
