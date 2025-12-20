import express from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { dbGet } from '../database/db.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import simpleGit from 'simple-git';
import { access, constants, writeFile, mkdir } from 'fs/promises';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Use environment variable for repos directory, fallback to relative path
const REPOS_DIR = process.env.REPOS_DIR || join(__dirname, '../../repositories');

// Simple push endpoint - accepts files and commits them
router.post('/:owner/:repo/push', authenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;
    const { files, commitMessage, branch } = req.body;

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    // Only owner can push
    if (repository.owner_id !== req.user!.userId) {
      return res.status(403).json({ error: 'Push huquqi yo\'q' });
    }

    const repoPath = join(REPOS_DIR, owner, repo);
    
    try {
      await access(repoPath, constants.F_OK);
    } catch {
      return res.status(404).json({ error: 'Git repository topilmadi' });
    }

    const git = simpleGit(repoPath);
    
    // Configure git user
    await git.addConfig('user.name', req.user!.username);
    await git.addConfig('user.email', req.user!.email);

    // Write files
    if (files && Array.isArray(files)) {
      for (const file of files) {
        const filePath = join(repoPath, file.path);
        const fileDir = dirname(filePath);
        
        // Create directory if needed
        await mkdir(fileDir, { recursive: true });
        
        // Write file
        await writeFile(filePath, file.content || '', 'utf8');
      }
    }

    // Add all changes
    await git.add('.');

    // Commit
    const message = commitMessage || `Update files - ${new Date().toISOString()}`;
    await git.commit(message);

    // Get current branch or use provided branch
    const currentBranch = branch || repository.default_branch || 'main';
    const branches = await git.branchLocal();
    
    // If branch doesn't exist, create it
    if (!branches.all.includes(currentBranch)) {
      await git.checkoutLocalBranch(currentBranch);
    }

    res.json({
      message: 'Muvaffaqiyatli push qilindi',
      commit: message,
      branch: currentBranch
    });
  } catch (error: any) {
    console.error('Push error:', error);
    res.status(500).json({ error: 'Push xatosi: ' + error.message });
  }
});

// Get repository status
router.get('/:owner/:repo/status', authenticate, async (req: AuthRequest, res) => {
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

    const repoPath = join(REPOS_DIR, owner, repo);
    
    try {
      await access(repoPath, constants.F_OK);
    } catch {
      return res.status(404).json({ error: 'Git repository topilmadi' });
    }

    const git = simpleGit(repoPath);
    const status = await git.status();
    const branches = await git.branchLocal();
    const log = await git.log({ maxCount: 5 });

    res.json({
      currentBranch: branches.current,
      branches: branches.all,
      commits: log.all,
      status: {
        current: status.current,
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
        files: status.files
      }
    });
  } catch (error: any) {
    console.error('Status error:', error);
    res.status(500).json({ error: 'Status xatosi' });
  }
});

export default router;

