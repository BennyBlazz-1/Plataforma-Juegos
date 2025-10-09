// Server/backend/models/user.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, minlength: 3 },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  isAdmin: { type: Boolean, default: false },
  library: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Game' }] // games added to user's library
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
