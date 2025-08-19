const multer = require('multer');

// store files in memory instead of disk
const upload = multer({ storage: multer.memoryStorage() });

module.exports = upload;
