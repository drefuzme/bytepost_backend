import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbAll, dbRun } from '../database/db.js';
import { authenticate } from '../middleware/auth.js';
const router = express.Router();
// Get all conversations for current user
router.get('/conversations', authenticate, async (req, res) => {
    try {
        // Try to get conversations with new columns, fallback to old query if columns don't exist
        let conversations;
        try {
            conversations = await dbAll(`
        SELECT 
          c.id,
          c.type,
          c.name,
          c.created_by,
          c.updated_at,
          m.content as last_message,
          m.created_at as last_message_at,
          m.sender_id as last_message_sender_id,
          u.username as last_message_sender_username,
          (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND created_at > cp.last_read_at) as unread_count
        FROM conversations c
        INNER JOIN conversation_participants cp ON c.id = cp.conversation_id
        LEFT JOIN messages m ON c.id = m.conversation_id AND m.id = (
          SELECT id FROM messages 
          WHERE conversation_id = c.id 
          ORDER BY created_at DESC 
          LIMIT 1
        )
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE cp.user_id = ?
        GROUP BY c.id
        ORDER BY c.updated_at DESC
      `, [req.user.userId]);
        }
        catch (err) {
            // Fallback to old query if new columns don't exist
            console.log('Using fallback query for conversations');
            conversations = await dbAll(`
        SELECT 
          c.id,
          c.type,
          NULL as name,
          NULL as created_by,
          c.updated_at,
          m.content as last_message,
          m.created_at as last_message_at,
          m.sender_id as last_message_sender_id,
          u.username as last_message_sender_username,
          (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND created_at > cp.last_read_at) as unread_count
        FROM conversations c
        INNER JOIN conversation_participants cp ON c.id = cp.conversation_id
        LEFT JOIN messages m ON c.id = m.conversation_id AND m.id = (
          SELECT id FROM messages 
          WHERE conversation_id = c.id 
          ORDER BY created_at DESC 
          LIMIT 1
        )
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE cp.user_id = ?
        GROUP BY c.id
        ORDER BY c.updated_at DESC
      `, [req.user.userId]);
        }
        // Get all participants for each conversation
        for (const conv of conversations) {
            let allParticipants;
            try {
                allParticipants = await dbAll(`
          SELECT 
            u.id,
            u.username,
            u.avatar_url,
            u.role,
            u.icon_type,
            u.verify_icon_type,
            u.is_verified,
            cp.role as participant_role
          FROM conversation_participants cp
          JOIN users u ON cp.user_id = u.id
          WHERE cp.conversation_id = ?
        `, [conv.id]);
            }
            catch (err) {
                // Fallback if role column doesn't exist
                allParticipants = await dbAll(`
          SELECT 
            u.id,
            u.username,
            u.avatar_url,
            u.role,
            u.icon_type,
            u.verify_icon_type,
            u.is_verified,
            'member' as participant_role
          FROM conversation_participants cp
          JOIN users u ON cp.user_id = u.id
          WHERE cp.conversation_id = ?
        `, [conv.id]);
            }
            // Get other participants (excluding current user)
            conv.participants = allParticipants.filter((p) => p.id !== req.user.userId);
            conv.all_participants = allParticipants;
            // Get current user's role
            const currentUserParticipant = allParticipants.find((p) => p.id === req.user.userId);
            conv.current_user_role = currentUserParticipant?.participant_role || 'member';
        }
        res.json(conversations);
    }
    catch (error) {
        console.error('Get conversations error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ error: 'Server xatosi', details: error.message });
    }
});
// Get or create conversation with a user
router.post('/conversations', authenticate, async (req, res) => {
    try {
        const { userId, type, name, userIds } = req.body;
        // Create group conversation
        if (type === 'group') {
            if (!name || !name.trim()) {
                return res.status(400).json({ error: 'Guruh nomi kiritilishi kerak' });
            }
            if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
                return res.status(400).json({ error: 'Kamida bitta foydalanuvchi tanlanishi kerak' });
            }
            // Create new group conversation
            const conversationId = uuidv4();
            await dbRun('INSERT INTO conversations (id, type, name, created_by) VALUES (?, ?, ?, ?)', [conversationId, 'group', name.trim(), req.user.userId]);
            // Add creator as moderator
            const creatorParticipantId = uuidv4();
            await dbRun('INSERT INTO conversation_participants (id, conversation_id, user_id, role) VALUES (?, ?, ?, ?)', [creatorParticipantId, conversationId, req.user.userId, 'moderator']);
            // Add other participants as members
            for (const userId of userIds) {
                if (userId !== req.user.userId) {
                    const participantId = uuidv4();
                    await dbRun('INSERT INTO conversation_participants (id, conversation_id, user_id, role) VALUES (?, ?, ?, ?)', [participantId, conversationId, userId, 'member']);
                }
            }
            return res.json({ conversation_id: conversationId });
        }
        // Create direct conversation (existing logic)
        if (!userId) {
            return res.status(400).json({ error: 'User ID kiritilishi kerak' });
        }
        if (userId === req.user.userId) {
            return res.status(400).json({ error: 'O\'zingiz bilan chat qila olmaysiz' });
        }
        // Check if conversation already exists
        const existingConv = await dbGet(`
      SELECT c.id
      FROM conversations c
      INNER JOIN conversation_participants cp1 ON c.id = cp1.conversation_id
      INNER JOIN conversation_participants cp2 ON c.id = cp2.conversation_id
      WHERE cp1.user_id = ? AND cp2.user_id = ? AND c.type = 'direct'
      LIMIT 1
    `, [req.user.userId, userId]);
        if (existingConv) {
            return res.json({ conversation_id: existingConv.id });
        }
        // Create new conversation
        const conversationId = uuidv4();
        await dbRun('INSERT INTO conversations (id, type) VALUES (?, ?)', [conversationId, 'direct']);
        // Add participants
        const participant1Id = uuidv4();
        const participant2Id = uuidv4();
        await dbRun('INSERT INTO conversation_participants (id, conversation_id, user_id) VALUES (?, ?, ?)', [participant1Id, conversationId, req.user.userId]);
        await dbRun('INSERT INTO conversation_participants (id, conversation_id, user_id) VALUES (?, ?, ?)', [participant2Id, conversationId, userId]);
        res.json({ conversation_id: conversationId });
    }
    catch (error) {
        console.error('Create conversation error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Get messages for a conversation
router.get('/conversations/:id/messages', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        // Check if user is participant
        const participant = await dbGet('SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [id, req.user.userId]);
        if (!participant) {
            return res.status(403).json({ error: 'Sizda bu chatga kirish huquqi yo\'q' });
        }
        // Get messages
        let messages;
        try {
            messages = await dbAll(`
        SELECT 
          m.id,
          m.conversation_id,
          m.sender_id,
          m.content,
          m.image_url,
          m.created_at,
          u.username,
          u.avatar_url,
          u.role,
          u.icon_type,
          u.verify_icon_type,
          u.is_verified
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.conversation_id = ?
        ORDER BY m.created_at ASC
        LIMIT 100
      `, [id]);
        }
        catch (err) {
            // Fallback if image_url column doesn't exist
            console.log('Using fallback query for messages (image_url column may not exist)');
            messages = await dbAll(`
        SELECT 
          m.id,
          m.conversation_id,
          m.sender_id,
          m.content,
          NULL as image_url,
          m.created_at,
          u.username,
          u.avatar_url,
          u.role,
          u.icon_type,
          u.verify_icon_type,
          u.is_verified
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.conversation_id = ?
        ORDER BY m.created_at ASC
        LIMIT 100
      `, [id]);
        }
        // Update last_read_at
        await dbRun('UPDATE conversation_participants SET last_read_at = CURRENT_TIMESTAMP WHERE conversation_id = ? AND user_id = ?', [id, req.user.userId]);
        res.json(messages);
    }
    catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Send a message
router.post('/conversations/:id/messages', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { content, image_url } = req.body;
        console.log('POST /messages request:', { id, content: content?.substring(0, 50), image_url: image_url?.substring(0, 50) });
        // Either content or image_url must be provided
        if ((!content || !content.trim()) && !image_url) {
            return res.status(400).json({ error: 'Xabar matni yoki rasm kiritilishi kerak' });
        }
        // If only image is provided, set content to empty string (NOT NULL constraint)
        const messageContent = content?.trim() || '';
        // Check if user is participant
        const participant = await dbGet('SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [id, req.user.userId]);
        if (!participant) {
            return res.status(403).json({ error: 'Sizda bu chatga xabar yuborish huquqi yo\'q' });
        }
        // Create message
        const messageId = uuidv4();
        try {
            console.log('Creating message with:', { messageId, conversationId: id, senderId: req.user.userId, hasContent: !!content, hasImageUrl: !!image_url });
            // Try with image_url first
            try {
                await dbRun('INSERT INTO messages (id, conversation_id, sender_id, content, image_url) VALUES (?, ?, ?, ?, ?)', [messageId, id, req.user.userId, messageContent, image_url || null]);
                console.log('Message created successfully with image_url');
            }
            catch (insertErr) {
                // If image_url column doesn't exist, try without it
                if (insertErr.message?.includes('no such column: image_url') || insertErr.message?.includes('SQLITE_ERROR')) {
                    console.log('image_url column not found, trying without it');
                    await dbRun('INSERT INTO messages (id, conversation_id, sender_id, content) VALUES (?, ?, ?, ?)', [messageId, id, req.user.userId, messageContent]);
                    console.log('Message created successfully without image_url');
                }
                else {
                    throw insertErr;
                }
            }
        }
        catch (err) {
            console.error('Error creating message:', err);
            console.error('Error message:', err.message);
            console.error('Error stack:', err.stack);
            throw err;
        }
        // Update conversation updated_at
        await dbRun('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
        // Get created message with user info
        let message;
        try {
            message = await dbGet(`
        SELECT 
          m.id,
          m.conversation_id,
          m.sender_id,
          m.content,
          m.image_url,
          m.created_at,
          u.username,
          u.avatar_url,
          u.role,
          u.icon_type,
          u.verify_icon_type,
          u.is_verified
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `, [messageId]);
        }
        catch (err) {
            // Fallback if image_url column doesn't exist
            message = await dbGet(`
        SELECT 
          m.id,
          m.conversation_id,
          m.sender_id,
          m.content,
          NULL as image_url,
          m.created_at,
          u.username,
          u.avatar_url,
          u.role,
          u.icon_type,
          u.verify_icon_type,
          u.is_verified
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `, [messageId]);
        }
        res.status(201).json(message);
    }
    catch (error) {
        console.error('Send message error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ error: 'Server xatosi', details: error.message });
    }
});
// Get conversation info
router.get('/conversations/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        // Check if user is participant
        const participant = await dbGet('SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [id, req.user.userId]);
        if (!participant) {
            return res.status(403).json({ error: 'Sizda bu chatga kirish huquqi yo\'q' });
        }
        // Get conversation with participants
        let conversation;
        try {
            conversation = await dbGet('SELECT id, type, name, created_by, created_at, updated_at FROM conversations WHERE id = ?', [id]);
        }
        catch (err) {
            // Fallback if new columns don't exist
            conversation = await dbGet('SELECT id, type, NULL as name, NULL as created_by, created_at, updated_at FROM conversations WHERE id = ?', [id]);
        }
        let participants;
        try {
            participants = await dbAll(`
        SELECT 
          u.id,
          u.username,
          u.avatar_url,
          u.role,
          u.icon_type,
          u.verify_icon_type,
          u.is_verified,
          cp.role as participant_role
        FROM conversation_participants cp
        JOIN users u ON cp.user_id = u.id
        WHERE cp.conversation_id = ?
      `, [id]);
        }
        catch (err) {
            // Fallback if role column doesn't exist
            participants = await dbAll(`
        SELECT 
          u.id,
          u.username,
          u.avatar_url,
          u.role,
          u.icon_type,
          u.verify_icon_type,
          u.is_verified,
          'member' as participant_role
        FROM conversation_participants cp
        JOIN users u ON cp.user_id = u.id
        WHERE cp.conversation_id = ?
      `, [id]);
        }
        // Get current user's role
        const currentUserParticipant = participants.find((p) => p.id === req.user.userId);
        const currentUserRole = currentUserParticipant?.participant_role || 'member';
        res.json({ ...conversation, participants, current_user_role: currentUserRole });
    }
    catch (error) {
        console.error('Get conversation error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Add user to group
router.post('/conversations/:id/participants', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ error: 'User ID kiritilishi kerak' });
        }
        // Check if conversation exists and is a group
        const conversation = await dbGet('SELECT type, created_by FROM conversations WHERE id = ?', [id]);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation topilmadi' });
        }
        if (conversation.type !== 'group') {
            return res.status(400).json({ error: 'Bu guruh emas' });
        }
        // Check if user is moderator
        const participant = await dbGet('SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [id, req.user.userId]);
        if (!participant || participant.role !== 'moderator') {
            return res.status(403).json({ error: 'Faqat moderator foydalanuvchi qo\'sha oladi' });
        }
        // Check if user is already in the group
        const existing = await dbGet('SELECT id FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [id, userId]);
        if (existing) {
            return res.status(400).json({ error: 'Foydalanuvchi allaqachon guruhda' });
        }
        // Add user to group
        const participantId = uuidv4();
        await dbRun('INSERT INTO conversation_participants (id, conversation_id, user_id, role) VALUES (?, ?, ?, ?)', [participantId, id, userId, 'member']);
        res.json({ message: 'Foydalanuvchi guruhga qo\'shildi' });
    }
    catch (error) {
        console.error('Add participant error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
// Update group name
router.patch('/conversations/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        // Check if conversation exists and is a group
        const conversation = await dbGet('SELECT type, created_by FROM conversations WHERE id = ?', [id]);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation topilmadi' });
        }
        if (conversation.type !== 'group') {
            return res.status(400).json({ error: 'Bu guruh emas' });
        }
        // Check if user is moderator
        const participant = await dbGet('SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [id, req.user.userId]);
        if (!participant || participant.role !== 'moderator') {
            return res.status(403).json({ error: 'Faqat moderator guruh nomini o\'zgartira oladi' });
        }
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Guruh nomi kiritilishi kerak' });
        }
        // Update group name
        await dbRun('UPDATE conversations SET name = ? WHERE id = ?', [name.trim(), id]);
        const updatedConversation = await dbGet('SELECT id, type, name, created_by, created_at, updated_at FROM conversations WHERE id = ?', [id]);
        res.json({ message: 'Guruh nomi yangilandi', conversation: updatedConversation });
    }
    catch (error) {
        console.error('Update group name error:', error);
        res.status(500).json({ error: 'Server xatosi', details: error.message });
    }
});
// Remove user from group
router.delete('/conversations/:id/participants/:userId', authenticate, async (req, res) => {
    try {
        const { id, userId } = req.params;
        // Check if conversation exists and is a group
        const conversation = await dbGet('SELECT type, created_by FROM conversations WHERE id = ?', [id]);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation topilmadi' });
        }
        if (conversation.type !== 'group') {
            return res.status(400).json({ error: 'Bu guruh emas' });
        }
        // Check if user is moderator or removing themselves
        const participant = await dbGet('SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [id, req.user.userId]);
        if (!participant) {
            return res.status(403).json({ error: 'Siz bu guruhda emassiz' });
        }
        const isModerator = participant.role === 'moderator';
        const isRemovingSelf = userId === req.user.userId;
        if (!isModerator && !isRemovingSelf) {
            return res.status(403).json({ error: 'Faqat moderator foydalanuvchini olib tashlashi mumkin' });
        }
        // Don't allow removing the creator/moderator
        if (userId === conversation.created_by && !isRemovingSelf) {
            return res.status(400).json({ error: 'Guruh yaratuvchisini olib tashlab bo\'lmaydi' });
        }
        // Remove user from group
        await dbRun('DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [id, userId]);
        res.json({ message: 'Foydalanuvchi guruhdan olib tashlandi' });
    }
    catch (error) {
        console.error('Remove participant error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});
export default router;
//# sourceMappingURL=chat.js.map