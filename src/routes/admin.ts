import express from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { dbGet, dbAll, dbRun } from '../database/db.js';

const router = express.Router();

// All admin routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

// Get dashboard statistics
router.get('/stats', async (req: AuthRequest, res) => {
  try {
    const [
      totalUsers,
      totalRepos,
      totalPosts,
      totalIssues,
      totalPRs,
      totalStars,
      recentUsers,
      recentRepos
    ] = await Promise.all([
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
  } catch (error: any) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get user detail with all information
router.get('/users/:userId/detail', async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;

    // Get user info
    const user: any = await dbGet(
      'SELECT id, username, email, role, avatar_url, is_banned, ban_reason, banned_at, last_active, is_verified, icon_type, verify_icon_type, bio, created_at FROM users WHERE id = ?',
      [userId]
    );

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
  } catch (error: any) {
    console.error('Admin user detail error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get all users with pagination
router.get('/users', async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string || '';
    const offset = (page - 1) * limit;

    let query = 'SELECT id, username, email, role, avatar_url, is_banned, is_verified, icon_type, verify_icon_type, bio, last_active, created_at FROM users';
    let countQuery = 'SELECT COUNT(*) as count FROM users';
    const params: any[] = [];

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
      users: users.map((u: any) => ({ ...u, is_banned: u.is_banned === 1, is_verified: u.is_verified === 1 })),
      pagination: {
        page,
        limit,
        total: totalResult?.count || 0,
        totalPages: Math.ceil((totalResult?.count || 0) / limit)
      }
    });
  } catch (error: any) {
    console.error('Admin users error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Update user role by userId
router.patch('/users/:userId/role', async (req: AuthRequest, res) => {
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

    const updatedUser: any = await dbGet(
      'SELECT id, username, email, role, avatar_url, created_at FROM users WHERE id = ?',
      [userId]
    );

    await logAdminActivity(
      req.user!.userId,
      'UPDATE_USER_ROLE',
      'user',
      userId,
      `Changed role to ${role}`,
      req
    );

    res.json({ message: 'Foydalanuvchi roli yangilandi', user: updatedUser });
  } catch (error: any) {
    console.error('Admin update user role error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Update user role by email
router.patch('/users/email/:email/role', async (req: AuthRequest, res) => {
  try {
    const { email } = req.params;
    const { role } = req.body;

    if (!role || !['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Yaroqsiz rol' });
    }

    // Get user by email
    const user: any = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    }

    // Prevent self-demotion
    if (user.id === req.user?.userId && role !== 'admin') {
      return res.status(400).json({ error: 'O\'zingizning admin huquqingizni olib tashlay olmaysiz' });
    }

    await dbRun('UPDATE users SET role = ? WHERE email = ?', [role, email]);

    const updatedUser: any = await dbGet(
      'SELECT id, username, email, role, avatar_url, is_verified, created_at FROM users WHERE email = ?',
      [email]
    );

    res.json({ message: 'Foydalanuvchi roli yangilandi', user: updatedUser });
  } catch (error: any) {
    console.error('Admin update user role by email error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Update user (username, email, icon_type, verify_icon_type)
router.patch('/users/:userId', async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;
    const { username, email, icon_type, verify_icon_type, bio } = req.body;

    const updates: string[] = [];
    const params: any[] = [];

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

    const updatedUser: any = await dbGet(
      'SELECT id, username, email, role, avatar_url, is_verified, icon_type, verify_icon_type, bio, created_at FROM users WHERE id = ?',
      [userId]
    );

    console.log('Updated user:', updatedUser);
    res.json({ message: 'Foydalanuvchi yangilandi', user: updatedUser });
  } catch (error: any) {
    console.error('Admin update user error:', error);
    res.status(500).json({ error: 'Server xatosi', details: error.message });
  }
});

// Verify/Unverify user
router.patch('/users/:userId/verify', async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;
    const { verified } = req.body;

    await dbRun(
      'UPDATE users SET is_verified = ? WHERE id = ?',
      [verified ? 1 : 0, userId]
    );

    const updatedUser: any = await dbGet(
      'SELECT id, username, email, role, avatar_url, is_verified, icon_type, created_at FROM users WHERE id = ?',
      [userId]
    );

    res.json({
      message: verified ? 'Foydalanuvchi verify qilindi' : 'Foydalanuvchi verify\'dan olindi',
      user: { ...updatedUser, is_verified: updatedUser.is_verified === 1 }
    });
  } catch (error: any) {
    console.error('Admin verify user error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Ban/Unban user
router.patch('/users/:userId/ban', async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;
    const { banned, reason } = req.body;

    // Prevent self-ban
    if (userId === req.user?.userId) {
      return res.status(400).json({ error: 'O\'zingizni ban qila olmaysiz' });
    }

    if (banned) {
      await dbRun(
        'UPDATE users SET is_banned = 1, ban_reason = ?, banned_at = CURRENT_TIMESTAMP WHERE id = ?',
        [reason || 'Admin tomonidan ban qilindi', userId]
      );
      await logAdminActivity(
        req.user!.userId,
        'BAN_USER',
        'user',
        userId,
        `Banned user. Reason: ${reason || 'No reason provided'}`,
        req
      );
    } else {
      await dbRun(
        'UPDATE users SET is_banned = 0, ban_reason = NULL, banned_at = NULL WHERE id = ?',
        [userId]
      );
      await logAdminActivity(
        req.user!.userId,
        'UNBAN_USER',
        'user',
        userId,
        'Unbanned user',
        req
      );
    }

    const updatedUser: any = await dbGet(
      'SELECT id, username, email, role, avatar_url, is_banned, ban_reason, banned_at, created_at FROM users WHERE id = ?',
      [userId]
    );

    res.json({
      message: banned ? 'Foydalanuvchi ban qilindi' : 'Foydalanuvchi ban\'dan olindi',
      user: { ...updatedUser, is_banned: updatedUser.is_banned === 1 }
    });
  } catch (error: any) {
    console.error('Admin ban user error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Delete user
router.delete('/users/:userId', async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;

    // Prevent self-deletion
    if (userId === req.user?.userId) {
      return res.status(400).json({ error: 'O\'zingizni o\'chira olmaysiz' });
    }

    const userToDelete: any = await dbGet('SELECT username, email FROM users WHERE id = ?', [userId]);
    
    await dbRun('DELETE FROM users WHERE id = ?', [userId]);

    await logAdminActivity(
      req.user!.userId,
      'DELETE_USER',
      'user',
      userId,
      `Deleted user: ${userToDelete?.username || userId}`,
      req
    );

    res.json({ message: 'Foydalanuvchi o\'chirildi' });
  } catch (error: any) {
    console.error('Admin delete user error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get all repositories with pagination
router.get('/repositories', async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string || '';
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
    const params: any[] = [];

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
  } catch (error: any) {
    console.error('Admin repositories error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Update repository
router.patch('/repositories/:repoId', async (req: AuthRequest, res) => {
  try {
    const { repoId } = req.params;
    const { name, description, is_private } = req.body;

    const updates: string[] = [];
    const params: any[] = [];

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

    const updatedRepo: any = await dbGet(`
      SELECT r.id, r.name, r.description, r.is_private, r.default_branch,
             r.created_at, r.updated_at,
             u.username as owner_username, u.id as owner_id
      FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE r.id = ?
    `, [repoId]);

    res.json({ message: 'Repository yangilandi', repository: updatedRepo });
  } catch (error: any) {
    console.error('Admin update repository error:', error);
    res.status(500).json({ error: 'Server xatosi', details: error.message });
  }
});

// Delete repository
router.delete('/repositories/:repoId', async (req: AuthRequest, res) => {
  try {
    const { repoId } = req.params;

    const repoToDelete: any = await dbGet('SELECT name FROM repositories WHERE id = ?', [repoId]);
    
    await dbRun('DELETE FROM repositories WHERE id = ?', [repoId]);

    await logAdminActivity(
      req.user!.userId,
      'DELETE_REPOSITORY',
      'repository',
      repoId,
      `Deleted repository: ${repoToDelete?.name || repoId}`,
      req
    );

    res.json({ message: 'Repository o\'chirildi' });
  } catch (error: any) {
    console.error('Admin delete repository error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get all posts with pagination
router.get('/posts', async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string || '';
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
    const params: any[] = [];

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
  } catch (error: any) {
    console.error('Admin posts error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Update post
router.patch('/posts/:postId', async (req: AuthRequest, res) => {
  try {
    const { postId } = req.params;
    const { content } = req.body;

    const updates: string[] = [];
    const params: any[] = [];

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

    const updatedPost: any = await dbGet(`
      SELECT p.id, p.content, p.created_at, p.updated_at,
             u.username as author_username, u.id as author_id
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `, [postId]);

    res.json({ message: 'Post yangilandi', post: updatedPost });
  } catch (error: any) {
    console.error('Admin update post error:', error);
    res.status(500).json({ error: 'Server xatosi', details: error.message });
  }
});

// Delete post
router.delete('/posts/:postId', async (req: AuthRequest, res) => {
  try {
    const { postId } = req.params;

    const postToDelete: any = await dbGet('SELECT id FROM posts WHERE id = ?', [postId]);
    
    await dbRun('DELETE FROM posts WHERE id = ?', [postId]);

    await logAdminActivity(
      req.user!.userId,
      'DELETE_POST',
      'post',
      postId,
      `Deleted post: ${postId}`,
      req
    );

    res.json({ message: 'Post o\'chirildi' });
  } catch (error: any) {
    console.error('Admin delete post error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get all issues with pagination
router.get('/issues', async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string || '';
    const status = req.query.status as string || '';
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
    const params: any[] = [];
    const conditions: string[] = [];

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
  } catch (error: any) {
    console.error('Admin issues error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Delete issue
router.delete('/issues/:issueId', async (req: AuthRequest, res) => {
  try {
    const { issueId } = req.params;
    await dbRun('DELETE FROM issues WHERE id = ?', [issueId]);
    res.json({ message: 'Issue o\'chirildi' });
  } catch (error: any) {
    console.error('Admin delete issue error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get all pull requests with pagination
router.get('/pull-requests', async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string || '';
    const status = req.query.status as string || '';
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
    const params: any[] = [];
    const conditions: string[] = [];

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
  } catch (error: any) {
    console.error('Admin pull requests error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Delete pull request
router.delete('/pull-requests/:prId', async (req: AuthRequest, res) => {
  try {
    const { prId } = req.params;
    await dbRun('DELETE FROM pull_requests WHERE id = ?', [prId]);
    res.json({ message: 'Pull Request o\'chirildi' });
  } catch (error: any) {
    console.error('Admin delete pull request error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Helper function to log admin activity
async function logAdminActivity(
  adminId: string,
  action: string,
  targetType: string | null,
  targetId: string | null,
  details: string | null,
  req: AuthRequest
) {
  try {
    const { v4: uuidv4 } = await import('uuid');
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    await dbRun(
      `INSERT INTO admin_activity_logs (id, admin_id, action, target_type, target_id, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), adminId, action, targetType, targetId, details, ipAddress, userAgent]
    );
  } catch (error) {
    console.error('Error logging admin activity:', error);
  }
}

// Get activity logs
router.get('/activity-logs', async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    const logs = await dbAll(`
      SELECT 
        l.*,
        u.username as admin_username,
        u.email as admin_email
      FROM admin_activity_logs l
      JOIN users u ON l.admin_id = u.id
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    const total = await dbGet('SELECT COUNT(*) as count FROM admin_activity_logs');

    res.json({
      logs,
      pagination: {
        page,
        limit,
        total: total?.count || 0,
        totalPages: Math.ceil((total?.count || 0) / limit)
      }
    });
  } catch (error: any) {
    console.error('Admin activity logs error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get system settings
router.get('/settings', async (req: AuthRequest, res) => {
  try {
    const settings = await dbAll('SELECT * FROM system_settings ORDER BY key');
    const settingsObj: any = {};
    settings.forEach((s: any) => {
      settingsObj[s.key] = {
        value: s.value,
        description: s.description,
        updated_at: s.updated_at,
        updated_by: s.updated_by
      };
    });
    res.json(settingsObj);
  } catch (error: any) {
    console.error('Admin get settings error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Update system settings
router.patch('/settings', async (req: AuthRequest, res) => {
  try {
    const { key, value } = req.body;

    if (!key || value === undefined) {
      return res.status(400).json({ error: 'Key va value kiritilishi kerak' });
    }

    await dbRun(
      `INSERT INTO system_settings (key, value, updated_by, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_by = excluded.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
      [key, value, req.user!.userId]
    );

    await logAdminActivity(
      req.user!.userId,
      'UPDATE_SETTING',
      'system_setting',
      key,
      `Updated ${key} to ${value}`,
      req
    );

    res.json({ message: 'Sozlama yangilandi' });
  } catch (error: any) {
    console.error('Admin update settings error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get advanced statistics
router.get('/statistics/advanced', async (req: AuthRequest, res) => {
  try {
    const period = req.query.period as string || '7'; // days
    
    // User growth
    const userGrowth = await dbAll(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM users
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY DATE(created_at)
      ORDER BY date
    `, [period]);

    // Repository growth
    const repoGrowth = await dbAll(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM repositories
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY DATE(created_at)
      ORDER BY date
    `, [period]);

    // Post growth
    const postGrowth = await dbAll(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM posts
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY DATE(created_at)
      ORDER BY date
    `, [period]);

    // Active users (last 30 days)
    const activeUsers = await dbGet(`
      SELECT COUNT(DISTINCT user_id) as count
      FROM (
        SELECT user_id FROM posts WHERE created_at >= datetime('now', '-30 days')
        UNION
        SELECT owner_id as user_id FROM repositories WHERE updated_at >= datetime('now', '-30 days')
        UNION
        SELECT author_id as user_id FROM issues WHERE created_at >= datetime('now', '-30 days')
      )
    `);

    // Top repositories by stars
    const topRepos = await dbAll(`
      SELECT 
        r.id, r.name, r.description,
        u.username as owner_username,
        COUNT(rs.id) as stars_count
      FROM repositories r
      JOIN users u ON r.owner_id = u.id
      LEFT JOIN repository_stars rs ON r.id = rs.repository_id
      GROUP BY r.id
      ORDER BY stars_count DESC
      LIMIT 10
    `);

    // Top users by activity
    const topUsers = await dbAll(`
      SELECT 
        u.id, u.username, u.email,
        (SELECT COUNT(*) FROM repositories WHERE owner_id = u.id) as repos_count,
        (SELECT COUNT(*) FROM posts WHERE user_id = u.id) as posts_count,
        (SELECT COUNT(*) FROM issues WHERE author_id = u.id) as issues_count
      FROM users u
      ORDER BY (repos_count + posts_count + issues_count) DESC
      LIMIT 10
    `);

    res.json({
      userGrowth,
      repoGrowth,
      postGrowth,
      activeUsers: activeUsers?.count || 0,
      topRepos,
      topUsers
    });
  } catch (error: any) {
    console.error('Admin advanced statistics error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get email whitelist
router.get('/email-whitelist', async (req: AuthRequest, res) => {
  try {
    const whitelist = await dbAll('SELECT * FROM email_whitelist ORDER BY email_domain');
    res.json({ whitelist });
  } catch (error: any) {
    console.error('Admin get email whitelist error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Add email domain to whitelist
router.post('/email-whitelist', async (req: AuthRequest, res) => {
  try {
    const { email_domain, description } = req.body;

    if (!email_domain) {
      return res.status(400).json({ error: 'Email domeni kiritilishi kerak' });
    }

    // Normalize domain (lowercase, remove @ if present)
    const normalizedDomain = email_domain.toLowerCase().replace('@', '');

    const { v4: uuidv4 } = await import('uuid');
    await dbRun(
      'INSERT INTO email_whitelist (id, email_domain, description, created_by) VALUES (?, ?, ?, ?)',
      [uuidv4(), normalizedDomain, description || null, req.user!.userId]
    );

    await logAdminActivity(
      req.user!.userId,
      'ADD_EMAIL_WHITELIST',
      'email_whitelist',
      normalizedDomain,
      `Added email domain to whitelist: ${normalizedDomain}`,
      req
    );

    res.json({ message: 'Email domeni whitelist-ga qo\'shildi' });
  } catch (error: any) {
    if (error.message.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: 'Bu email domeni allaqachon whitelist-da mavjud' });
    }
    console.error('Admin add email whitelist error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Delete email domain from whitelist
router.delete('/email-whitelist/:domain', async (req: AuthRequest, res) => {
  try {
    const { domain } = req.params;
    const normalizedDomain = decodeURIComponent(domain).toLowerCase().replace('@', '');

    await dbRun('DELETE FROM email_whitelist WHERE email_domain = ?', [normalizedDomain]);

    await logAdminActivity(
      req.user!.userId,
      'DELETE_EMAIL_WHITELIST',
      'email_whitelist',
      normalizedDomain,
      `Removed email domain from whitelist: ${normalizedDomain}`,
      req
    );

    res.json({ message: 'Email domeni whitelist-dan olib tashlandi' });
  } catch (error: any) {
    console.error('Admin delete email whitelist error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

export default router;

