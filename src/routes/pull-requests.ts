import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, optionalAuthenticate, AuthRequest } from '../middleware/auth.js';
import { dbRun, dbGet, dbAll } from '../database/db.js';
import { createNotification } from './notifications.js';

const router = express.Router();

// Get all pull requests for a repository
router.get('/:owner/:repo/pulls', optionalAuthenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;
    const { status, label, author } = req.query;

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    // Check access
    if (repository.is_private) {
      const userId = req.user?.userId;
      if (!userId || (repository.owner_id !== userId && !await dbGet('SELECT * FROM repository_collaborators WHERE repository_id = ? AND user_id = ?', [repository.id, userId]))) {
        return res.status(403).json({ error: 'Kirish huquqi yo\'q' });
      }
    }

    let query = `
      SELECT 
        pr.*,
        u.username as author_username,
        u.avatar_url as author_avatar,
        u.icon_type as author_icon_type,
        (SELECT COUNT(*) FROM issue_comments WHERE pull_request_id = pr.id) as comments_count
      FROM pull_requests pr
      JOIN users u ON pr.author_id = u.id
      WHERE pr.repository_id = ?
    `;
    const params: any[] = [repository.id];

    if (status) {
      query += ` AND pr.status = ?`;
      params.push(status);
    }

    if (author) {
      query += ` AND u.username = ?`;
      params.push(author);
    }

    query += ` ORDER BY pr.created_at DESC`;

    const pullRequests = await dbAll(query, params);

    // Get labels for each PR
    for (const pr of pullRequests) {
      const labels = await dbAll(`
        SELECT l.* FROM labels l
        JOIN pull_request_labels prl ON l.id = prl.label_id
        WHERE prl.pull_request_id = ?
      `, [pr.id]);
      pr.labels = labels;
    }

    res.json(pullRequests);
  } catch (error: any) {
    console.error('Get pull requests error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get single pull request
router.get('/:owner/:repo/pulls/:number', optionalAuthenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo, number } = req.params;

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    // Check access
    if (repository.is_private) {
      const userId = req.user?.userId;
      if (!userId || (repository.owner_id !== userId && !await dbGet('SELECT * FROM repository_collaborators WHERE repository_id = ? AND user_id = ?', [repository.id, userId]))) {
        return res.status(403).json({ error: 'Kirish huquqi yo\'q' });
      }
    }

    const pr: any = await dbGet(`
      SELECT 
        pr.*,
        u.username as author_username,
        u.avatar_url as author_avatar,
        u.icon_type as author_icon_type
      FROM pull_requests pr
      JOIN users u ON pr.author_id = u.id
      WHERE pr.repository_id = ? AND pr.number = ?
    `, [repository.id, number]);

    if (!pr) {
      return res.status(404).json({ error: 'Pull request topilmadi' });
    }

    // Get labels
    const labels = await dbAll(`
      SELECT l.* FROM labels l
      JOIN pull_request_labels prl ON l.id = prl.label_id
      WHERE prl.pull_request_id = ?
    `, [pr.id]);
    pr.labels = labels;

    // Get comments
    const comments = await dbAll(`
      SELECT 
        ic.*,
        u.username,
        u.avatar_url,
        u.icon_type,
        u.verify_icon_type,
        u.is_verified,
        u.role
      FROM issue_comments ic
      JOIN users u ON ic.user_id = u.id
      WHERE ic.pull_request_id = ?
      ORDER BY ic.created_at ASC
    `, [pr.id]);
    pr.comments = comments;

    res.json(pr);
  } catch (error: any) {
    console.error('Get pull request error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Create pull request
router.post('/:owner/:repo/pulls', authenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;
    const { title, body, base_branch, head_branch, labels } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title kiritilishi kerak' });
    }

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    // Check access
    const hasAccess = repository.owner_id === req.user!.userId || 
      await dbGet('SELECT * FROM repository_collaborators WHERE repository_id = ? AND user_id = ?', 
        [repository.id, req.user!.userId]);

    if (!hasAccess) {
      return res.status(403).json({ error: 'Pull request yaratish huquqi yo\'q' });
    }

    // Get next PR number
    const lastPR: any = await dbGet(`
      SELECT number FROM pull_requests WHERE repository_id = ? ORDER BY number DESC LIMIT 1
    `, [repository.id]);
    const nextNumber = lastPR ? lastPR.number + 1 : 1;

    const prId = uuidv4();
    await dbRun(`
      INSERT INTO pull_requests (
        id, repository_id, number, title, body, author_id, 
        status, base_branch, head_branch, base_repo_id, head_repo_id
      )
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
    `, [
      prId, repository.id, nextNumber, title.trim(), body || '', req.user!.userId,
      base_branch || 'main', head_branch || 'main', repository.id, repository.id
    ]);

    // Create notification for repository owner (if not the author)
    if (repository.owner_id !== req.user!.userId) {
      await createNotification(
        repository.owner_id,
        'pull_request_created',
        `New pull request in ${owner}/${repo}`,
        `${req.user!.username} opened pull request #${nextNumber}: ${title.trim()}`,
        `/${owner}/${repo}/pulls/${nextNumber}`
      );
    }

    // Add labels if provided
    if (labels && Array.isArray(labels)) {
      for (const labelId of labels) {
        const labelExists = await dbGet('SELECT * FROM labels WHERE id = ? AND repository_id = ?', [labelId, repository.id]);
        if (labelExists) {
          await dbRun('INSERT INTO pull_request_labels (id, pull_request_id, label_id) VALUES (?, ?, ?)', 
            [uuidv4(), prId, labelId]);
        }
      }
    }

    const pr: any = await dbGet(`
      SELECT 
        pr.*,
        u.username as author_username,
        u.avatar_url as author_avatar
      FROM pull_requests pr
      JOIN users u ON pr.author_id = u.id
      WHERE pr.id = ?
    `, [prId]);

    pr.labels = [];
    pr.comments = [];

    res.status(201).json(pr);
  } catch (error: any) {
    console.error('Create pull request error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Update pull request
router.patch('/:owner/:repo/pulls/:number', authenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo, number } = req.params;
    const { title, body, status, labels } = req.body;

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    const pr: any = await dbGet(`
      SELECT * FROM pull_requests WHERE repository_id = ? AND number = ?
    `, [repository.id, number]);

    if (!pr) {
      return res.status(404).json({ error: 'Pull request topilmadi' });
    }

    // Check permissions
    const isAuthor = pr.author_id === req.user!.userId;
    const hasRepoAccess = repository.owner_id === req.user!.userId || 
      await dbGet('SELECT * FROM repository_collaborators WHERE repository_id = ? AND user_id = ?', 
        [repository.id, req.user!.userId]);

    if (!isAuthor && !hasRepoAccess) {
      return res.status(403).json({ error: 'O\'zgartirish huquqi yo\'q' });
    }

    // Update fields
    const updates: string[] = [];
    const params: any[] = [];

    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title.trim());
    }
    if (body !== undefined) {
      updates.push('body = ?');
      params.push(body);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
      if (status === 'merged' && pr.status !== 'merged') {
        updates.push('merged_at = CURRENT_TIMESTAMP');
      } else if (status === 'closed' && pr.status === 'open') {
        updates.push('closed_at = CURRENT_TIMESTAMP');
      } else if (status === 'open' && pr.status === 'closed') {
        updates.push('closed_at = NULL');
        updates.push('merged_at = NULL');
      }
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(repository.id, number);

    await dbRun(`
      UPDATE pull_requests SET ${updates.join(', ')}
      WHERE repository_id = ? AND number = ?
    `, params);

    // Update labels if provided
    if (labels !== undefined && Array.isArray(labels)) {
      await dbRun('DELETE FROM pull_request_labels WHERE pull_request_id = ?', [pr.id]);
      for (const labelId of labels) {
        const labelExists = await dbGet('SELECT * FROM labels WHERE id = ? AND repository_id = ?', [labelId, repository.id]);
        if (labelExists) {
          await dbRun('INSERT INTO pull_request_labels (id, pull_request_id, label_id) VALUES (?, ?, ?)', 
            [uuidv4(), pr.id, labelId]);
        }
      }
    }

    const updatedPR: any = await dbGet(`
      SELECT 
        pr.*,
        u.username as author_username,
        u.avatar_url as author_avatar
      FROM pull_requests pr
      JOIN users u ON pr.author_id = u.id
      WHERE pr.id = ?
    `, [pr.id]);

    const prLabels = await dbAll(`
      SELECT l.* FROM labels l
      JOIN pull_request_labels prl ON l.id = prl.label_id
      WHERE prl.pull_request_id = ?
    `, [pr.id]);
    updatedPR.labels = prLabels;

    res.json(updatedPR);
  } catch (error: any) {
    console.error('Update pull request error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Add comment to pull request
router.post('/:owner/:repo/pulls/:number/comments', authenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo, number } = req.params;
    const { body } = req.body;

    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'Comment matni bo\'sh bo\'lishi mumkin emas' });
    }

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    const pr: any = await dbGet(`
      SELECT * FROM pull_requests WHERE repository_id = ? AND number = ?
    `, [repository.id, number]);

    if (!pr) {
      return res.status(404).json({ error: 'Pull request topilmadi' });
    }

    // Check access
    if (repository.is_private) {
      const hasAccess = repository.owner_id === req.user!.userId || 
        await dbGet('SELECT * FROM repository_collaborators WHERE repository_id = ? AND user_id = ?', 
          [repository.id, req.user!.userId]);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Comment qilish huquqi yo\'q' });
      }
    }

    const commentId = uuidv4();
    await dbRun(`
      INSERT INTO issue_comments (id, pull_request_id, user_id, body)
      VALUES (?, ?, ?, ?)
    `, [commentId, pr.id, req.user!.userId, body.trim()]);

    // Update PR updated_at
    await dbRun('UPDATE pull_requests SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [pr.id]);

    // Create notification for PR author (if not the commenter)
    if (pr.author_id !== req.user!.userId) {
      await createNotification(
        pr.author_id,
        'pull_request_comment',
        `New comment on pull request #${pr.number}`,
        `${req.user!.username} commented on your pull request: ${pr.title}`,
        `/${owner}/${repo}/pulls/${pr.number}`
      );
    }

    // Create notification for repository owner (if not the commenter and not the PR author)
    if (repository.owner_id !== req.user!.userId && repository.owner_id !== pr.author_id) {
      await createNotification(
        repository.owner_id,
        'pull_request_comment',
        `New comment on pull request #${pr.number}`,
        `${req.user!.username} commented on pull request #${pr.number} in ${owner}/${repo}`,
        `/${owner}/${repo}/pulls/${pr.number}`
      );
    }

    const comment: any = await dbGet(`
      SELECT 
        ic.*,
        u.username,
        u.avatar_url
      FROM issue_comments ic
      JOIN users u ON ic.user_id = u.id
      WHERE ic.id = ?
    `, [commentId]);

    res.status(201).json(comment);
  } catch (error: any) {
    console.error('Add comment error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

export default router;

