import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { dbRun, dbGet } from '../database/db.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Barcha maydonlar to\'ldirilishi kerak' });
    }

    // Check if user exists
    const existingUser = await dbGet('SELECT * FROM users WHERE email = ? OR username = ?', [email, username]);
    if (existingUser) {
      return res.status(400).json({ error: 'Foydalanuvchi allaqachon mavjud' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    // Check if this is the first user (make them admin)
    const userCount: any = await dbGet('SELECT COUNT(*) as count FROM users');
    const isFirstUser = (userCount?.count || 0) === 0;
    const userRole = isFirstUser ? 'admin' : 'user';

    // Create user with default icon_type 'user'
    await dbRun(
      'INSERT INTO users (id, username, email, password, role, icon_type) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, username, email, hashedPassword, userRole, 'user']
    );

    // Generate token
    const token = jwt.sign({ userId, username, email }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      message: isFirstUser 
        ? 'Foydalanuvchi muvaffaqiyatli yaratildi. Siz birinchi foydalanuvchi sifatida admin huquqiga egasiz!'
        : 'Foydalanuvchi muvaffaqiyatli yaratildi',
      token,
      user: { id: userId, username, email, role: userRole }
    });
  } catch (error: any) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email va parol kiritilishi kerak' });
    }

    // Find user
    const user: any = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(401).json({ error: 'Email yoki parol noto\'g\'ri' });
    }

    // Check if user is banned
    if (user.is_banned) {
      return res.status(403).json({ error: 'Hisobingiz bloklangan', reason: user.ban_reason });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Email yoki parol noto\'g\'ri' });
    }

    // Generate token
    const token = jwt.sign(
      { userId: user.id, username: user.username, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Muvaffaqiyatli kirildi',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar_url: user.avatar_url,
        role: user.role || 'user',
        is_verified: user.is_verified || 0,
        icon_type: user.icon_type || 'user',
        verify_icon_type: user.verify_icon_type || 'checkCircle2',
        bio: user.bio || null
      }
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server xatosi', details: error.message });
  }
});

// Get current token info (verify token)
router.get('/token', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1] || req.query.token as string;

    if (!token) {
      return res.status(401).json({ error: 'Token topilmadi' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
    res.json({
      valid: true,
      user: {
        id: decoded.userId,
        username: decoded.username,
        email: decoded.email
      },
      expiresIn: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null
    });
  } catch (error: any) {
    res.status(401).json({ error: 'Yaroqsiz token', valid: false });
  }
});

export default router;
