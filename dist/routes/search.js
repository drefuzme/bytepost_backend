import express from 'express';
import { optionalAuthenticate } from '../middleware/auth.js';
import { dbAll } from '../database/db.js';
const router = express.Router();
// Global search
router.get('/', optionalAuthenticate, async (req, res) => {
    try {
        const { q, type } = req.query;
        const query = q?.trim() || '';
        if (!query) {
            return res.json({ repositories: [], users: [], posts: [] });
        }
        const results = {
            repositories: [],
            users: [],
            posts: []
        };
        // Search repositories
        if (!type || type === 'repositories') {
            const repos = await dbAll(`
        SELECT 
          r.*,
          u.username as owner_username,
          (SELECT COUNT(*) FROM repository_stars WHERE repository_id = r.id) as stars_count
        FROM repositories r
        JOIN users u ON r.owner_id = u.id
        WHERE r.is_private = 0
          AND (r.name LIKE ? OR r.description LIKE ? OR u.username LIKE ?)
        ORDER BY stars_count DESC, r.updated_at DESC
        LIMIT 20
      `, [`%${query}%`, `%${query}%`, `%${query}%`]);
            results.repositories = repos;
        }
        // Search users
        if (!type || type === 'users') {
            const users = await dbAll(`
        SELECT 
          id,
          username,
          avatar_url,
          created_at,
          (SELECT COUNT(*) FROM user_follows WHERE following_id = users.id) as followers_count
        FROM users
        WHERE username LIKE ?
        ORDER BY followers_count DESC, created_at DESC
        LIMIT 20
      `, [`%${query}%`]);
            results.users = users;
        }
        // Search posts
        if (!type || type === 'posts') {
            const posts = await dbAll(`
        SELECT 
          p.*,
          u.username,
          u.avatar_url
        FROM posts p
        JOIN users u ON p.user_id = u.id
        WHERE p.content LIKE ?
        ORDER BY p.created_at DESC
        LIMIT 20
      `, [`%${query}%`]);
            results.posts = posts;
        }
        res.json(results);
    }
    catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
export default router;
//# sourceMappingURL=search.js.map