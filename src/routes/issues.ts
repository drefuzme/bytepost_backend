import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, optionalAuthenticate, AuthRequest } from '../middleware/auth.js';
import { dbRun, dbGet, dbAll } from '../database/db.js';
import { createNotification } from './notifications.js';

const router = express.Router();

// Get all issues for a repository
router.get('/:owner/:repo/issues', optionalAuthenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;
    const { status, label, assignee, author } = req.query;

    // Get repository
    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    // Check access for private repos
    if (repository.is_private) {
      const userId = req.user?.userId;
      if (!userId || (repository.owner_id !== userId && !await dbGet('SELECT * FROM repository_collaborators WHERE repository_id = ? AND user_id = ?', [repository.id, userId]))) {
        return res.status(403).json({ error: 'Kirish huquqi yo\'q' });
      }
    }

    // Build query
    let query = `
      SELECT 
        i.*,
        u1.username as author_username,
        u1.avatar_url as author_avatar,
        u1.icon_type as author_icon_type,
        u2.username as assignee_username,
        u2.avatar_url as assignee_avatar,
        u2.icon_type as assignee_icon_type,
        (SELECT COUNT(*) FROM issue_comments WHERE issue_id = i.id) as comments_count
      FROM issues i
      JOIN users u1 ON i.author_id = u1.id
      LEFT JOIN users u2 ON i.assignee_id = u2.id
      WHERE i.repository_id = ?
    `;
    const params: any[] = [repository.id];

    if (status) {
      query += ` AND i.status = ?`;
      params.push(status);
    }

    if (author) {
      query += ` AND u1.username = ?`;
      params.push(author);
    }

    if (assignee) {
      query += ` AND u2.username = ?`;
      params.push(assignee);
    }

    query += ` ORDER BY i.created_at DESC`;

    const issues = await dbAll(query, params);

    // Get labels for each issue
    for (const issue of issues) {
      const labels = await dbAll(`
        SELECT l.* FROM labels l
        JOIN issue_labels il ON l.id = il.label_id
        WHERE il.issue_id = ?
      `, [issue.id]);
      issue.labels = labels;
    }

    res.json(issues);
  } catch (error: any) {
    console.error('Get issues error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get single issue
router.get('/:owner/:repo/issues/:number', optionalAuthenticate, async (req: AuthRequest, res) => {
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

    const issue: any = await dbGet(`
      SELECT 
        i.*,
        u1.username as author_username,
        u1.avatar_url as author_avatar,
        u1.icon_type as author_icon_type,
        u2.username as assignee_username,
        u2.avatar_url as assignee_avatar,
        u2.icon_type as assignee_icon_type
      FROM issues i
      JOIN users u1 ON i.author_id = u1.id
      LEFT JOIN users u2 ON i.assignee_id = u2.id
      WHERE i.repository_id = ? AND i.number = ?
    `, [repository.id, number]);

    if (!issue) {
      return res.status(404).json({ error: 'Issue topilmadi' });
    }

    // Get labels
    const labels = await dbAll(`
      SELECT l.* FROM labels l
      JOIN issue_labels il ON l.id = il.label_id
      WHERE il.issue_id = ?
    `, [issue.id]);
    issue.labels = labels;

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
      WHERE ic.issue_id = ?
      ORDER BY ic.created_at ASC
    `, [issue.id]);
    issue.comments = comments;

    res.json(issue);
  } catch (error: any) {
    console.error('Get issue error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Create issue
router.post('/:owner/:repo/issues', authenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;
    const { title, body, labels } = req.body;

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
      return res.status(403).json({ error: 'Issue yaratish huquqi yo\'q' });
    }

    // Get next issue number
    const lastIssue: any = await dbGet(`
      SELECT number FROM issues WHERE repository_id = ? ORDER BY number DESC LIMIT 1
    `, [repository.id]);
    const nextNumber = lastIssue ? lastIssue.number + 1 : 1;

    const issueId = uuidv4();
    await dbRun(`
      INSERT INTO issues (id, repository_id, number, title, body, author_id, status)
      VALUES (?, ?, ?, ?, ?, ?, 'open')
    `, [issueId, repository.id, nextNumber, title.trim(), body || '', req.user!.userId]);

    // Create notification for repository owner (if not the author)
    if (repository.owner_id !== req.user!.userId) {
      await createNotification(
        repository.owner_id,
        'issue_created',
        `New issue in ${owner}/${repo}`,
        `${req.user!.username} opened issue #${nextNumber}: ${title.trim()}`,
        `/${owner}/${repo}/issues/${nextNumber}`
      );
    }

    // Add labels if provided
    if (labels && Array.isArray(labels)) {
      for (const labelId of labels) {
        const labelExists = await dbGet('SELECT * FROM labels WHERE id = ? AND repository_id = ?', [labelId, repository.id]);
        if (labelExists) {
          await dbRun('INSERT INTO issue_labels (id, issue_id, label_id) VALUES (?, ?, ?)', 
            [uuidv4(), issueId, labelId]);
        }
      }
    }

    const issue: any = await dbGet(`
      SELECT 
        i.*,
        u.username as author_username,
        u.avatar_url as author_avatar
      FROM issues i
      JOIN users u ON i.author_id = u.id
      WHERE i.id = ?
    `, [issueId]);

    issue.labels = [];
    issue.comments = [];

    res.status(201).json(issue);
  } catch (error: any) {
    console.error('Create issue error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Update issue
router.patch('/:owner/:repo/issues/:number', authenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo, number } = req.params;
    const { title, body, status, assignee_id, labels } = req.body;

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    const issue: any = await dbGet(`
      SELECT * FROM issues WHERE repository_id = ? AND number = ?
    `, [repository.id, number]);

    if (!issue) {
      return res.status(404).json({ error: 'Issue topilmadi' });
    }

    // Check permissions (author or repo owner/collaborator)
    const isAuthor = issue.author_id === req.user!.userId;
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
      if (status === 'closed' && issue.status === 'open') {
        updates.push('closed_at = CURRENT_TIMESTAMP');
      } else if (status === 'open' && issue.status === 'closed') {
        updates.push('closed_at = NULL');
      }
    }
    if (assignee_id !== undefined) {
      updates.push('assignee_id = ?');
      params.push(assignee_id || null);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(repository.id, number);

    await dbRun(`
      UPDATE issues SET ${updates.join(', ')}
      WHERE repository_id = ? AND number = ?
    `, params);

    // Update labels if provided
    if (labels !== undefined && Array.isArray(labels)) {
      // Remove all existing labels
      await dbRun('DELETE FROM issue_labels WHERE issue_id = ?', [issue.id]);
      // Add new labels
      for (const labelId of labels) {
        const labelExists = await dbGet('SELECT * FROM labels WHERE id = ? AND repository_id = ?', [labelId, repository.id]);
        if (labelExists) {
          await dbRun('INSERT INTO issue_labels (id, issue_id, label_id) VALUES (?, ?, ?)', 
            [uuidv4(), issue.id, labelId]);
        }
      }
    }

    const updatedIssue: any = await dbGet(`
      SELECT 
        i.*,
        u1.username as author_username,
        u1.avatar_url as author_avatar,
        u2.username as assignee_username,
        u2.avatar_url as assignee_avatar
      FROM issues i
      JOIN users u1 ON i.author_id = u1.id
      LEFT JOIN users u2 ON i.assignee_id = u2.id
      WHERE i.id = ?
    `, [issue.id]);

    const issueLabels = await dbAll(`
      SELECT l.* FROM labels l
      JOIN issue_labels il ON l.id = il.label_id
      WHERE il.issue_id = ?
    `, [issue.id]);
    updatedIssue.labels = issueLabels;

    res.json(updatedIssue);
  } catch (error: any) {
    console.error('Update issue error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Add comment to issue
router.post('/:owner/:repo/issues/:number/comments', authenticate, async (req: AuthRequest, res) => {
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

    const issue: any = await dbGet(`
      SELECT * FROM issues WHERE repository_id = ? AND number = ?
    `, [repository.id, number]);

    if (!issue) {
      return res.status(404).json({ error: 'Issue topilmadi' });
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
      INSERT INTO issue_comments (id, issue_id, user_id, body)
      VALUES (?, ?, ?, ?)
    `, [commentId, issue.id, req.user!.userId, body.trim()]);

    // Update issue updated_at
    await dbRun('UPDATE issues SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [issue.id]);

    // Create notification for issue author (if not the commenter)
    if (issue.author_id !== req.user!.userId) {
      await createNotification(
        issue.author_id,
        'issue_comment',
        `New comment on issue #${issue.number}`,
        `${req.user!.username} commented on your issue: ${issue.title}`,
        `/${owner}/${repo}/issues/${issue.number}`
      );
    }

    // Create notification for repository owner (if not the commenter and not the issue author)
    if (repository.owner_id !== req.user!.userId && repository.owner_id !== issue.author_id) {
      await createNotification(
        repository.owner_id,
        'issue_comment',
        `New comment on issue #${issue.number}`,
        `${req.user!.username} commented on issue #${issue.number} in ${owner}/${repo}`,
        `/${owner}/${repo}/issues/${issue.number}`
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

// Get labels for repository
router.get('/:owner/:repo/labels', optionalAuthenticate, async (req: AuthRequest, res) => {
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

    // Check access
    if (repository.is_private) {
      const userId = req.user?.userId;
      if (!userId || (repository.owner_id !== userId && !await dbGet('SELECT * FROM repository_collaborators WHERE repository_id = ? AND user_id = ?', [repository.id, userId]))) {
        return res.status(403).json({ error: 'Kirish huquqi yo\'q' });
      }
    }

    const labels = await dbAll(`
      SELECT * FROM labels WHERE repository_id = ? ORDER BY name ASC
    `, [repository.id]);

    res.json(labels);
  } catch (error: any) {
    console.error('Get labels error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Create label
router.post('/:owner/:repo/labels', authenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;
    const { name, color, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Label nomi kiritilishi kerak' });
    }

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    // Check permissions (owner or collaborator)
    const hasAccess = repository.owner_id === req.user!.userId || 
      await dbGet('SELECT * FROM repository_collaborators WHERE repository_id = ? AND user_id = ?', 
        [repository.id, req.user!.userId]);

    if (!hasAccess) {
      return res.status(403).json({ error: 'Label yaratish huquqi yo\'q' });
    }

    const labelId = uuidv4();
    await dbRun(`
      INSERT INTO labels (id, repository_id, name, color, description)
      VALUES (?, ?, ?, ?, ?)
    `, [labelId, repository.id, name.trim(), color || '#0366d6', description || '']);

    const label: any = await dbGet('SELECT * FROM labels WHERE id = ?', [labelId]);
    res.status(201).json(label);
  } catch (error: any) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Bu nom bilan label allaqachon mavjud' });
    }
    console.error('Create label error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

export default router;

