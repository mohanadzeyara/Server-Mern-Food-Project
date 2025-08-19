require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const Recipe = require('./models/recipe');
const User = require('./models/user');
const auth = require('./middleware/auth');

const app = express();

// CORS: allow all origins in dev; restrict via env in prod
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true, credentials: true }));
app.use(express.json());

// --- Config ---
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'mzeyara752.2@gmail.com,tamer@gmail.com')
  .split(',')
  .map(e => e.trim().toLowerCase());

// Ensure UPLOAD_DIR is declared before used
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

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

// Recipes: create
app.post('/recipes', auth, upload.single('image'), async (req, res) => {
  try {
    const { title, description, ingredients, steps } = req.body;

    if (!title || !description || !ingredients || !steps) {
      return res
        .status(400)
        .json({ error: 'All fields (title, description, ingredients, steps) are required' });
    }

    const recipe = new Recipe({
      title,
      description,
      ingredients: Array.isArray(ingredients)
        ? ingredients
        : String(ingredients)
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean),
      steps: Array.isArray(steps)
        ? steps
        : String(steps)
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean),
      author: req.user.id,
      image: req.file ? req.file.filename : undefined,
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
      // delete old image
      if (recipe.image) {
        const old = path.join(UPLOAD_DIR, recipe.image);
        if (fs.existsSync(old)) fs.unlinkSync(old);
      }
      recipe.image = req.file.filename;
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

    if (recipe.image) {
      const fp = path.join(UPLOAD_DIR, recipe.image);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    await recipe.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve images
app.use('/images', express.static(UPLOAD_DIR));

// --- Start Server ---
async function start() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('Missing MONGO_URI in .env');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');
  app.listen(PORT, () => console.log('Server listening on', PORT));
}

start().catch(err => {
  console.error('Failed to start', err);
  process.exit(1);
});
