require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const streamifier = require('streamifier');

const Recipe = require('./models/recipe');
const User = require('./models/user');
const auth = require('./middleware/auth');
const { v2: cloudinary } = require('cloudinary');
const multer = require('multer');

const app = express();

// --- Cloudinary Setup ---
cloudinary.config(); // will auto-read CLOUDINARY_URL from .env
const upload = multer({ storage: multer.memoryStorage() });

// --- Config ---
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'mzeyara752.2@gmail.com,tamer@gmail.com')
  .split(',')
  .map(e => e.trim().toLowerCase());

// --- Middleware ---
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true, credentials: true }));
app.use(express.json());

// --- Helpers ---
function signToken(user) {
  return jwt.sign({ id: user._id, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function canEditOrDelete(user, recipe) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return recipe.author && recipe.author.toString() === user.id;
}

// --- Routes ---

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

// Auth: Register
app.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
    if (password.length < 5) return res.status(400).json({ error: 'Password must be at least 5 characters' });

    const emailNorm = email.toLowerCase().trim();
    const existing = await User.findOne({ email: emailNorm });
    if (existing) return res.status(409).json({ error: 'Email already registered. Please log in.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const role = ADMIN_EMAILS.includes(emailNorm) ? 'admin' : 'user';
    const user = await User.create({ name, email: emailNorm, passwordHash, role });
    const token = signToken(user);

    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auth: Login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const emailNorm = email.toLowerCase().trim();
    const user = await User.findOne({ email: emailNorm });
    if (!user) return res.status(404).json({ error: 'Email not found. Please register.' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    if (ADMIN_EMAILS.includes(emailNorm) && user.role !== 'admin') {
      user.role = 'admin';
      await user.save();
    }

    const token = signToken(user);
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auth: Me
app.get('/auth/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const recipeCount = await Recipe.countDocuments({ author: user._id });
  res.json({ id: user._id, name: user.name, email: user.email, role: user.role, recipeCount });
});

// Recipes: list (with search)
app.get('/recipes', async (req, res) => {
  try {
    const { q } = req.query;
    const filter = q ? { title: { $regex: q, $options: 'i' } } : {};
    const recipes = await Recipe.find(filter).populate('author', 'name');
    res.json(recipes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recipes: get one
app.get('/recipes/:id', async (req, res) => {
  try {
    const recipe = await Recipe.findById(req.params.id).populate('author', 'name');
    if (!recipe) return res.status(404).json({ error: 'Not found' });
    res.json(recipe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recipes: create (upload to Cloudinary)
app.post('/recipes', auth, upload.single('image'), async (req, res) => {
  try {
    const { title, description, ingredients, steps } = req.body;
    if (!title || !description || !ingredients || !steps) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    let imageUrl;
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'mern-food', resource_type: 'image' },
          (err, result) => (err ? reject(err) : resolve(result))
        );
        streamifier.createReadStream(req.file.buffer).pipe(stream);
      });
      imageUrl = result.secure_url;
    }

    const recipe = new Recipe({
      title,
      description,
      ingredients: Array.isArray(ingredients) ? ingredients : String(ingredients).split('\n').map(s => s.trim()).filter(Boolean),
      steps: Array.isArray(steps) ? steps : String(steps).split('\n').map(s => s.trim()).filter(Boolean),
      author: req.user.id,
      image: imageUrl,
    });

    await recipe.save();
    res.status(201).json(recipe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recipes: update
app.put('/recipes/:id', auth, upload.single('image'), async (req, res) => {
  try {
    const recipe = await Recipe.findById(req.params.id);
    if (!recipe) return res.status(404).json({ error: 'Not found' });
    if (!canEditOrDelete(req.user, recipe)) return res.status(403).json({ error: 'Not allowed' });

    const { title, description, ingredients, steps } = req.body;
    if (title) recipe.title = title;
    if (description) recipe.description = description;
    if (ingredients) recipe.ingredients = Array.isArray(ingredients) ? ingredients : String(ingredients).split('\n').map(s => s.trim()).filter(Boolean);
    if (steps) recipe.steps = Array.isArray(steps) ? steps : String(steps).split('\n').map(s => s.trim()).filter(Boolean);

    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'mern-food', resource_type: 'image' },
          (err, result) => (err ? reject(err) : resolve(result))
        );
        streamifier.createReadStream(req.file.buffer).pipe(stream);
      });
      recipe.image = result.secure_url;
    }

    await recipe.save();
    res.json(recipe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recipes: delete
app.delete('/recipes/:id', auth, async (req, res) => {
  try {
    const recipe = await Recipe.findById(req.params.id);
    if (!recipe) return res.status(404).json({ error: 'Not found' });
    if (!canEditOrDelete(req.user, recipe)) return res.status(403).json({ error: 'Not allowed' });

    await recipe.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Start Server ---
async function start() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('Missing MONGO_URI in .env');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');
  app.listen(PORT, '0.0.0.0', () => console.log(`Server listening on ${PORT}`));
}

start().catch(err => {
  console.error('Failed to start', err);
  process.exit(1);
});
