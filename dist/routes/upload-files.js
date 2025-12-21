import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { dbGet } from '../database/db.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import simpleGit from 'simple-git';
import { writeFile, mkdir } from 'fs/promises';
const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Use environment variable for repos directory, fallback to relative path
const REPOS_DIR = process.env.REPOS_DIR || join(__dirname, '../../repositories');
// Upload multiple files to repository
router.post('/:owner/:repo/upload-files', authenticate, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { files, commitMessage, branch } = req.body;
        if (!files || !Array.isArray(files) || files.length === 0) {
            return res.status(400).json({ error: 'Fayllar kiritilishi kerak' });
        }
        const repository = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);
        if (!repository) {
            return res.status(404).json({ error: 'Repository topilmadi' });
        }
        // Check if user has write access
        if (repository.owner_id !== req.user.userId) {
            return res.status(403).json({ error: 'Fayl yozish huquqi yo\'q' });
        }
        const repoPath = join(REPOS_DIR, owner, repo);
        const git = simpleGit(repoPath);
        // Configure git user
        await git.addConfig('user.name', req.user.username);
        await git.addConfig('user.email', req.user.email);
        // Get current branch or use provided branch
        let currentBranch = branch || 'main';
        try {
            const branches = await git.branchLocal();
            if (branches.current) {
                currentBranch = branches.current;
            }
            else if (branches.all.includes('master')) {
                currentBranch = 'master';
            }
            else if (branches.all.includes('main')) {
                currentBranch = 'main';
            }
            console.log('Upload: Using branch:', currentBranch);
        }
        catch (e) {
            console.log('Upload: Could not determine branch, using:', currentBranch);
        }
        // Checkout to correct branch if needed
        try {
            const branches = await git.branchLocal();
            if (currentBranch && branches.all.includes(currentBranch) && branches.current !== currentBranch) {
                await git.checkout(currentBranch);
            }
        }
        catch (e) {
            console.log('Upload: Could not checkout branch, continuing...');
        }
        // Write files
        const uploadedFiles = [];
        for (const file of files) {
            if (!file.path || file.content === undefined) {
                continue;
            }
            const fullFilePath = join(repoPath, file.path);
            const fileDir = dirname(fullFilePath);
            // Create directory if needed
            await mkdir(fileDir, { recursive: true });
            // Write file - handle base64 for binary files
            if (file.isBinary && file.content.startsWith('data:')) {
                // Extract base64 data
                const base64Data = file.content.split(',')[1] || file.content;
                await writeFile(fullFilePath, base64Data, 'base64');
            }
            else {
                await writeFile(fullFilePath, file.content, 'utf8');
            }
            uploadedFiles.push(file.path);
        }
        if (uploadedFiles.length === 0) {
            return res.status(400).json({ error: 'Hech qanday fayl yuklanmadi' });
        }
        // Add all files (use . to add all changes)
        await git.add('.');
        const message = commitMessage || `Upload ${uploadedFiles.length} file(s)`;
        await git.commit(message);
        console.log('Upload: Committed', uploadedFiles.length, 'files to branch', currentBranch);
        res.json({
            message: `${uploadedFiles.length} ta fayl muvaffaqiyatli yuklandi`,
            files: uploadedFiles,
            commit: message
        });
    }
    catch (error) {
        console.error('Upload files error:', error);
        res.status(500).json({ error: 'Fayl yuklashda xatolik: ' + error.message });
    }
});
export default router;
//# sourceMappingURL=upload-files.js.map