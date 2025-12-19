import express from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UPLOADS_DIR = join(__dirname, '../../uploads');

// Ensure uploads directory exists
mkdir(UPLOADS_DIR, { recursive: true }).catch(() => {});

// Upload image
router.post('/upload/image', authenticate, async (req: AuthRequest, res) => {
  try {
    const { image } = req.body; // Base64 encoded image

    if (!image) {
      return res.status(400).json({ error: 'Rasm kiritilishi kerak' });
    }

    // Check if it's a base64 data URL
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const imageType = image.match(/^data:image\/(\w+);base64,/)?.[1] || 'png';

    // Validate image type
    const allowedTypes = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
    if (!allowedTypes.includes(imageType.toLowerCase())) {
      return res.status(400).json({ error: 'Faqat rasm fayllari qabul qilinadi (PNG, JPG, GIF, WEBP)' });
    }

    // Generate unique filename
    const filename = `${uuidv4()}.${imageType}`;
    const filePath = join(UPLOADS_DIR, filename);

    // Check file size (max 5MB)
    const buffer = Buffer.from(base64Data, 'base64');
    const fileSizeInMB = buffer.length / (1024 * 1024);
    
    if (fileSizeInMB > 5) {
      return res.status(400).json({ error: 'Rasm hajmi 5MB dan oshmasligi kerak' });
    }

    // Write file
    await writeFile(filePath, buffer);

    // Return URL
    const imageUrl = `/uploads/${filename}`;

    res.json({ url: imageUrl });
  } catch (error: any) {
    console.error('Upload error:', error);
    if (error.code === 'LIMIT_FILE_SIZE' || error.message?.includes('too large')) {
      return res.status(413).json({ error: 'Rasm hajmi juda katta. Maksimal hajm: 5MB' });
    }
    res.status(500).json({ error: 'Rasm yuklashda xatolik', details: error.message });
  }
});

export default router;

