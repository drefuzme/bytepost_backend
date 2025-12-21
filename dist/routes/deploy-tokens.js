import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbRun, dbGet, dbAll } from '../database/db.js';
import { authenticate } from '../middleware/auth.js';
import jwt from 'jsonwebtoken';
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
// Generate deploy token
function generateDeployToken(repoId, name) {
    const payload = {
        type: 'deploy',
        repoId,
        name,
        iat: Math.floor(Date.now() / 1000)
    };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '365d' });
}
// Verify deploy token
export function verifyDeployToken(token) {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.type === 'deploy') {
            return decoded;
        }
        return null;
    }
    catch {
        return null;
    }
}
// Create deploy token
router.post('/:owner/:repo/tokens', authenticate, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { name, permissions, expiresInDays } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Token nomi kiritilishi kerak' });
        }
        const repository = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ? AND r.owner_id = ?
    `, [owner, repo, req.user.userId]);
        if (!repository) {
            return res.status(404).json({ error: 'Repository topilmadi yoki sizda huquq yo\'q' });
        }
        const tokenId = uuidv4();
        const token = generateDeployToken(repository.id, name);
        const perms = permissions || 'read,write';
        const expiresAt = expiresInDays
            ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
            : null;
        await dbRun(`INSERT INTO deploy_tokens (id, repository_id, token, name, permissions, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`, [tokenId, repository.id, token, name, perms, expiresAt]);
        res.status(201).json({
            message: 'Deploy token muvaffaqiyatli yaratildi',
            token,
            tokenId,
            name,
            permissions: perms,
            expiresAt,
            // Git URL with token - use environment variable or default
            gitUrl: (() => {
                const apiUrl = process.env.API_URL || process.env.RAILWAY_PUBLIC_DOMAIN || 'http://localhost:5000';
                const host = apiUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
                return `http://${token}@${host}/${owner}/${repo}.git`;
            })()
        });
    }
    catch (error) {
        console.error('Create deploy token error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Get all deploy tokens for repository
router.get('/:owner/:repo/tokens', authenticate, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const repository = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ? AND r.owner_id = ?
    `, [owner, repo, req.user.userId]);
        if (!repository) {
            return res.status(404).json({ error: 'Repository topilmadi' });
        }
        const tokens = await dbAll('SELECT id, name, permissions, expires_at, created_at, last_used_at FROM deploy_tokens WHERE repository_id = ? ORDER BY created_at DESC', [repository.id]);
        res.json(tokens);
    }
    catch (error) {
        console.error('Get deploy tokens error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Delete deploy token
router.delete('/:owner/:repo/tokens/:tokenId', authenticate, async (req, res) => {
    try {
        const { owner, repo, tokenId } = req.params;
        const repository = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ? AND r.owner_id = ?
    `, [owner, repo, req.user.userId]);
        if (!repository) {
            return res.status(404).json({ error: 'Repository topilmadi' });
        }
        await dbRun('DELETE FROM deploy_tokens WHERE id = ? AND repository_id = ?', [tokenId, repository.id]);
        res.json({ message: 'Token muvaffaqiyatli o\'chirildi' });
    }
    catch (error) {
        console.error('Delete deploy token error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
export default router;
//# sourceMappingURL=deploy-tokens.js.map