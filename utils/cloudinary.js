const { v2: cloudinary } = require('cloudinary');

// This auto-reads process.env.CLOUDINARY_URL
cloudinary.config();

module.exports = cloudinary;
