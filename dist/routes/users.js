import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbAll, dbRun } from '../database/db.js';
import { authenticate, optionalAuthenticate } from '../middleware/auth.js';
const router = express.Router();
// Get current user
router.get('/me', authenticate, async (req, res) => {
    try {
        const user = await dbGet('SELECT id, username, email, avatar_url, role, is_verified, icon_type, verify_icon_type, bio, created_at FROM users WHERE id = ?', [req.user.userId]);
        if (!user) {
            return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
        }
        res.json(user);
    }
    catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Server xatosi', details: error.message });
    }
});
// Get recommended users to follow (must be before /:username route)
router.get('/recommendations', authenticate, async (req, res) => {
    try {
        // Check if 'all' query parameter is provided to get all users
        const getAll = req.query.all === 'true';
        // First, get all users count
        const allUsersCount = await dbGet('SELECT COUNT(*) as count FROM users WHERE id != ?', [req.user.userId]);
        console.log('All users count (excluding self):', allUsersCount?.count || 0);
        // Get users that current user is following
        const followingUsers = await dbAll('SELECT following_id FROM user_follows WHERE follower_id = ?', [req.user.userId]);
        console.log('Following users count:', followingUsers?.length || 0);
        // Build query - if no following users, use simpler query
        let recommendedUsers;
        if (getAll) {
            // Get all users excluding self (for group chat user search)
            recommendedUsers = await dbAll(`
        SELECT 
          u.id,
          u.username,
          u.avatar_url,
          u.role,
          u.icon_type,
          u.verify_icon_type,
          u.is_verified,
          u.bio,
          u.created_at,
          COALESCE((SELECT COUNT(*) FROM user_follows WHERE following_id = u.id), 0) as followers_count,
          CASE WHEN EXISTS (SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = u.id) THEN 1 ELSE 0 END as is_following
        FROM users u
        WHERE u.id != ?
        ORDER BY u.username ASC
      `, [req.user.userId, req.user.userId]);
        }
        else if (followingUsers.length === 0) {
            // No following users, just get random users excluding self
            recommendedUsers = await dbAll(`
        SELECT 
          u.id,
          u.username,
          u.avatar_url,
          u.role,
          u.icon_type,
          u.verify_icon_type,
          u.is_verified,
          u.bio,
          u.created_at,
          COALESCE((SELECT COUNT(*) FROM user_follows WHERE following_id = u.id), 0) as followers_count,
          0 as is_following
        FROM users u
        WHERE u.id != ?
        ORDER BY RANDOM()
        LIMIT 5
      `, [req.user.userId]);
        }
        else {
            // Has following users, exclude them
            const followingIds = followingUsers.map((f) => f.following_id);
            const placeholders = followingIds.map(() => '?').join(',');
            recommendedUsers = await dbAll(`
        SELECT 
          u.id,
          u.username,
          u.avatar_url,
          u.role,
          u.icon_type,
          u.verify_icon_type,
          u.is_verified,
          u.bio,
          u.created_at,
          COALESCE((SELECT COUNT(*) FROM user_follows WHERE following_id = u.id), 0) as followers_count,
          0 as is_following
        FROM users u
        WHERE u.id != ?
          AND u.id NOT IN (${placeholders})
        ORDER BY RANDOM()
        LIMIT 5
      `, [req.user.userId, ...followingIds]);
        }
        console.log('Recommended users found:', recommendedUsers?.length || 0);
        res.json(recommendedUsers || []);
    }
    catch (error) {
        console.error('Get recommendations error:', error);
        res.status(500).json({ error: 'Server xatosi', details: error.message });
    }
});
// Get user profile - public, but shows follow status if authenticated
router.get('/:username', optionalAuthenticate, async (req, res) => {
    try {
        const { username } = req.params;
        const userId = req.user?.userId || null;
        const user = await dbGet('SELECT id, username, email, avatar_url, is_verified, icon_type, verify_icon_type, bio, created_at FROM users WHERE username = ?', [username]);
        if (!user) {
            return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
        }
        // Get followers and following counts
        const followersCount = await dbGet('SELECT COUNT(*) as count FROM user_follows WHERE following_id = ?', [user.id]);
        const followingCount = await dbGet('SELECT COUNT(*) as count FROM user_follows WHERE follower_id = ?', [user.id]);
        // Check if current user is following this user (only if authenticated)
        let isFollowing = false;
        if (userId) {
            const followCheck = await dbGet('SELECT * FROM user_follows WHERE follower_id = ? AND following_id = ?', [userId, user.id]);
            isFollowing = !!followCheck;
        }
        // Get user repositories
        const repos = await dbAll(`
      SELECT * FROM repositories WHERE owner_id = ? ORDER BY updated_at DESC
    `, [user.id]);
        res.json({
            ...user,
            repositories: repos,
            followers_count: followersCount?.count || 0,
            following_count: followingCount?.count || 0,
            is_following: isFollowing,
            is_own_profile: userId ? user.id === userId : false
        });
    }
    catch (error) {
        console.error('Get user profile error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Update user bio
router.patch('/me/bio', authenticate, async (req, res) => {
    try {
        const { bio } = req.body;
        if (bio && bio.length > 500) {
            return res.status(400).json({ error: 'Bio 500 belgidan oshmasligi kerak' });
        }
        await dbRun('UPDATE users SET bio = ? WHERE id = ?', [bio || null, req.user.userId]);
        const updatedUser = await dbGet('SELECT id, username, email, avatar_url, role, is_verified, icon_type, verify_icon_type, bio, created_at FROM users WHERE id = ?', [req.user.userId]);
        res.json(updatedUser);
    }
    catch (error) {
        console.error('Update bio error:', error);
        res.status(500).json({ error: 'Server xatosi', details: error.message });
    }
});
// Update user profile (username, email, bio, icon_type)
router.patch('/me', authenticate, async (req, res) => {
    try {
        const { username, email, bio, icon_type } = req.body;
        if (!username || !email) {
            return res.status(400).json({ error: 'Username va Email to\'ldirilishi kerak' });
        }
        if (bio && bio.length > 500) {
            return res.status(400).json({ error: 'Bio 500 belgidan oshmasligi kerak' });
        }
        // Check if username is already taken by another user
        const existingUser = await dbGet('SELECT id FROM users WHERE username = ? AND id != ?', [username, req.user.userId]);
        if (existingUser) {
            return res.status(400).json({ error: 'Bu username allaqachon ishlatilgan' });
        }
        // Check if email is already taken by another user
        const existingEmail = await dbGet('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.user.userId]);
        if (existingEmail) {
            return res.status(400).json({ error: 'Bu email allaqachon ishlatilgan' });
        }
        const updates = [];
        const params = [];
        updates.push('username = ?');
        params.push(username);
        updates.push('email = ?');
        params.push(email);
        if (bio !== undefined) {
            updates.push('bio = ?');
            params.push(bio || null);
        }
        if (icon_type !== undefined) {
            updates.push('icon_type = ?');
            params.push(icon_type);
        }
        params.push(req.user.userId);
        await dbRun(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
        const updatedUser = await dbGet('SELECT id, username, email, avatar_url, role, is_verified, icon_type, verify_icon_type, bio, created_at FROM users WHERE id = ?', [req.user.userId]);
        res.json(updatedUser);
    }
    catch (error) {
        console.error('Update user profile error:', error);
        res.status(500).json({ error: 'Server xatosi', details: error.message });
    }
});
// Follow/Unfollow user
router.post('/:username/follow', authenticate, async (req, res) => {
    try {
        const { username } = req.params;
        const targetUser = await dbGet('SELECT id FROM users WHERE username = ?', [username]);
        if (!targetUser) {
            return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
        }
        if (targetUser.id === req.user.userId) {
            return res.status(400).json({ error: 'O\'zingizni follow qila olmaysiz' });
        }
        const existingFollow = await dbGet('SELECT * FROM user_follows WHERE follower_id = ? AND following_id = ?', [req.user.userId, targetUser.id]);
        if (existingFollow) {
            // Unfollow
            await dbRun('DELETE FROM user_follows WHERE follower_id = ? AND following_id = ?', [req.user.userId, targetUser.id]);
            res.json({ following: false });
        }
        else {
            // Follow
            const followId = uuidv4();
            await dbRun('INSERT INTO user_follows (id, follower_id, following_id) VALUES (?, ?, ?)', [followId, req.user.userId, targetUser.id]);
            res.json({ following: true });
        }
    }
    catch (error) {
        console.error('Follow/Unfollow error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Get followers list
router.get('/:username/followers', authenticate, async (req, res) => {
    try {
        const { username } = req.params;
        const user = await dbGet('SELECT id FROM users WHERE username = ?', [username]);
        if (!user) {
            return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
        }
        const followers = await dbAll(`
      SELECT 
        u.id,
        u.username,
        u.avatar_url,
        uf.created_at,
        CASE WHEN current_follow.follower_id IS NOT NULL THEN 1 ELSE 0 END as is_following
      FROM user_follows uf
      JOIN users u ON uf.follower_id = u.id
      LEFT JOIN user_follows current_follow ON current_follow.follower_id = ? AND current_follow.following_id = u.id
      WHERE uf.following_id = ?
      ORDER BY uf.created_at DESC
    `, [req.user.userId, user.id]);
        res.json(followers);
    }
    catch (error) {
        console.error('Get followers error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Get following list
router.get('/:username/following', authenticate, async (req, res) => {
    try {
        const { username } = req.params;
        const user = await dbGet('SELECT id FROM users WHERE username = ?', [username]);
        if (!user) {
            return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
        }
        const following = await dbAll(`
      SELECT 
        u.id,
        u.username,
        u.avatar_url,
        uf.created_at,
        CASE WHEN current_follow.follower_id IS NOT NULL THEN 1 ELSE 0 END as is_following
      FROM user_follows uf
      JOIN users u ON uf.following_id = u.id
      LEFT JOIN user_follows current_follow ON current_follow.follower_id = ? AND current_follow.following_id = u.id
      WHERE uf.follower_id = ?
      ORDER BY uf.created_at DESC
    `, [req.user.userId, user.id]);
        res.json(following);
    }
    catch (error) {
        console.error('Get following error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
export default router;
//# sourceMappingURL=users.js.map