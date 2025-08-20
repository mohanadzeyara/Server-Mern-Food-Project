// index.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const streamifier = require('streamifier');
const { v2: cloudinary } = require('cloudinary');

const Recipe = require('./models/recipe');   // keep your existing model (title, description, ingredients[], steps[], image, author ref)
const User   = require('./models/user');     // keep your existing model
const auth   = require('./middleware/auth'); // your existing JWT middleware

const app = express();
const PORT = process.env.PORT || 5000;

// --- CORS: allow your client + local dev
const allowOrigins = [
  process.env.CLIENT_URL,
  'https://client-mern-food-project-1.onrender.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowOrigins.includes(origin)) return cb(null, true);
    return cb(null, true); // permissive for Render
  },
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));

// --- Cloudinary: if CLOUDINARY_URL is set, v2 reads it automatically; we just force secure URLs.
if (process.env.CLOUDINARY_URL) {
  cloudinary.config({ secure: true });
} else {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_APIKEY,
    api_secret: process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_APISECRET,
    secure: true,
  });
}

// --- Multer in-memory (no filesystem on Render)
const upload = multer({ storage: multer.memoryStorage() });

// --- Helpers
function signToken(user) {
  return jwt.sign(
    { id: user._id, name: user.name, role: user.role || 'user' },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: '7d' }
  );
}

function uploadToCloudinary(fileBuffer, folder = 'mern-food') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
}

// --- Auth
app.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ error: 'Email already in use' });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });
    const token = signToken(user);
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (e) {
    res.status(500).json({ error: 'Register failed' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
    const token = signToken(user);
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (e) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/auth/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const recipeCount = await Recipe.countDocuments({ author: user._id });
  res.json({ id: user._id, name: user.name, email: user.email, role: user.role, recipeCount });
});

// --- Recipes
app.get('/recipes', async (req, res) => {
  try {
    const { q } = req.query;
    const filter = q ? { title: { $regex: q, $options: 'i' } } : {};
    const recipes = await Recipe.find(filter).sort({ createdAt: -1 }).populate('author', 'name');
    res.json(recipes);
  } catch {
    res.status(500).json({ error: 'Failed to load recipes' });
  }
});

app.get('/recipes/:id', async (req, res) => {
  try {
    const rec = await Recipe.findById(req.params.id).populate('author', 'name');
    if (!rec) return res.status(404).json({ error: 'Not found' });
    res.json(rec);
  } catch {
    res.status(500).json({ error: 'Failed to load recipe' });
  }
});

app.post('/recipes', auth, upload.single('image'), async (req, res) => {
  try {
    const { title, description } = req.body;
    let { ingredients, steps } = req.body;

    // normalize arrays (support JSON string, CSV, or newline lists)
    const normArr = (v, splitter) => {
      if (Array.isArray(v)) return v;
      if (typeof v !== 'string') return [];
      try { return JSON.parse(v); } catch {
        return v.split(splitter).map(s => s.trim()).filter(Boolean);
      }
    };
    ingredients = normArr(ingredients, ',');
    steps       = normArr(steps, '\n');

    let imageUrl = null;
    if (req.file?.buffer) {
      const uploaded = await uploadToCloudinary(req.file.buffer, 'mern-food');
      imageUrl = uploaded.secure_url;
    }

    const rec = await Recipe.create({
      title, description, ingredients, steps,
      image: imageUrl,
      author: req.user.id, // 🔑 link to creator so /auth/me shows the right count
    });
    res.status(201).json(rec);
  } catch (e) {
    console.error('Create recipe error:', e);
    res.status(500).json({ error: 'Create failed' });
  }
});

app.put('/recipes/:id', auth, upload.single('image'), async (req, res) => {
  try {
    const rec = await Recipe.findById(req.params.id);
    if (!rec) return res.status(404).json({ error: 'Not found' });
    if (String(rec.author) !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const { title, description } = req.body;
    let { ingredients, steps } = req.body;
    const normArr = (v, splitter) => {
      if (Array.isArray(v)) return v;
      if (typeof v !== 'string') return undefined;
      try { return JSON.parse(v); } catch {
        return v.split(splitter).map(s => s.trim()).filter(Boolean);
      }
    };

    if (title) rec.title = title;
    if (description) rec.description = description;
    const i = normArr(ingredients, ',');
    const s = normArr(steps, '\n');
    if (i) rec.ingredients = i;
    if (s) rec.steps = s;

    if (req.file?.buffer) {
      const uploaded = await uploadToCloudinary(req.file.buffer, 'mern-food');
      rec.image = uploaded.secure_url;
    }

    await rec.save();
    res.json(rec);
  } catch (e) {
    console.error('Update recipe error:', e);
    res.status(500).json({ error: 'Update failed' });
  }
});

app.delete('/recipes/:id', auth, async (req, res) => {
  try {
    const rec = await Recipe.findById(req.params.id);
    if (!rec) return res.status(404).json({ error: 'Not found' });
    if (String(rec.author) !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    await rec.deleteOne();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Legacy fallback if you still have an /uploads folder during local dev:
const path = require('path');
const fs = require('fs');
const uploadsDir = path.join(__dirname, 'uploads');
if (fs.existsSync(uploadsDir)) {
  app.use('/images', express.static(uploadsDir));
}

async function start() {
  if (!process.env.MONGO_URI) {
    console.error('Missing MONGO_URI');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log('MongoDB connected');
  app.listen(PORT, '0.0.0.0', () => console.log(`Server on :${PORT}`));
}
start().catch(err => { console.error('Startup error', err); process.exit(1); });
