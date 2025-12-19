import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, optionalAuthenticate, AuthRequest } from '../middleware/auth.js';
import { dbRun, dbGet, dbAll } from '../database/db.js';
import { createNotification } from './notifications.js';

const router = express.Router();

// Get all posts (feed) - public, but shows like/repost status if authenticated
router.get('/', optionalAuthenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId || null;
    const posts = await dbAll(`
      SELECT 
        p.*,
        u.username,
        u.avatar_url,
        u.icon_type,
        u.verify_icon_type,
        u.is_verified,
        u.role,
        CASE WHEN pl.user_id IS NOT NULL THEN 1 ELSE 0 END as is_liked,
        CASE WHEN pr.user_id IS NOT NULL THEN 1 ELSE 0 END as is_reposted
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN post_likes pl ON p.id = pl.post_id AND pl.user_id = ?
      LEFT JOIN post_reposts pr ON p.id = pr.post_id AND pr.user_id = ?
      ORDER BY p.created_at DESC
      LIMIT 50
    `, [userId, userId]);

    res.json(posts);
  } catch (error: any) {
    console.error('Get posts error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get single post - public, but shows like/repost status if authenticated
router.get('/:id', optionalAuthenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || null;
    
    const post: any = await dbGet(`
      SELECT 
        p.*,
        u.username,
        u.avatar_url,
        u.icon_type,
        u.verify_icon_type,
        u.is_verified,
        u.role,
        CASE WHEN pl.user_id IS NOT NULL THEN 1 ELSE 0 END as is_liked,
        CASE WHEN pr.user_id IS NOT NULL THEN 1 ELSE 0 END as is_reposted
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN post_likes pl ON p.id = pl.post_id AND pl.user_id = ?
      LEFT JOIN post_reposts pr ON p.id = pr.post_id AND pr.user_id = ?
      WHERE p.id = ?
    `, [userId, userId, id]);

    if (!post) {
      return res.status(404).json({ error: 'Post topilmadi' });
    }

    res.json(post);
  } catch (error: any) {
    console.error('Get post error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Create post
router.post('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const { content, imageUrl } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Post matni kiritilishi kerak' });
    }

    if (content.length > 2000) {
      return res.status(400).json({ error: 'Post matni 2000 belgidan oshmasligi kerak' });
    }

    const postId = uuidv4();

    await dbRun(
      `INSERT INTO posts (id, user_id, content, image_url) VALUES (?, ?, ?, ?)`,
      [postId, req.user!.userId, content.trim(), imageUrl || null]
    );

    const post: any = await dbGet(`
      SELECT 
        p.*,
        u.username,
        u.avatar_url,
        u.icon_type,
        u.verify_icon_type,
        u.is_verified,
        u.role,
        0 as is_liked,
        0 as is_reposted
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `, [postId]);

    res.status(201).json(post);
  } catch (error: any) {
    console.error('Create post error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Update post
router.patch('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { content, imageUrl } = req.body;

    const post: any = await dbGet('SELECT * FROM posts WHERE id = ?', [id]);

    if (!post) {
      return res.status(404).json({ error: 'Post topilmadi' });
    }

    // Check permissions: user can edit own posts, admin can edit all posts
    const user: any = await dbGet('SELECT role FROM users WHERE id = ?', [req.user!.userId]);
    const isOwner = post.user_id === req.user!.userId;
    const isAdmin = user?.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Sizda bu postni o\'zgartirish huquqi yo\'q' });
    }

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Post matni kiritilishi kerak' });
    }

    if (content.length > 2000) {
      return res.status(400).json({ error: 'Post matni 2000 belgidan oshmasligi kerak' });
    }

    await dbRun(
      'UPDATE posts SET content = ?, image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [content.trim(), imageUrl || null, id]
    );

    const updatedPost: any = await dbGet(`
      SELECT 
        p.*,
        u.username,
        u.avatar_url,
        u.icon_type,
        u.verify_icon_type,
        u.is_verified,
        u.role,
        CASE WHEN pl.user_id IS NOT NULL THEN 1 ELSE 0 END as is_liked,
        CASE WHEN pr.user_id IS NOT NULL THEN 1 ELSE 0 END as is_reposted
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN post_likes pl ON p.id = pl.post_id AND pl.user_id = ?
      LEFT JOIN post_reposts pr ON p.id = pr.post_id AND pr.user_id = ?
      WHERE p.id = ?
    `, [req.user!.userId, req.user!.userId, id]);

    res.json(updatedPost);
  } catch (error: any) {
    console.error('Update post error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Delete post
router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const post: any = await dbGet('SELECT * FROM posts WHERE id = ?', [id]);

    if (!post) {
      return res.status(404).json({ error: 'Post topilmadi' });
    }

    // Check permissions: user can delete own posts, admin can delete all posts
    const user: any = await dbGet('SELECT role FROM users WHERE id = ?', [req.user!.userId]);
    const isOwner = post.user_id === req.user!.userId;
    const isAdmin = user?.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Sizda bu postni o\'chirish huquqi yo\'q' });
    }

    await dbRun('DELETE FROM posts WHERE id = ?', [id]);

    res.json({ message: 'Post muvaffaqiyatli o\'chirildi' });
  } catch (error: any) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Like/Unlike post
router.post('/:id/like', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const post: any = await dbGet('SELECT * FROM posts WHERE id = ?', [id]);
    if (!post) {
      return res.status(404).json({ error: 'Post topilmadi' });
    }

    const existingLike: any = await dbGet(
      'SELECT * FROM post_likes WHERE post_id = ? AND user_id = ?',
      [id, req.user!.userId]
    );

    if (existingLike) {
      // Unlike
      await dbRun('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [id, req.user!.userId]);
      await dbRun('UPDATE posts SET likes_count = likes_count - 1 WHERE id = ?', [id]);
      res.json({ liked: false });
    } else {
      // Like
      const likeId = uuidv4();
      await dbRun('INSERT INTO post_likes (id, post_id, user_id) VALUES (?, ?, ?)', [
        likeId,
        id,
        req.user!.userId
      ]);
      await dbRun('UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?', [id]);

      // Create notification for post author (if not the liker)
      if (post.user_id !== req.user!.userId) {
        await createNotification(
          post.user_id,
          'post_like',
          'New like on your post',
          `${req.user!.username} liked your post`,
          `/blog/post/${id}`
        );
      }

      res.json({ liked: true });
    }
  } catch (error: any) {
    console.error('Like post error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Repost/Unrepost
router.post('/:id/repost', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const post: any = await dbGet('SELECT * FROM posts WHERE id = ?', [id]);
    if (!post) {
      return res.status(404).json({ error: 'Post topilmadi' });
    }

    const existingRepost: any = await dbGet(
      'SELECT * FROM post_reposts WHERE post_id = ? AND user_id = ?',
      [id, req.user!.userId]
    );

    if (existingRepost) {
      // Unrepost
      await dbRun('DELETE FROM post_reposts WHERE post_id = ? AND user_id = ?', [id, req.user!.userId]);
      await dbRun('UPDATE posts SET reposts_count = reposts_count - 1 WHERE id = ?', [id]);
      res.json({ reposted: false });
    } else {
      // Repost
      const repostId = uuidv4();
      await dbRun('INSERT INTO post_reposts (id, post_id, user_id) VALUES (?, ?, ?)', [
        repostId,
        id,
        req.user!.userId
      ]);
      await dbRun('UPDATE posts SET reposts_count = reposts_count + 1 WHERE id = ?', [id]);

      // Create notification for post author (if not the reposter)
      if (post.user_id !== req.user!.userId) {
        await createNotification(
          post.user_id,
          'post_repost',
          'New repost of your post',
          `${req.user!.username} reposted your post`,
          `/blog/post/${id}`
        );
      }

      res.json({ reposted: true });
    }
  } catch (error: any) {
    console.error('Repost error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get comments for a post
router.get('/:id/comments', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const comments = await dbAll(`
      SELECT 
        c.*,
        u.username,
        u.avatar_url
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `, [id]);

    res.json(comments);
  } catch (error: any) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Add comment
router.post('/:id/comments', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment matni kiritilishi kerak' });
    }

    const post: any = await dbGet('SELECT * FROM posts WHERE id = ?', [id]);
    if (!post) {
      return res.status(404).json({ error: 'Post topilmadi' });
    }

    const commentId = uuidv4();
    await dbRun(
      'INSERT INTO comments (id, post_id, user_id, content) VALUES (?, ?, ?, ?)',
      [commentId, id, req.user!.userId, content.trim()]
    );

    await dbRun('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?', [id]);

    // Create notification for post author (if not the commenter)
    if (post.user_id !== req.user!.userId) {
      await createNotification(
        post.user_id,
        'post_comment',
        'New comment on your post',
        `${req.user!.username} commented on your post`,
        `/blog/post/${id}`
      );
    }

    const comment: any = await dbGet(`
      SELECT 
        c.*,
        u.username,
        u.avatar_url
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `, [commentId]);

    res.status(201).json(comment);
  } catch (error: any) {
    console.error('Add comment error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Delete comment
router.delete('/comments/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const comment: any = await dbGet('SELECT * FROM comments WHERE id = ?', [id]);

    if (!comment) {
      return res.status(404).json({ error: 'Comment topilmadi' });
    }

    if (comment.user_id !== req.user!.userId) {
      return res.status(403).json({ error: 'Sizda bu commentni o\'chirish huquqi yo\'q' });
    }

    await dbRun('DELETE FROM comments WHERE id = ?', [id]);
    await dbRun('UPDATE posts SET comments_count = comments_count - 1 WHERE id = ?', [comment.post_id]);

    res.json({ message: 'Comment muvaffaqiyatli o\'chirildi' });
  } catch (error: any) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Vote on poll
router.post('/:id/poll/vote', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { optionIndex } = req.body;

    if (optionIndex === undefined || optionIndex === null) {
      return res.status(400).json({ error: 'Variant tanlanishi kerak' });
    }

    const post: any = await dbGet('SELECT * FROM posts WHERE id = ?', [id]);
    if (!post) {
      return res.status(404).json({ error: 'Post topilmadi' });
    }

    // Check if user already voted
    const existingVote: any = await dbGet(
      'SELECT * FROM poll_votes WHERE post_id = ? AND user_id = ?',
      [id, req.user!.userId]
    );

    if (existingVote) {
      // Update vote
      await dbRun(
        'UPDATE poll_votes SET option_index = ? WHERE post_id = ? AND user_id = ?',
        [optionIndex, id, req.user!.userId]
      );
    } else {
      // Create new vote
      const voteId = uuidv4();
      await dbRun(
        'INSERT INTO poll_votes (id, post_id, user_id, option_index) VALUES (?, ?, ?, ?)',
        [voteId, id, req.user!.userId, optionIndex]
      );
    }

    // Get poll results
    const votes = await dbAll(
      'SELECT option_index, COUNT(*) as count FROM poll_votes WHERE post_id = ? GROUP BY option_index',
      [id]
    );

    res.json({ success: true, votes });
  } catch (error: any) {
    console.error('Poll vote error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get poll results
router.get('/:id/poll/results', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const votes = await dbAll(
      'SELECT option_index, COUNT(*) as count FROM poll_votes WHERE post_id = ? GROUP BY option_index',
      [id]
    );

    const userVote: any = await dbGet(
      'SELECT option_index FROM poll_votes WHERE post_id = ? AND user_id = ?',
      [id, req.user!.userId]
    );

    res.json({ votes, userVote: userVote?.option_index || null });
  } catch (error: any) {
    console.error('Get poll results error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get trending hashtags
router.get('/trending/hashtags', optionalAuthenticate, async (req: AuthRequest, res) => {
  try {
    // Get all posts from last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const posts = await dbAll(`
      SELECT content FROM posts 
      WHERE created_at >= datetime('now', '-7 days')
    `, []);

    // Extract hashtags from posts
    const hashtagCounts: Record<string, number> = {};
    const hashtagRegex = /#(\w+)/g;

    posts.forEach((post: any) => {
      const matches = post.content.matchAll(hashtagRegex);
      for (const match of matches) {
        const hashtag = match[1].toLowerCase();
        hashtagCounts[hashtag] = (hashtagCounts[hashtag] || 0) + 1;
      }
    });

    // Convert to array and sort by count
    const trending = Object.entries(hashtagCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10

    res.json(trending);
  } catch (error: any) {
    console.error('Get trending hashtags error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get posts by hashtag
router.get('/hashtag/:hashtag', optionalAuthenticate, async (req: AuthRequest, res) => {
  try {
    const { hashtag } = req.params;
    const userId = req.user?.userId || null;

    // Get all posts that contain the hashtag (case-insensitive)
    const posts = await dbAll(`
      SELECT 
        p.*,
        u.username,
        u.avatar_url,
        u.icon_type,
        u.verify_icon_type,
        u.is_verified,
        u.role,
        CASE WHEN pl.user_id IS NOT NULL THEN 1 ELSE 0 END as is_liked,
        CASE WHEN pr.user_id IS NOT NULL THEN 1 ELSE 0 END as is_reposted
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN post_likes pl ON p.id = pl.post_id AND pl.user_id = ?
      LEFT JOIN post_reposts pr ON p.id = pr.post_id AND pr.user_id = ?
      WHERE LOWER(p.content) LIKE ?
      ORDER BY p.created_at DESC
      LIMIT 50
    `, [userId, userId, `%#${hashtag.toLowerCase()}%`]);

    res.json(posts);
  } catch (error: any) {
    console.error('Get posts by hashtag error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

export default router;

