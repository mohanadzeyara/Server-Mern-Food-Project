const express = require('express');
const streamifier = require('streamifier');
const cloudinary = require('../utils/cloudinary'); // make sure this reads your CLOUDINARY_URL
const upload = require('../utils/upload'); // your multer memory storage

const router = express.Router();

// Upload route
router.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Upload image to Cloudinary
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'mern-food', resource_type: 'image' },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      streamifier.createReadStream(req.file.buffer).pipe(stream);
    });

    // ✅ This sends back the Cloudinary URL
    res.json({
      url: result.secure_url,    // <-- This is the HTTPS URL you will save in DB
      public_id: result.public_id
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
