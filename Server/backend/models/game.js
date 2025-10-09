// Server/backend/models/game.js
const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true, default: 0 },
  coverUrl: { type: String, default: '' },
  genre: { type: String, default: '' },
  releaseDate: { type: Date },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } // optional
}, { timestamps: true });

module.exports = mongoose.model('Game', gameSchema);
