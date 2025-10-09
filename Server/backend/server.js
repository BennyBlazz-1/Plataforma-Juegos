// Server/backend/server.js
// MAIN SERVER: contains Server class with constructor, DB connection, middlewares, routes and listen.
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const User = require('./models/user.js');
const Game = require('./models/game.js');

const JWT_SECRET = process.env.JWT_SECRET || 'secretllavesecreta';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bdplataformajuegos';

class Server {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 5000;
    this._connectDB();
    this._middlewares();
    this._routes();
  }

  _connectDB() {
    mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    }).then(() => {
      console.log('MongoDB connected');
    }).catch(err => {
      console.error('MongoDB connection error:', err);
    });
  }

  _middlewares() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // serve frontend static
    this.app.use('/', express.static(path.join(__dirname, '..', 'frontend', 'public')));
  }

  // Middleware to protect routes
  authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if(!authHeader) return res.status(401).json({ message: 'No token provided' });

    const token = authHeader.split(' ')[1];
    if(!token) return res.status(401).json({ message: 'Malformed token' });

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload; // { id, username, isAdmin }
      next();
    } catch (err) {
      return res.status(401).json({ message: 'Invalid token' });
    }
  }

  _routes() {
    const app = this.app;

    // ---------- Auth ----------
    app.post('/api/auth/register', async (req, res) => {
      try {
        const { username, email, password } = req.body;
        if(!username || !email || !password) return res.status(400).json({ message: 'Missing fields' });

        const existing = await User.findOne({ $or: [{ email }, { username }] });
        if(existing) return res.status(400).json({ message: 'Email or username already in use' });

        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const user = new User({ username, email, passwordHash });
        await user.save();

        const token = jwt.sign({ id: user._id, username: user.username, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user._id, username: user.username, email: user.email, isAdmin: user.isAdmin } });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
      }
    });

    app.post('/api/auth/login', async (req, res) => {
      try {
        const { emailOrUsername, password } = req.body;
        if(!emailOrUsername || !password) return res.status(400).json({ message: 'Missing fields' });

        const user = await User.findOne({ $or: [{ email: emailOrUsername }, { username: emailOrUsername }] });
        if(!user) return res.status(400).json({ message: 'Invalid credentials' });

        const ok = await bcrypt.compare(password, user.passwordHash);
        if(!ok) return res.status(400).json({ message: 'Invalid credentials' });

        const token = jwt.sign({ id: user._id, username: user.username, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user._id, username: user.username, email: user.email, isAdmin: user.isAdmin } });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
      }
    });

    // ---------- Games CRUD ----------
    // Get all games (public)
    app.get('/api/games', async (req, res) => {
      try {
        const q = req.query.q || '';
        const filter = q ? { title: { $regex: q, $options: 'i' } } : {};
        const games = await Game.find(filter).sort({ createdAt: -1 });
        res.json(games);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
      }
    });

    // Get single
    app.get('/api/games/:id', async (req, res) => {
      try {
        const game = await Game.findById(req.params.id);
        if(!game) return res.status(404).json({ message: 'Not found' });
        res.json(game);
      } catch (err) {
        res.status(500).json({ message: 'Server error' });
      }
    });

    // Create game (protected) - if you want only admins, check req.user.isAdmin
    app.post('/api/games', this.authMiddleware.bind(this), async (req, res) => {
      try {
        // optionally enforce admin:
        // if(!req.user.isAdmin) return res.status(403).json({ message: 'Admin only' });

        const { title, description, price, coverUrl, genre, releaseDate } = req.body;
        if(!title) return res.status(400).json({ message: 'Title required' });

        const game = new Game({
          title,
          description,
          price: price || 0,
          coverUrl: coverUrl || '',
          genre: genre || '',
          releaseDate: releaseDate ? new Date(releaseDate) : null,
          createdBy: req.user.id
        });
        await game.save();
        res.json(game);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
      }
    });

    // Update
    app.put('/api/games/:id', this.authMiddleware.bind(this), async (req, res) => {
      try {
        const { id } = req.params;
        const update = req.body;
        const game = await Game.findByIdAndUpdate(id, update, { new: true });
        if(!game) return res.status(404).json({ message: 'Not found' });
        res.json(game);
      } catch (err) {
        res.status(500).json({ message: 'Server error' });
      }
    });

    // Delete
    app.delete('/api/games/:id', this.authMiddleware.bind(this), async (req, res) => {
      try {
        const { id } = req.params;
        const game = await Game.findByIdAndDelete(id);
        if(!game) return res.status(404).json({ message: 'Not found' });
        // Also remove from users' libraries
        await User.updateMany({ library: game._id }, { $pull: { library: game._id } });
        res.json({ message: 'Deleted' });
      } catch (err) {
        res.status(500).json({ message: 'Server error' });
      }
    });

    // ---------- Library (user-specific) ----------
    // Get user's library
    app.get('/api/library', this.authMiddleware.bind(this), async (req, res) => {
      try {
        const user = await User.findById(req.user.id).populate('library');
        if(!user) return res.status(404).json({ message: 'User not found' });
        res.json(user.library);
      } catch (err) {
        res.status(500).json({ message: 'Server error' });
      }
    });

    // Add to library
    app.post('/api/library/add', this.authMiddleware.bind(this), async (req, res) => {
      try {
        const { gameId } = req.body;
        if(!gameId) return res.status(400).json({ message: 'gameId required' });

        const game = await Game.findById(gameId);
        if(!game) return res.status(404).json({ message: 'Game not found' });

        const user = await User.findById(req.user.id);
        if(!user) return res.status(404).json({ message: 'User not found' });

        if(user.library.includes(game._id)) return res.status(400).json({ message: 'Already in library' });

        user.library.push(game._id);
        await user.save();
        res.json({ message: 'Added', library: user.library });
      } catch (err) {
        res.status(500).json({ message: 'Server error' });
      }
    });

    // Remove from library
    app.post('/api/library/remove', this.authMiddleware.bind(this), async (req, res) => {
      try {
        const { gameId } = req.body;
        if(!gameId) return res.status(400).json({ message: 'gameId required' });

        const user = await User.findById(req.user.id);
        if(!user) return res.status(404).json({ message: 'User not found' });

        user.library = user.library.filter(g => g.toString() !== gameId);
        await user.save();
        res.json({ message: 'Removed', library: user.library });
      } catch (err) {
        res.status(500).json({ message: 'Server error' });
      }
    });

    // Fallback to index.html for client-side routing
    this.app.use((req, res) => {
  res.status(404).send("Página no encontrada 😢");
});

  }

  listen() {
    this.app.listen(this.port, () => {
      console.log(`🚀 Servidor corriendo en: http://localhost:${this.port}`);
    });
  }
}

if (require.main === module) {
  const server = new Server();
  server.listen();
}

module.exports = Server;
