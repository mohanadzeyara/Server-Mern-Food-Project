const cloudinary = require('cloudinary').v2;

// This reads CLOUDINARY_URL from your .env
cloudinary.config({
  secure: true, // ensures HTTPS URLs
});

module.exports = cloudinary;
