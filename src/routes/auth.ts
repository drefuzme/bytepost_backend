import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import { dbRun, dbGet, dbAll } from '../database/db.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Email transporter configuration
const createTransporter = () => {
  // For development, use Ethereal Email (fake SMTP)
  // For production, configure real SMTP settings
  if (process.env.NODE_ENV === 'production' && process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else {
    // Development: Use console logging instead of real email
    return {
      sendMail: async (options: any) => {
        console.log('\n📧 EMAIL (Development Mode):');
        console.log('To:', options.to);
        console.log('Subject:', options.subject);
        console.log('Reset Link:', options.text.match(/http[^\s]+/)?.[0] || 'Link not found');
        console.log('---\n');
        return { messageId: 'dev-email-id' };
      },
    };
  }
};

// Check registration status (public endpoint)
router.get('/registration-status', async (req, res) => {
  try {
    const registrationSetting: any = await dbGet(
      'SELECT value FROM system_settings WHERE key = ?',
      ['registration_enabled']
    );
    
    const whitelistSetting: any = await dbGet(
      'SELECT value FROM system_settings WHERE key = ?',
      ['email_whitelist_enabled']
    );

    res.json({
      registrationEnabled: registrationSetting?.value !== 'false',
      emailWhitelistEnabled: whitelistSetting?.value === 'true'
    });
  } catch (error: any) {
    console.error('Registration status check error:', error);
    // Default to enabled if we can't check
    res.json({
      registrationEnabled: true,
      emailWhitelistEnabled: false
    });
  }
});

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Barcha maydonlar to\'ldirilishi kerak' });
    }

    // Check if registration is enabled
    const registrationSetting: any = await dbGet(
      'SELECT value FROM system_settings WHERE key = ?',
      ['registration_enabled']
    );
    
    if (registrationSetting?.value === 'false') {
      return res.status(403).json({ error: 'Registratsiya hozircha o\'chirilgan' });
    }

    // Check email whitelist if enabled
    const whitelistSetting: any = await dbGet(
      'SELECT value FROM system_settings WHERE key = ?',
      ['email_whitelist_enabled']
    );

    if (whitelistSetting?.value === 'true') {
      const emailDomain = email.split('@')[1]?.toLowerCase();
      if (!emailDomain) {
        return res.status(400).json({ error: 'Noto\'g\'ri email formati' });
      }

      const whitelistEntry: any = await dbGet(
        'SELECT * FROM email_whitelist WHERE email_domain = ?',
        [emailDomain]
      );

      if (!whitelistEntry) {
        return res.status(403).json({ 
          error: `Bu email domeni ruxsat etilmagan. Faqat ruxsat etilgan email domenlari orqali registratsiya qilish mumkin.` 
        });
      }
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

// Forgot Password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email kiritilishi kerak' });
    }

    // Find user
    const user: any = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      // Don't reveal if user exists for security
      return res.json({ 
        message: 'Agar bu email bilan hisob mavjud bo\'lsa, parolni tiklash havolasi emailga yuborildi' 
      });
    }

    // Generate reset token
    const resetToken = uuidv4();
    const tokenId = uuidv4();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // Token expires in 1 hour

    // Delete old unused tokens for this user
    await dbRun(
      'DELETE FROM password_reset_tokens WHERE user_id = ? AND used = 0',
      [user.id]
    );

    // Save reset token
    await dbRun(
      'INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)',
      [tokenId, user.id, resetToken, expiresAt.toISOString()]
    );

    // Send email
    const resetLink = `${FRONTEND_URL}/reset-password?token=${resetToken}`;
    const transporter = createTransporter();

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@bytepost.com',
      to: email,
      subject: 'BytePost - Parolni tiklash',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">Parolni tiklash</h2>
          <p>Salom ${user.username},</p>
          <p>Parolni tiklash so'rovi qabul qilindi. Quyidagi havolani bosib parolni yangilang:</p>
          <p style="margin: 20px 0;">
            <a href="${resetLink}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Parolni tiklash
            </a>
          </p>
          <p>Yoki quyidagi havolani brauzerda oching:</p>
          <p style="color: #6b7280; word-break: break-all;">${resetLink}</p>
          <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
            Bu havola 1 soatdan keyin muddati tugaydi.<br>
            Agar siz bu so'rovni qilmagan bo'lsangiz, bu xatni e'tiborsiz qoldiring.
          </p>
        </div>
      `,
      text: `Parolni tiklash uchun quyidagi havolani oching: ${resetLink}`,
    });

    res.json({ 
      message: 'Agar bu email bilan hisob mavjud bo\'lsa, parolni tiklash havolasi emailga yuborildi' 
    });
  } catch (error: any) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Server xatosi', details: error.message });
  }
});

// Reset Password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token va yangi parol kiritilishi kerak' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Parol kamida 6 belgidan iborat bo\'lishi kerak' });
    }

    // Find reset token
    const resetToken: any = await dbGet(
      'SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0',
      [token]
    );

    if (!resetToken) {
      return res.status(400).json({ error: 'Yaroqsiz yoki muddati o\'tgan token' });
    }

    // Check if token is expired
    const expiresAt = new Date(resetToken.expires_at);
    if (expiresAt < new Date()) {
      await dbRun('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [resetToken.id]);
      return res.status(400).json({ error: 'Token muddati o\'tgan' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update user password
    await dbRun('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, resetToken.user_id]);

    // Mark token as used
    await dbRun('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [resetToken.id]);

    res.json({ message: 'Parol muvaffaqiyatli yangilandi' });
  } catch (error: any) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server xatosi', details: error.message });
  }
});

export default router;
