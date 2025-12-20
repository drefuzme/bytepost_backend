import jwt from 'jsonwebtoken';
import { dbGet } from '../database/db.js';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
export const authenticate = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'Token topilmadi' });
        }
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await dbGet('SELECT role FROM users WHERE id = ?', [decoded.userId]);
        if (!user) {
            console.error('Authenticate: User not found in database', { userId: decoded.userId });
            return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });
        }
        req.user = {
            userId: decoded.userId,
            username: decoded.username,
            email: decoded.email,
            role: user.role || 'user'
        };
        next();
    }
    catch (error) {
        console.error('Authenticate error:', error);
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Yaroqsiz token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token muddati tugagan' });
        }
        res.status(500).json({ error: 'Autentifikatsiya xatosi', details: error.message });
    }
};
export const optionalAuthenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader?.split(' ')[1];
        if (token) {
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                const user = await dbGet('SELECT role, username, email FROM users WHERE id = ?', [decoded.userId]);
                if (user) {
                    req.user = {
                        userId: decoded.userId,
                        username: user.username || decoded.username,
                        email: user.email || decoded.email,
                        role: user.role || 'user'
                    };
                }
                else {
                    req.user = undefined;
                }
            }
            catch (error) {
                req.user = undefined;
            }
        }
        next();
    }
    catch (error) {
        next();
    }
};
export const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Autentifikatsiya talab qilinadi' });
    }
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin huquqi talab qilinadi' });
    }
    next();
};
//# sourceMappingURL=auth.js.map