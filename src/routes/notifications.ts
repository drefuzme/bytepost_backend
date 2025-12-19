import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { dbRun, dbGet, dbAll } from '../database/db.js';

const router = express.Router();

// Get all notifications for current user
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const { read, type, limit = 50 } = req.query;

    let query = `
      SELECT * FROM notifications
      WHERE user_id = ?
    `;
    const params: any[] = [req.user!.userId];

    if (read !== undefined) {
      query += ` AND read = ?`;
      params.push(read === 'true' ? 1 : 0);
    }

    if (type) {
      query += ` AND type = ?`;
      params.push(type);
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(parseInt(limit as string));

    const notifications = await dbAll(query, params);

    res.json(notifications);
  } catch (error: any) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get unread count
router.get('/unread-count', authenticate, async (req: AuthRequest, res) => {
  try {
    const count: any = await dbGet(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0',
      [req.user!.userId]
    );

    res.json({ count: count?.count || 0 });
  } catch (error: any) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Mark notification as read
router.patch('/:id/read', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const notification: any = await dbGet(
      'SELECT * FROM notifications WHERE id = ? AND user_id = ?',
      [id, req.user!.userId]
    );

    if (!notification) {
      return res.status(404).json({ error: 'Notification topilmadi' });
    }

    await dbRun('UPDATE notifications SET read = 1 WHERE id = ?', [id]);

    res.json({ message: 'Notification o\'qildi deb belgilandi' });
  } catch (error: any) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Mark all notifications as read
router.patch('/read-all', authenticate, async (req: AuthRequest, res) => {
  try {
    await dbRun('UPDATE notifications SET read = 1 WHERE user_id = ?', [req.user!.userId]);

    res.json({ message: 'Barcha notification\'lar o\'qildi deb belgilandi' });
  } catch (error: any) {
    console.error('Mark all as read error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Delete notification
router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const notification: any = await dbGet(
      'SELECT * FROM notifications WHERE id = ? AND user_id = ?',
      [id, req.user!.userId]
    );

    if (!notification) {
      return res.status(404).json({ error: 'Notification topilmadi' });
    }

    await dbRun('DELETE FROM notifications WHERE id = ?', [id]);

    res.json({ message: 'Notification o\'chirildi' });
  } catch (error: any) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Helper function to create notification (can be imported by other routes)
export const createNotification = async (
  userId: string,
  type: string,
  title: string,
  message?: string,
  link?: string
) => {
  try {
    const notificationId = uuidv4();
    await dbRun(
      'INSERT INTO notifications (id, user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?, ?)',
      [notificationId, userId, type, title, message || '', link || '']
    );
    console.log(`✅ Notification created: ${type} for user ${userId} - ${title}`);
    return notificationId;
  } catch (error) {
    console.error('❌ Create notification error:', error);
    return null;
  }
};

export default router;

