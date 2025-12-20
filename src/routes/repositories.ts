  import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbRun, dbGet, dbAll } from '../database/db.js';
import { authenticate, optionalAuthenticate, AuthRequest } from '../middleware/auth.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import simpleGit from 'simple-git';
import { mkdir, access } from 'fs/promises';
import { constants } from 'fs';
import { createNotification } from './notifications.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPOS_DIR = join(__dirname, '../../repositories');

// Ensure repos directory exists
mkdir(REPOS_DIR, { recursive: true }).catch(console.error);

// Get all repositories
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const repos = await dbAll(`
      SELECT 
        r.*, 
        u.username as owner_username,
        COUNT(DISTINCT rs.id) as stars_count,
        CASE WHEN user_star.user_id IS NOT NULL THEN 1 ELSE 0 END as is_starred
      FROM repositories r
      JOIN users u ON r.owner_id = u.id
      LEFT JOIN repository_stars rs ON r.id = rs.repository_id
      LEFT JOIN repository_stars user_star ON r.id = user_star.repository_id AND user_star.user_id = ?
      WHERE r.owner_id = ? OR r.id IN (
        SELECT repository_id FROM repository_collaborators WHERE user_id = ?
      )
      GROUP BY r.id
      ORDER BY r.updated_at DESC
    `, [req.user!.userId, req.user!.userId, req.user!.userId]);

    res.json(repos);
  } catch (error: any) {
    console.error('Get repos error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get single repository - public, but shows star status if authenticated
router.get('/:owner/:repo', optionalAuthenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;
    const userId = req.user?.userId || null;

    const repository: any = await dbGet(`
      SELECT 
        r.*, 
        u.username as owner_username,
        (SELECT COUNT(*) FROM repository_stars WHERE repository_id = r.id) as stars_count,
        CASE WHEN (SELECT COUNT(*) FROM repository_stars WHERE repository_id = r.id AND user_id = ?) > 0 THEN 1 ELSE 0 END as is_starred
      FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [userId, owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    // Check access - public repos are accessible to everyone, private repos only to owner/collaborators
    if (repository.is_private) {
      if (!req.user?.userId) {
        return res.status(403).json({ error: 'Kirish huquqi yo\'q - login qiling' });
      }
      
      const hasAccess = repository.owner_id === req.user.userId || 
        await dbGet('SELECT * FROM repository_collaborators WHERE repository_id = ? AND user_id = ?', 
          [repository.id, req.user.userId]);

      if (!hasAccess) {
        return res.status(403).json({ error: 'Kirish huquqi yo\'q' });
      }
    }

    res.json(repository);
  } catch (error: any) {
    console.error('Get repo error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Create repository
router.post('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const { name, description, isPrivate } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Repository nomi kiritilishi kerak' });
    }

    // Check if repo exists
    const existing: any = await dbGet(
      'SELECT * FROM repositories WHERE name = ? AND owner_id = ?',
      [name, req.user!.userId]
    );

    if (existing) {
      return res.status(400).json({ error: 'Bu nom bilan repository allaqachon mavjud' });
    }

    const repoId = uuidv4();
    const repoPath = join(REPOS_DIR, req.user!.username, name);

    // Create repository in database
    await dbRun(
      `INSERT INTO repositories (id, name, description, owner_id, is_private, default_branch)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [repoId, name, description || '', req.user!.userId, isPrivate ? 1 : 0, 'main']
    );

    // Initialize git repository
    await mkdir(repoPath, { recursive: true });
    const git = simpleGit(repoPath);
    await git.init();
    
    // Create initial commit
    await git.addConfig('user.name', req.user!.username);
    await git.addConfig('user.email', req.user!.email);

    res.status(201).json({
      message: 'Repository muvaffaqiyatli yaratildi',
      repository: {
        id: repoId,
        name,
        description,
        owner_username: req.user!.username
      }
    });
  } catch (error: any) {
    console.error('Create repo error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Update repository
router.patch('/:owner/:repo', authenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;
    const { name, description, isPrivate } = req.body;

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    // Check permissions: owner or admin can edit
    const user: any = await dbGet('SELECT role FROM users WHERE id = ?', [req.user!.userId]);
    const isOwner = repository.owner_id === req.user!.userId;
    const isAdmin = user?.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Sizda bu repositoryni o\'zgartirish huquqi yo\'q' });
    }

    // If name is being changed, check if new name already exists
    if (name && name !== repo) {
      const existing: any = await dbGet(
        'SELECT * FROM repositories WHERE name = ? AND owner_id = ? AND id != ?',
        [name, repository.owner_id, repository.id]
      );

      if (existing) {
        return res.status(400).json({ error: 'Bu nom bilan repository allaqachon mavjud' });
      }
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description || '');
    }
    if (isPrivate !== undefined) {
      updates.push('is_private = ?');
      params.push(isPrivate ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Yangilanish uchun ma\'lumot kiritilmagan' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(repository.id);

    await dbRun(`UPDATE repositories SET ${updates.join(', ')} WHERE id = ?`, params);

    const updatedRepo: any = await dbGet(`
      SELECT r.*, u.username as owner_username
      FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE r.id = ?
    `, [repository.id]);

    res.json(updatedRepo);
  } catch (error: any) {
    console.error('Update repo error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Delete repository
router.delete('/:owner/:repo', authenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    // Check permissions: owner or admin can delete
    const user: any = await dbGet('SELECT role FROM users WHERE id = ?', [req.user!.userId]);
    const isOwner = repository.owner_id === req.user!.userId;
    const isAdmin = user?.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Sizda bu repositoryni o\'chirish huquqi yo\'q' });
    }

    await dbRun('DELETE FROM repositories WHERE id = ?', [repository.id]);
    await dbRun('DELETE FROM repository_collaborators WHERE repository_id = ?', [repository.id]);
    await dbRun('DELETE FROM repository_stars WHERE repository_id = ?', [repository.id]);

    res.json({ message: 'Repository muvaffaqiyatli o\'chirildi' });
  } catch (error: any) {
    console.error('Delete repo error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Star/Unstar repository
router.post('/:owner/:repo/star', authenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;

    const repository: any = await dbGet(`
      SELECT r.*, u.username as owner_username
      FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    const existingStar: any = await dbGet(
      'SELECT * FROM repository_stars WHERE repository_id = ? AND user_id = ?',
      [repository.id, req.user!.userId]
    );

    if (existingStar) {
      // Unstar
      await dbRun('DELETE FROM repository_stars WHERE repository_id = ? AND user_id = ?', [
        repository.id,
        req.user!.userId
      ]);
      // Get updated stars count
      const starsCount: any = await dbGet(
        'SELECT COUNT(*) as count FROM repository_stars WHERE repository_id = ?',
        [repository.id]
      );
      res.json({ starred: false, stars_count: starsCount?.count || 0 });
    } else {
      // Star
      const starId = uuidv4();
      await dbRun('INSERT INTO repository_stars (id, repository_id, user_id) VALUES (?, ?, ?)', [
        starId,
        repository.id,
        req.user!.userId
      ]);
      // Get updated stars count
      const starsCount: any = await dbGet(
        'SELECT COUNT(*) as count FROM repository_stars WHERE repository_id = ?',
        [repository.id]
      );
      res.json({ starred: true, stars_count: starsCount?.count || 0 });
    }
  } catch (error: any) {
    console.error('Star repo error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get popular repositories
router.get('/popular', optionalAuthenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId || null;
    const repos = await dbAll(`
      SELECT 
        r.*,
        u.username as owner_username,
        COUNT(rs.id) as stars_count,
        CASE WHEN user_star.user_id IS NOT NULL THEN 1 ELSE 0 END as is_starred
      FROM repositories r
      JOIN users u ON r.owner_id = u.id
      LEFT JOIN repository_stars rs ON r.id = rs.repository_id
      LEFT JOIN repository_stars user_star ON r.id = user_star.repository_id AND user_star.user_id = ?
      WHERE r.is_private = 0
      GROUP BY r.id
      ORDER BY stars_count DESC, r.created_at DESC
      LIMIT 10
    `, [userId]);

    res.json(repos);
  } catch (error: any) {
    console.error('Get popular repos error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get starred repositories
router.get('/starred', authenticate, async (req: AuthRequest, res) => {
  try {
    const repos = await dbAll(`
      SELECT 
        r.*,
        u.username as owner_username,
        COUNT(DISTINCT rs.id) as stars_count,
        1 as is_starred
      FROM repositories r
      JOIN users u ON r.owner_id = u.id
      JOIN repository_stars rs ON r.id = rs.repository_id
      WHERE rs.user_id = ?
      GROUP BY r.id
      ORDER BY rs.created_at DESC
    `, [req.user!.userId]);

    res.json(repos);
  } catch (error: any) {
    console.error('Get starred repos error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get repository collaborators
router.get('/:owner/:repo/collaborators', authenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    // Only owner can view collaborators
    if (repository.owner_id !== req.user!.userId) {
      return res.status(403).json({ error: 'Faqat repository egasi collaborator\'larni ko\'ra oladi' });
    }

    const collaborators = await dbAll(`
      SELECT 
        rc.*,
        u.id as user_id,
        u.username,
        u.email,
        u.role,
        u.is_verified,
        u.icon_type,
        u.verify_icon_type
      FROM repository_collaborators rc
      JOIN users u ON rc.user_id = u.id
      WHERE rc.repository_id = ?
      ORDER BY rc.created_at DESC
    `, [repository.id]);

    res.json(collaborators);
  } catch (error: any) {
    console.error('Get collaborators error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Add collaborator to repository
router.post('/:owner/:repo/collaborators', authenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;
    const { username, permission = 'write' } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username kiritilishi kerak' });
    }

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    // Only owner can add collaborators
    if (repository.owner_id !== req.user!.userId) {
      return res.status(403).json({ error: 'Faqat repository egasi collaborator qo\'sha oladi' });
    }

    // Find user by username
    const userToAdd: any = await dbGet(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );

    if (!userToAdd) {
      return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    }

    // Can't add owner as collaborator
    if (userToAdd.id === repository.owner_id) {
      return res.status(400).json({ error: 'Repository egasini collaborator sifatida qo\'shib bo\'lmaydi' });
    }

    // Check if already a collaborator
    const existing: any = await dbGet(
      'SELECT * FROM repository_collaborators WHERE repository_id = ? AND user_id = ?',
      [repository.id, userToAdd.id]
    );

    if (existing) {
      return res.status(400).json({ error: 'Bu foydalanuvchi allaqachon collaborator' });
    }

    // Add collaborator
    const collaboratorId = uuidv4();
    await dbRun(
      `INSERT INTO repository_collaborators (id, repository_id, user_id, permission)
       VALUES (?, ?, ?, ?)`,
      [collaboratorId, repository.id, userToAdd.id, permission]
    );

    // Get owner info for notification and chat
    const ownerInfo: any = await dbGet(
      'SELECT username, id FROM users WHERE id = ?',
      [repository.owner_id]
    );

    console.log('Adding collaborator:', {
      repositoryName: repository.name,
      ownerId: repository.owner_id,
      ownerUsername: ownerInfo?.username,
      collaboratorId: userToAdd.id,
      collaboratorUsername: userToAdd.username
    });

    // 1. Create notification for the new collaborator
    try {
      const notificationId = await createNotification(
        userToAdd.id,
        'collaborator_invite',
        `Sizga repository'ga collaborator sifatida taklif yuborildi`,
        `${ownerInfo?.username || 'Foydalanuvchi'} sizni "${repository.name}" repository'siga collaborator sifatida qo'shdi. Endi siz bu repository'ga push qilish va fayllarni edit qilish huquqiga egasiz.`,
        `/${ownerInfo?.username || ''}/${repository.name}`
      );
      console.log(`✅ Notification created for collaborator: ${notificationId}`);
    } catch (notifError: any) {
      console.error('❌ Error creating notification:', notifError);
      // Continue even if notification fails
    }

    // 2. Create or get conversation between owner and new collaborator
    let conversationId: string | null = null;
    try {
      console.log('Creating/getting conversation between owner and collaborator...');
      
      // Check if conversation already exists
      const existingConv: any = await dbGet(`
        SELECT c.id
        FROM conversations c
        INNER JOIN conversation_participants cp1 ON c.id = cp1.conversation_id
        INNER JOIN conversation_participants cp2 ON c.id = cp2.conversation_id
        WHERE cp1.user_id = ? AND cp2.user_id = ? AND c.type = 'direct'
        LIMIT 1
      `, [repository.owner_id, userToAdd.id]);

      if (existingConv) {
        conversationId = existingConv.id;
        console.log(`✅ Existing conversation found: ${conversationId}`);
      } else {
        // Create new conversation
        conversationId = uuidv4();
        await dbRun(
          'INSERT INTO conversations (id, type) VALUES (?, ?)',
          [conversationId, 'direct']
        );
        console.log(`✅ New conversation created: ${conversationId}`);

        // Add participants
        const participant1Id = uuidv4();
        const participant2Id = uuidv4();
        await dbRun(
          'INSERT INTO conversation_participants (id, conversation_id, user_id) VALUES (?, ?, ?)',
          [participant1Id, conversationId, repository.owner_id]
        );
        await dbRun(
          'INSERT INTO conversation_participants (id, conversation_id, user_id) VALUES (?, ?, ?)',
          [participant2Id, conversationId, userToAdd.id]
        );
        console.log(`✅ Participants added to conversation: owner=${repository.owner_id}, collaborator=${userToAdd.id}`);
      }

      // 3. Send welcome message from owner to new collaborator
      const messageId = uuidv4();
      const welcomeMessage = `Salom! Men sizni "${repository.name}" repository'siga collaborator sifatida qo'shdim. Endi siz bu repository'ga push qilish va fayllarni edit qilish huquqiga egasiz. Repository: /${ownerInfo?.username || ''}/${repository.name}`;
      
      await dbRun(
        'INSERT INTO messages (id, conversation_id, sender_id, content) VALUES (?, ?, ?, ?)',
        [messageId, conversationId, repository.owner_id, welcomeMessage]
      );
      console.log(`✅ Welcome message created: ${messageId}`);

      // Update conversation updated_at
      await dbRun(
        'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [conversationId]
      );

      console.log(`✅ Chat message sent to collaborator ${userToAdd.username} from owner ${ownerInfo?.username}`);
    } catch (chatError: any) {
      console.error('❌ Error creating chat conversation/message:', chatError);
      console.error('Chat error details:', {
        message: chatError.message,
        stack: chatError.stack,
        ownerId: repository.owner_id,
        collaboratorId: userToAdd.id
      });
      // Don't fail the request if chat fails
    }

    console.log('✅ Collaborator added successfully:', {
      collaboratorId,
      username: userToAdd.username,
      repositoryName: repository.name
    });

    res.json({
      message: 'Collaborator muvaffaqiyatli qo\'shildi',
      collaborator: {
        id: collaboratorId,
        username: userToAdd.username,
        email: userToAdd.email,
        permission
      }
    });
  } catch (error: any) {
    console.error('Add collaborator error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Remove collaborator from repository
router.delete('/:owner/:repo/collaborators/:userId', authenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo, userId } = req.params;

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    // Only owner can remove collaborators
    if (repository.owner_id !== req.user!.userId) {
      return res.status(403).json({ error: 'Faqat repository egasi collaborator\'ni o\'chira oladi' });
    }

    // Remove collaborator
    await dbRun(
      'DELETE FROM repository_collaborators WHERE repository_id = ? AND user_id = ?',
      [repository.id, userId]
    );

    res.json({ message: 'Collaborator muvaffaqiyatli o\'chirildi' });
  } catch (error: any) {
    console.error('Remove collaborator error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Activity endpoints for dashboard
router.get('/activity/issues', optionalAuthenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    let query = `
      SELECT 
        i.*,
        r.name as repo_name,
        u1.username as owner_username,
        u2.username as author_username,
        u2.avatar_url as author_avatar,
        u2.icon_type as author_icon_type
      FROM issues i
      JOIN repositories r ON i.repository_id = r.id
      JOIN users u1 ON r.owner_id = u1.id
      JOIN users u2 ON i.author_id = u2.id
      WHERE 1=1
    `;
    const params: any[] = [];

    // If authenticated, show issues from user's repos and collaborated repos
    if (userId) {
      query += ` AND (
        r.owner_id = ? OR 
        r.id IN (SELECT repository_id FROM repository_collaborators WHERE user_id = ?) OR
        r.is_private = 0
      )`;
      params.push(userId, userId);
    } else {
      // If not authenticated, only show public repos
      query += ` AND r.is_private = 0`;
    }

    query += ` ORDER BY i.created_at DESC LIMIT 20`;

    const issues = await dbAll(query, params);
    res.json(issues);
  } catch (error: any) {
    console.error('Get activity issues error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

router.get('/activity/pulls', optionalAuthenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    let query = `
      SELECT 
        pr.*,
        r.name as repo_name,
        u1.username as owner_username,
        u2.username as author_username,
        u2.avatar_url as author_avatar,
        u2.icon_type as author_icon_type
      FROM pull_requests pr
      JOIN repositories r ON pr.repository_id = r.id
      JOIN users u1 ON r.owner_id = u1.id
      JOIN users u2 ON pr.author_id = u2.id
      WHERE 1=1
    `;
    const params: any[] = [];

    // If authenticated, show PRs from user's repos and collaborated repos
    if (userId) {
      query += ` AND (
        r.owner_id = ? OR 
        r.id IN (SELECT repository_id FROM repository_collaborators WHERE user_id = ?) OR
        r.is_private = 0
      )`;
      params.push(userId, userId);
    } else {
      // If not authenticated, only show public repos
      query += ` AND r.is_private = 0`;
    }

    query += ` ORDER BY pr.created_at DESC LIMIT 20`;

    const pullRequests = await dbAll(query, params);
    res.json(pullRequests);
  } catch (error: any) {
    console.error('Get activity pulls error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

router.get('/activity/commits', optionalAuthenticate, async (req: AuthRequest, res) => {
  try {
    // For now, return empty array as we don't have a commits table
    // This can be enhanced later to track commits
    res.json([]);
  } catch (error: any) {
    console.error('Get activity commits error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

export default router;

