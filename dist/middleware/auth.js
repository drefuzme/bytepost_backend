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
        // Get user role from database
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
// Optional authentication - sets user if token exists, but doesn't require it
export const optionalAuthenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader?.split(' ')[1];
        if (token) {
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                // Get user role from database
                const user = await dbGet('SELECT role, username, email FROM users WHERE id = ?', [decoded.userId]);
                if (user) {
                    req.user = {
                        userId: decoded.userId,
                        username: user.username || decoded.username,
                        email: user.email || decoded.email,
                        role: user.role || 'user'
                    };
                    console.log('OptionalAuth: User authenticated', {
                        userId: req.user.userId,
                        username: req.user.username,
                        role: req.user.role,
                        path: req.path
                    });
                }
                else {
                    console.log('OptionalAuth: User not found in database', {
                        userId: decoded.userId,
                        path: req.path
                    });
                    req.user = undefined;
                }
            }
            catch (error) {
                // Invalid token, but continue without user
                console.log('OptionalAuth: Invalid token', {
                    error: error.message,
                    path: req.path,
                    hasAuthHeader: !!authHeader
                });
                req.user = undefined;
            }
        }
        else {
            console.log('OptionalAuth: No token provided', {
                path: req.path,
                hasAuthHeader: !!authHeader
            });
        }
        next();
    }
    catch (error) {
        // Continue without user
        console.error('OptionalAuth: Error', {
            error: error.message,
            path: req.path
        });
        next();
    }
};
// Admin middleware - requires admin role
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