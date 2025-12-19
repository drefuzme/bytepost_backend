import express from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { dbGet, dbAll, dbRun } from '../database/db.js';
const router = express.Router();
// All admin routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);
// Get dashboard statistics
router.get('/stats', async (req, res) => {
    try {
        const [totalUsers, totalRepos, totalPosts, totalIssues, totalPRs, totalStars, recentUsers, recentRepos] = await Promise.all([
            dbGet('SELECT COUNT(*) as count FROM users'),
            dbGet('SELECT COUNT(*) as count FROM repositories'),
            dbGet('SELECT COUNT(*) as count FROM posts'),
            dbGet('SELECT COUNT(*) as count FROM issues'),
            dbGet('SELECT COUNT(*) as count FROM pull_requests'),
            dbGet('SELECT COUNT(*) as count FROM repository_stars'),
            dbAll('SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC LIMIT 10'),
            dbAll(`
        SELECT r.id, r.name, r.description, r.is_private, r.created_at, 
               u.username as owner_username
        FROM repositories r
        JOIN users u ON r.owner_id = u.id
        ORDER BY r.created_at DESC
        LIMIT 10
      `)
        ]);
        res.json({
            stats: {
                totalUsers: totalUsers?.count || 0,
                totalRepos: totalRepos?.count || 0,
                totalPosts: totalPosts?.count || 0,
                totalIssues: totalIssues?.count || 0,
                totalPRs: totalPRs?.count || 0,
                totalStars: totalStars?.count || 0
            },
            recentUsers,
            recentRepos
        });
    }
    catch (error) {
        console.error('Admin stats error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Get user detail with all information
router.get('/users/:userId/detail', async (req, res) => {
    try {
        const { userId } = req.params;
        // Get user info
        const user = await dbGet('SELECT id, username, email, role, avatar_url, is_banned, ban_reason, banned_at, last_active, is_verified, icon_type, verify_icon_type, bio, created_at FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
        }
        // Get user repositories
        const repositories = await dbAll(`
      SELECT r.id, r.name, r.description, r.is_private, r.created_at, r.updated_at,
             (SELECT COUNT(*) FROM repository_stars WHERE repository_id = r.id) as stars_count
      FROM repositories r
      WHERE r.owner_id = ?
      ORDER BY r.created_at DESC
    `, [userId]);
        // Get user posts
        const posts = await dbAll(`
      SELECT p.id, p.content, p.created_at, p.updated_at,
             (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as likes_count,
             (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count
      FROM posts p
      WHERE p.user_id = ?
      ORDER BY p.created_at DESC
      LIMIT 20
    `, [userId]);
        // Get user issues
        const issues = await dbAll(`
      SELECT i.id, i.number, i.title, i.status, i.created_at,
             r.name as repo_name
      FROM issues i
      JOIN repositories r ON i.repository_id = r.id
      WHERE i.author_id = ?
      ORDER BY i.created_at DESC
      LIMIT 20
    `, [userId]);
        // Get user pull requests
        const pullRequests = await dbAll(`
      SELECT pr.id, pr.number, pr.title, pr.status, pr.created_at,
             r.name as repo_name
      FROM pull_requests pr
      JOIN repositories r ON pr.repository_id = r.id
      WHERE pr.author_id = ?
      ORDER BY pr.created_at DESC
      LIMIT 20
    `, [userId]);
        // Get statistics
        const [reposCount, postsCount, issuesCount, prsCount, starsCount, followersCount, followingCount] = await Promise.all([
            dbGet('SELECT COUNT(*) as count FROM repositories WHERE owner_id = ?', [userId]),
            dbGet('SELECT COUNT(*) as count FROM posts WHERE user_id = ?', [userId]),
            dbGet('SELECT COUNT(*) as count FROM issues WHERE author_id = ?', [userId]),
            dbGet('SELECT COUNT(*) as count FROM pull_requests WHERE author_id = ?', [userId]),
            dbGet(`
        SELECT COUNT(*) as count FROM repository_stars rs
        JOIN repositories r ON rs.repository_id = r.id
        WHERE r.owner_id = ?
      `, [userId]),
            dbGet('SELECT COUNT(*) as count FROM user_follows WHERE following_id = ?', [userId]),
            dbGet('SELECT COUNT(*) as count FROM user_follows WHERE follower_id = ?', [userId])
        ]);
        res.json({
            user: {
                ...user,
                is_banned: user.is_banned === 1,
                is_verified: user.is_verified === 1
            },
            statistics: {
                repositories: reposCount?.count || 0,
                posts: postsCount?.count || 0,
                issues: issuesCount?.count || 0,
                pullRequests: prsCount?.count || 0,
                stars: starsCount?.count || 0,
                followers: followersCount?.count || 0,
                following: followingCount?.count || 0
            },
            repositories,
            posts,
            issues,
            pullRequests
        });
    }
    catch (error) {
        console.error('Admin user detail error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Get all users with pagination
router.get('/users', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const offset = (page - 1) * limit;
        let query = 'SELECT id, username, email, role, avatar_url, is_banned, is_verified, icon_type, verify_icon_type, bio, last_active, created_at FROM users';
        let countQuery = 'SELECT COUNT(*) as count FROM users';
        const params = [];
        if (search) {
            query += ' WHERE username LIKE ? OR email LIKE ?';
            countQuery += ' WHERE username LIKE ? OR email LIKE ?';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm);
        }
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const [users, totalResult] = await Promise.all([
            dbAll(query, params.slice(0, params.length - 2).concat([limit, offset])),
            dbGet(countQuery, search ? [params[0], params[1]] : [])
        ]);
        res.json({
            users: users.map((u) => ({ ...u, is_banned: u.is_banned === 1, is_verified: u.is_verified === 1 })),
            pagination: {
                page,
                limit,
                total: totalResult?.count || 0,
                totalPages: Math.ceil((totalResult?.count || 0) / limit)
            }
        });
    }
    catch (error) {
        console.error('Admin users error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Update user role by userId
router.patch('/users/:userId/role', async (req, res) => {
    try {
        const { userId } = req.params;
        const { role } = req.body;
        if (!role || !['user', 'admin'].includes(role)) {
            return res.status(400).json({ error: 'Yaroqsiz rol' });
        }
        // Prevent self-demotion
        if (userId === req.user?.userId && role !== 'admin') {
            return res.status(400).json({ error: 'O\'zingizning admin huquqingizni olib tashlay olmaysiz' });
        }
        await dbRun('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
        const updatedUser = await dbGet('SELECT id, username, email, role, avatar_url, created_at FROM users WHERE id = ?', [userId]);
        res.json({ message: 'Foydalanuvchi roli yangilandi', user: updatedUser });
    }
    catch (error) {
        console.error('Admin update user role error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Update user role by email
router.patch('/users/email/:email/role', async (req, res) => {
    try {
        const { email } = req.params;
        const { role } = req.body;
        if (!role || !['user', 'admin'].includes(role)) {
            return res.status(400).json({ error: 'Yaroqsiz rol' });
        }
        // Get user by email
        const user = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
        if (!user) {
            return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
        }
        // Prevent self-demotion
        if (user.id === req.user?.userId && role !== 'admin') {
            return res.status(400).json({ error: 'O\'zingizning admin huquqingizni olib tashlay olmaysiz' });
        }
        await dbRun('UPDATE users SET role = ? WHERE email = ?', [role, email]);
        const updatedUser = await dbGet('SELECT id, username, email, role, avatar_url, is_verified, created_at FROM users WHERE email = ?', [email]);
        res.json({ message: 'Foydalanuvchi roli yangilandi', user: updatedUser });
    }
    catch (error) {
        console.error('Admin update user role by email error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Update user (username, email, icon_type, verify_icon_type)
router.patch('/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { username, email, icon_type, verify_icon_type, bio } = req.body;
        const updates = [];
        const params = [];
        if (username) {
            updates.push('username = ?');
            params.push(username);
        }
        if (email) {
            updates.push('email = ?');
            params.push(email);
        }
        if (icon_type !== undefined) {
            updates.push('icon_type = ?');
            params.push(icon_type);
        }
        if (verify_icon_type !== undefined) {
            updates.push('verify_icon_type = ?');
            params.push(verify_icon_type);
        }
        if (bio !== undefined) {
            if (bio && bio.length > 500) {
                return res.status(400).json({ error: 'Bio 500 belgidan oshmasligi kerak' });
            }
            updates.push('bio = ?');
            params.push(bio || null);
        }
        if (updates.length === 0) {
            return res.status(400).json({ error: 'Yangilanish uchun ma\'lumot kiritilmagan' });
        }
        params.push(userId);
        await dbRun(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
        const updatedUser = await dbGet('SELECT id, username, email, role, avatar_url, is_verified, icon_type, verify_icon_type, bio, created_at FROM users WHERE id = ?', [userId]);
        console.log('Updated user:', updatedUser);
        res.json({ message: 'Foydalanuvchi yangilandi', user: updatedUser });
    }
    catch (error) {
        console.error('Admin update user error:', error);
        res.status(500).json({ error: 'Server xatosi', details: error.message });
    }
});
// Verify/Unverify user
router.patch('/users/:userId/verify', async (req, res) => {
    try {
        const { userId } = req.params;
        const { verified } = req.body;
        await dbRun('UPDATE users SET is_verified = ? WHERE id = ?', [verified ? 1 : 0, userId]);
        const updatedUser = await dbGet('SELECT id, username, email, role, avatar_url, is_verified, icon_type, created_at FROM users WHERE id = ?', [userId]);
        res.json({
            message: verified ? 'Foydalanuvchi verify qilindi' : 'Foydalanuvchi verify\'dan olindi',
            user: { ...updatedUser, is_verified: updatedUser.is_verified === 1 }
        });
    }
    catch (error) {
        console.error('Admin verify user error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Ban/Unban user
router.patch('/users/:userId/ban', async (req, res) => {
    try {
        const { userId } = req.params;
        const { banned, reason } = req.body;
        // Prevent self-ban
        if (userId === req.user?.userId) {
            return res.status(400).json({ error: 'O\'zingizni ban qila olmaysiz' });
        }
        if (banned) {
            await dbRun('UPDATE users SET is_banned = 1, ban_reason = ?, banned_at = CURRENT_TIMESTAMP WHERE id = ?', [reason || 'Admin tomonidan ban qilindi', userId]);
        }
        else {
            await dbRun('UPDATE users SET is_banned = 0, ban_reason = NULL, banned_at = NULL WHERE id = ?', [userId]);
        }
        const updatedUser = await dbGet('SELECT id, username, email, role, avatar_url, is_banned, ban_reason, banned_at, created_at FROM users WHERE id = ?', [userId]);
        res.json({
            message: banned ? 'Foydalanuvchi ban qilindi' : 'Foydalanuvchi ban\'dan olindi',
            user: { ...updatedUser, is_banned: updatedUser.is_banned === 1 }
        });
    }
    catch (error) {
        console.error('Admin ban user error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Delete user
router.delete('/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        // Prevent self-deletion
        if (userId === req.user?.userId) {
            return res.status(400).json({ error: 'O\'zingizni o\'chira olmaysiz' });
        }
        await dbRun('DELETE FROM users WHERE id = ?', [userId]);
        res.json({ message: 'Foydalanuvchi o\'chirildi' });
    }
    catch (error) {
        console.error('Admin delete user error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Get all repositories with pagination
router.get('/repositories', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const offset = (page - 1) * limit;
        let query = `
      SELECT r.id, r.name, r.description, r.is_private, r.default_branch,
             r.created_at, r.updated_at,
             u.username as owner_username, u.id as owner_id,
             (SELECT COUNT(*) FROM repository_stars WHERE repository_id = r.id) as stars_count
      FROM repositories r
      JOIN users u ON r.owner_id = u.id
    `;
        let countQuery = 'SELECT COUNT(*) as count FROM repositories';
        const params = [];
        if (search) {
            query += ' WHERE r.name LIKE ? OR r.description LIKE ? OR u.username LIKE ?';
            countQuery += ' WHERE name LIKE ? OR description LIKE ?';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }
        query += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const [repositories, totalResult] = await Promise.all([
            dbAll(query, params.slice(0, params.length - 2).concat([limit, offset])),
            dbGet(countQuery, search ? [params[0], params[1]] : [])
        ]);
        res.json({
            repositories,
            pagination: {
                page,
                limit,
                total: totalResult?.count || 0,
                totalPages: Math.ceil((totalResult?.count || 0) / limit)
            }
        });
    }
    catch (error) {
        console.error('Admin repositories error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Update repository
router.patch('/repositories/:repoId', async (req, res) => {
    try {
        const { repoId } = req.params;
        const { name, description, is_private } = req.body;
        const updates = [];
        const params = [];
        if (name !== undefined) {
            updates.push('name = ?');
            params.push(name);
        }
        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description);
        }
        if (is_private !== undefined) {
            updates.push('is_private = ?');
            params.push(is_private ? 1 : 0);
        }
        if (updates.length === 0) {
            return res.status(400).json({ error: 'Yangilanish uchun ma\'lumot kiritilmagan' });
        }
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(repoId);
        await dbRun(`UPDATE repositories SET ${updates.join(', ')} WHERE id = ?`, params);
        const updatedRepo = await dbGet(`
      SELECT r.id, r.name, r.description, r.is_private, r.default_branch,
             r.created_at, r.updated_at,
             u.username as owner_username, u.id as owner_id
      FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE r.id = ?
    `, [repoId]);
        res.json({ message: 'Repository yangilandi', repository: updatedRepo });
    }
    catch (error) {
        console.error('Admin update repository error:', error);
        res.status(500).json({ error: 'Server xatosi', details: error.message });
    }
});
// Delete repository
router.delete('/repositories/:repoId', async (req, res) => {
    try {
        const { repoId } = req.params;
        await dbRun('DELETE FROM repositories WHERE id = ?', [repoId]);
        res.json({ message: 'Repository o\'chirildi' });
    }
    catch (error) {
        console.error('Admin delete repository error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Get all posts with pagination
router.get('/posts', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const offset = (page - 1) * limit;
        let query = `
      SELECT p.id, p.content, p.created_at, p.updated_at,
             u.username as author_username, u.id as author_id,
             (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as likes_count,
             (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count
      FROM posts p
      JOIN users u ON p.user_id = u.id
    `;
        let countQuery = 'SELECT COUNT(*) as count FROM posts';
        const params = [];
        if (search) {
            query += ' WHERE p.content LIKE ? OR u.username LIKE ?';
            countQuery = `
        SELECT COUNT(*) as count FROM posts p
        JOIN users u ON p.user_id = u.id
        WHERE p.content LIKE ? OR u.username LIKE ?
      `;
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm);
        }
        query += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
        const queryParams = search ? [...params, limit, offset] : [limit, offset];
        const countParams = search ? [params[0], params[1]] : [];
        const [posts, totalResult] = await Promise.all([
            dbAll(query, queryParams),
            dbGet(countQuery, countParams)
        ]);
        res.json({
            posts,
            pagination: {
                page,
                limit,
                total: totalResult?.count || 0,
                totalPages: Math.ceil((totalResult?.count || 0) / limit)
            }
        });
    }
    catch (error) {
        console.error('Admin posts error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Update post
router.patch('/posts/:postId', async (req, res) => {
    try {
        const { postId } = req.params;
        const { content } = req.body;
        const updates = [];
        const params = [];
        if (content !== undefined) {
            updates.push('content = ?');
            params.push(content);
        }
        if (updates.length === 0) {
            return res.status(400).json({ error: 'Yangilanish uchun ma\'lumot kiritilmagan' });
        }
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(postId);
        await dbRun(`UPDATE posts SET ${updates.join(', ')} WHERE id = ?`, params);
        const updatedPost = await dbGet(`
      SELECT p.id, p.content, p.created_at, p.updated_at,
             u.username as author_username, u.id as author_id
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `, [postId]);
        res.json({ message: 'Post yangilandi', post: updatedPost });
    }
    catch (error) {
        console.error('Admin update post error:', error);
        res.status(500).json({ error: 'Server xatosi', details: error.message });
    }
});
// Delete post
router.delete('/posts/:postId', async (req, res) => {
    try {
        const { postId } = req.params;
        await dbRun('DELETE FROM posts WHERE id = ?', [postId]);
        res.json({ message: 'Post o\'chirildi' });
    }
    catch (error) {
        console.error('Admin delete post error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Get all issues with pagination
router.get('/issues', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const status = req.query.status || '';
        const offset = (page - 1) * limit;
        let query = `
      SELECT i.id, i.number, i.title, i.body, i.status, i.created_at, i.updated_at,
             r.name as repo_name, r.id as repo_id,
             u.username as author_username, u.id as author_id,
             assignee.username as assignee_username
      FROM issues i
      JOIN repositories r ON i.repository_id = r.id
      JOIN users u ON i.author_id = u.id
      LEFT JOIN users assignee ON i.assignee_id = assignee.id
    `;
        let countQuery = 'SELECT COUNT(*) as count FROM issues';
        const params = [];
        const conditions = [];
        if (search) {
            conditions.push('(i.title LIKE ? OR i.body LIKE ? OR r.name LIKE ?)');
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }
        if (status) {
            conditions.push('i.status = ?');
            params.push(status);
        }
        if (conditions.length > 0) {
            const whereClause = ' WHERE ' + conditions.join(' AND ');
            query += whereClause;
            countQuery += whereClause;
        }
        query += ' ORDER BY i.created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const [issues, totalResult] = await Promise.all([
            dbAll(query, params.slice(0, params.length - 2).concat([limit, offset])),
            dbGet(countQuery, params.slice(0, params.length - 2))
        ]);
        res.json({
            issues,
            pagination: {
                page,
                limit,
                total: totalResult?.count || 0,
                totalPages: Math.ceil((totalResult?.count || 0) / limit)
            }
        });
    }
    catch (error) {
        console.error('Admin issues error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Delete issue
router.delete('/issues/:issueId', async (req, res) => {
    try {
        const { issueId } = req.params;
        await dbRun('DELETE FROM issues WHERE id = ?', [issueId]);
        res.json({ message: 'Issue o\'chirildi' });
    }
    catch (error) {
        console.error('Admin delete issue error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Get all pull requests with pagination
router.get('/pull-requests', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const status = req.query.status || '';
        const offset = (page - 1) * limit;
        let query = `
      SELECT pr.id, pr.number, pr.title, pr.body, pr.status, pr.base_branch, pr.head_branch,
             pr.created_at, pr.updated_at, pr.merged_at, pr.closed_at,
             r.name as repo_name, r.id as repo_id,
             u.username as author_username, u.id as author_id
      FROM pull_requests pr
      JOIN repositories r ON pr.repository_id = r.id
      JOIN users u ON pr.author_id = u.id
    `;
        let countQuery = 'SELECT COUNT(*) as count FROM pull_requests';
        const params = [];
        const conditions = [];
        if (search) {
            conditions.push('(pr.title LIKE ? OR pr.body LIKE ? OR r.name LIKE ?)');
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }
        if (status) {
            conditions.push('pr.status = ?');
            params.push(status);
        }
        if (conditions.length > 0) {
            const whereClause = ' WHERE ' + conditions.join(' AND ');
            query += whereClause;
            countQuery += whereClause;
        }
        query += ' ORDER BY pr.created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const [pullRequests, totalResult] = await Promise.all([
            dbAll(query, params.slice(0, params.length - 2).concat([limit, offset])),
            dbGet(countQuery, params.slice(0, params.length - 2))
        ]);
        res.json({
            pullRequests,
            pagination: {
                page,
                limit,
                total: totalResult?.count || 0,
                totalPages: Math.ceil((totalResult?.count || 0) / limit)
            }
        });
    }
    catch (error) {
        console.error('Admin pull requests error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Delete pull request
router.delete('/pull-requests/:prId', async (req, res) => {
    try {
        const { prId } = req.params;
        await dbRun('DELETE FROM pull_requests WHERE id = ?', [prId]);
        res.json({ message: 'Pull Request o\'chirildi' });
    }
    catch (error) {
        console.error('Admin delete pull request error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
export default router;
//# sourceMappingURL=admin.js.map