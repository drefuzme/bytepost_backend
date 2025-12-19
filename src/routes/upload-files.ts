import express from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { dbGet } from '../database/db.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import simpleGit from 'simple-git';
import { writeFile, mkdir } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPOS_DIR = join(__dirname, '../../repositories');

// Upload multiple files to repository
router.post('/:owner/:repo/upload-files', authenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;
    const { files, commitMessage, branch } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'Fayllar kiritilishi kerak' });
    }

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    // Check if user has write access
    if (repository.owner_id !== req.user!.userId) {
      return res.status(403).json({ error: 'Fayl yozish huquqi yo\'q' });
    }

    const repoPath = join(REPOS_DIR, owner, repo);
    const git = simpleGit(repoPath);

    // Configure git user
    await git.addConfig('user.name', req.user!.username);
    await git.addConfig('user.email', req.user!.email);

    // Write files
    const uploadedFiles: string[] = [];
    for (const file of files) {
      if (!file.path || file.content === undefined) {
        continue;
      }

      const fullFilePath = join(repoPath, file.path);
      const fileDir = dirname(fullFilePath);

      // Create directory if needed
      await mkdir(fileDir, { recursive: true });

      // Write file
      await writeFile(fullFilePath, file.content, 'utf8');
      uploadedFiles.push(file.path);
    }

    if (uploadedFiles.length === 0) {
      return res.status(400).json({ error: 'Hech qanday fayl yuklanmadi' });
    }

    // Add and commit
    await git.add(uploadedFiles);
    const message = commitMessage || `Upload ${uploadedFiles.length} file(s)`;
    await git.commit(message);

    res.json({
      message: `${uploadedFiles.length} ta fayl muvaffaqiyatli yuklandi`,
      files: uploadedFiles,
      commit: message
    });
  } catch (error: any) {
    console.error('Upload files error:', error);
    res.status(500).json({ error: 'Fayl yuklashda xatolik: ' + error.message });
  }
});

export default router;


