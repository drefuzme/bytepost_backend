import express from 'express';
import { authenticate, optionalAuthenticate, AuthRequest } from '../middleware/auth.js';
import { dbGet } from '../database/db.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import simpleGit from 'simple-git';
import { readFile, writeFile, mkdir, access, readdir, stat } from 'fs/promises';
import { constants } from 'fs';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPOS_DIR = join(__dirname, '../../repositories');

// Helper function to check repository access
async function checkRepositoryAccess(repository: any, userId?: string): Promise<boolean> {
  // Public repos are accessible to everyone
  if (!repository.is_private) {
    console.log('checkRepositoryAccess: Public repo, access granted', {
      repoId: repository.id,
      repoName: repository.name,
      is_private: repository.is_private
    });
    return true;
  }
  // Private repos only accessible to owner or collaborators (requires userId)
  if (!userId) {
    console.log('checkRepositoryAccess: Private repo, no userId, access denied', {
      repoId: repository.id,
      repoName: repository.name,
      is_private: repository.is_private
    });
    return false;
  }
  
  // Check if user is owner (compare as strings to handle UUIDs)
  const repoOwnerId = String(repository.owner_id).trim();
  const userIdStr = String(userId).trim();
  if (repoOwnerId === userIdStr) {
    console.log('checkRepositoryAccess: User is owner, access granted', {
      repoId: repository.id,
      userId: userIdStr,
      ownerId: repoOwnerId
    });
    return true;
  }
  
  // Check if user is collaborator
  const collaborator = await dbGet(
    'SELECT * FROM repository_collaborators WHERE repository_id = ? AND user_id = ?',
    [repository.id, userId]
  );
  
  if (collaborator) {
    console.log('checkRepositoryAccess: User is collaborator, access granted', {
      repoId: repository.id,
      userId: userIdStr
    });
    return true;
  }
  
  console.log('checkRepositoryAccess: Access denied', {
    repoId: repository.id,
    userId: userIdStr,
    ownerId: repoOwnerId,
    isCollaborator: !!collaborator
  });
  return false;
}

// Create new branch
router.post('/:owner/:repo/branches', authenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;
    const { branchName, fromBranch } = req.body;

    if (!branchName) {
      return res.status(400).json({ error: 'Branch nomi kiritilishi kerak' });
    }

    // Validate branch name (Git branch name rules)
    if (!/^[a-zA-Z0-9._/-]+$/.test(branchName)) {
      return res.status(400).json({ error: 'Branch nomi noto\'g\'ri formatda' });
    }

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    // Check access - only owner or collaborators can create branches
    const hasAccess = await checkRepositoryAccess(repository, req.user!.userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Kirish huquqi yo\'q' });
    }

    const repoPath = join(REPOS_DIR, owner, repo);
    
    try {
      await access(repoPath, constants.F_OK);
    } catch {
      return res.status(404).json({ error: 'Git repository topilmadi' });
    }

    const git = simpleGit(repoPath);

    // Get current branches
    const branches = await git.branchLocal();
    
    // Check if branch already exists
    if (branches.all.includes(branchName)) {
      return res.status(400).json({ error: 'Bu branch allaqachon mavjud' });
    }

    // Determine source branch
    const sourceBranch = fromBranch || branches.current || 'main';
    
    // Check if source branch exists
    if (!branches.all.includes(sourceBranch) && sourceBranch !== 'main') {
      return res.status(400).json({ error: `Source branch '${sourceBranch}' topilmadi` });
    }

    // Create new branch from source branch
    try {
      // First checkout to source branch
      await git.checkout(sourceBranch);
      // Create and checkout new branch
      await git.checkoutLocalBranch(branchName);
      
      console.log('Branch created:', { branchName, fromBranch: sourceBranch, owner, repo });
      
      res.json({
        message: 'Branch muvaffaqiyatli yaratildi',
        branch: branchName,
        fromBranch: sourceBranch
      });
    } catch (error: any) {
      console.error('Error creating branch:', error);
      return res.status(500).json({ error: 'Branch yaratishda xatolik: ' + error.message });
    }
  } catch (error: any) {
    console.error('Create branch error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Refresh repository - fetch latest changes from remote
router.post('/:owner/:repo/refresh', authenticate, async (req: AuthRequest, res) => {
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

    // Check access - refresh only for owner or collaborators
    const hasAccess = await checkRepositoryAccess(repository, req.user!.userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Kirish huquqi yo\'q' });
    }

    const repoPath = join(REPOS_DIR, owner, repo);
    const git = simpleGit(repoPath);

    try {
      // Try to fetch from origin
      try {
        await git.fetch('origin');
      } catch (e) {
        // Ignore fetch errors if remote doesn't exist
      }

      // Try to pull latest changes
      try {
        const branches = await git.branchLocal();
        const currentBranch = branches.current || 'main';
        await git.pull('origin', currentBranch);
      } catch (e) {
        // Ignore pull errors
      }

      // Reset to latest commit if needed
      try {
        const log = await git.log({ maxCount: 1 });
        if (log.latest) {
          await git.reset(['--hard', log.latest.hash]);
        }
      } catch (e) {
        // Ignore reset errors
      }
    } catch (error) {
      // Ignore errors
    }

    res.json({ message: 'Repository yangilandi' });
  } catch (error: any) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get repository info (branches, commits, etc.) - public
router.get('/:owner/:repo/info', optionalAuthenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;

    console.log('Git info request:', {
      owner,
      repo,
      hasUser: !!req.user,
      userId: req.user?.userId,
      username: req.user?.username
    });

    const repository: any = await dbGet(`
      SELECT r.*, u.username as owner_username
      FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      console.log('Git info: Repository not found', { owner, repo });
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    console.log('Git info: Repository found', {
      id: repository.id,
      name: repository.name,
      is_private: repository.is_private,
      owner_id: repository.owner_id,
      owner_username: repository.owner_username
    });

    // Check access
    const hasAccess = await checkRepositoryAccess(repository, req.user?.userId);
    console.log('Git info: Access check', {
      is_private: repository.is_private,
      userId: req.user?.userId,
      owner_id: repository.owner_id,
      hasAccess
    });
    
    if (!hasAccess) {
      console.log('Git info: Access denied', {
        is_private: repository.is_private,
        userId: req.user?.userId,
        owner_id: repository.owner_id
      });
      return res.status(403).json({ error: 'Kirish huquqi yo\'q' });
    }

    const repoPath = join(REPOS_DIR, owner, repo);
    
    try {
      await access(repoPath, constants.F_OK);
    } catch {
      return res.status(404).json({ error: 'Git repository topilmadi' });
    }

    const git = simpleGit(repoPath);

    // Try to fetch latest changes before getting info
    try {
      await git.fetch('origin').catch(() => {});
      const branches = await git.branchLocal();
      const currentBranch = branches.current || 'main';
      await git.pull('origin', currentBranch).catch(() => {});
    } catch (e) {
      // Ignore fetch/pull errors
    }

    // Get branches
    const branches = await git.branchLocal();
    console.log('Git branches:', { all: branches.all, current: branches.current });
    
    // Normalize branch name: if current is 'master' but 'main' exists, prefer 'main'
    // If only 'master' exists, keep it as is
    let normalizedCurrentBranch = branches.current;
    if (branches.current === 'master' && branches.all.includes('main')) {
      // If both exist, prefer 'main'
      normalizedCurrentBranch = 'main';
      // Checkout to main if not already there
      if (branches.current !== 'main') {
        try {
          await git.checkout('main');
          normalizedCurrentBranch = 'main';
        } catch (e) {
          console.log('Could not checkout to main, keeping master');
        }
      }
    } else if (!branches.all.includes('main') && branches.current === 'master') {
      // If only master exists, we can optionally rename it to main
      // But for now, just keep it as master
      normalizedCurrentBranch = 'master';
    }
    
    // Get latest commits
    let commits: any[] = [];
    try {
      // First try with simple-git log
      const log = await git.log({ maxCount: 10 });
      commits = log.all || [];
      console.log('Git log result (simple-git):', { 
        commitCount: commits.length, 
        commits: commits.map((c: any) => ({ 
          hash: c.hash, 
          message: c.message,
          author: c.author_name || c.author?.name,
          date: c.date
        })) 
      });
    } catch (logError: any) {
      console.error('Error getting git log (simple-git):', logError.message);
      // Try to get commits using raw command
      try {
        console.log('Trying git raw log command...');
        const logOutput = await git.raw(['log', '--pretty=format:%H|%an|%ae|%ad|%s', '--date=iso', '-10']);
        console.log('Git raw log output:', logOutput ? logOutput.substring(0, 200) : 'empty');
        if (logOutput && logOutput.trim()) {
          commits = logOutput.trim().split('\n').map((line: string) => {
            const parts = line.split('|');
            if (parts.length >= 5) {
              return {
                hash: parts[0],
                author_name: parts[1],
                author_email: parts[2],
                date: parts[3],
                message: parts.slice(4).join('|')
              };
            }
            return null;
          }).filter(Boolean);
          console.log('Git log result (raw):', { commitCount: commits.length });
        } else {
          console.log('Git log output is empty - repository might be empty or have no commits');
        }
      } catch (rawError: any) {
        console.error('Error getting git log with raw command:', rawError.message);
        // Check if repository is empty
        try {
          const refs = await git.raw(['show-ref', '--heads']);
          console.log('Git refs:', refs ? refs.trim() : 'empty');
          if (!refs || !refs.trim()) {
            console.log('Repository has no refs - it might be empty');
          }
        } catch (refError: any) {
          console.error('Error checking git refs:', refError.message);
        }
      }
    }
    
    // Get status
    const status = await git.status();

    console.log('Git info: Sending response', {
      branchesCount: branches.all?.length || 0,
      currentBranch: normalizedCurrentBranch,
      originalCurrentBranch: branches.current,
      commitsCount: commits.length,
      hasUser: !!req.user,
      userId: req.user?.userId
    });

    res.json({
      branches: branches.all,
      currentBranch: normalizedCurrentBranch,
      commits: commits,
      status: {
        current: status.current,
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
        files: status.files
      }
    });
  } catch (error: any) {
    console.error('Get git info error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Helper function to recursively get files from filesystem
async function getFilesFromFS(dirPath: string, basePath: string = dirPath): Promise<any[]> {
  const files: any[] = [];
  
  try {
    const items = await readdir(dirPath);
    
    for (const item of items) {
      // Skip .git directory
      if (item === '.git') {
        continue;
      }
      
      const fullPath = join(dirPath, item);
      const stats = await stat(fullPath);
      const relativePath = fullPath.replace(basePath + '\\', '').replace(basePath + '/', '').replace(/\\/g, '/');
      
      if (stats.isDirectory()) {
        // Recursively get files from subdirectories
        const subFiles = await getFilesFromFS(fullPath, basePath);
        files.push(...subFiles);
      } else {
        files.push({
          path: relativePath,
          name: item,
          type: 'file'
        });
      }
    }
  } catch (error) {
    console.error('Error reading directory:', error);
  }
  
  return files;
}

// Helper function to get files from git even if working directory is empty
async function getFilesFromGit(git: any, branchName: string): Promise<any[]> {
  const fileList: any[] = [];
  
  try {
    // Try with branch name
    try {
      const files = await git.raw(['ls-tree', '-r', '--name-only', branchName]);
      if (files && files.trim()) {
        return files.trim().split('\n').filter(Boolean).map((file: string) => ({
          path: file,
          name: file.split('/').pop(),
          type: 'file'
        }));
      }
    } catch (e) {
      // Try with HEAD
      try {
        const files = await git.raw(['ls-tree', '-r', '--name-only', 'HEAD']);
        if (files && files.trim()) {
          return files.trim().split('\n').filter(Boolean).map((file: string) => ({
            path: file,
            name: file.split('/').pop(),
            type: 'file'
          }));
        }
      } catch (e2) {
        // Try with all refs
        try {
          const refs = await git.raw(['show-ref', '--heads']);
          if (refs && refs.trim()) {
            const refLines = refs.trim().split('\n');
            for (const refLine of refLines) {
              const parts = refLine.split(' ');
              if (parts.length >= 2) {
                const commitHash = parts[0];
                try {
                  const files = await git.raw(['ls-tree', '-r', '--name-only', commitHash]);
                  if (files && files.trim()) {
                    return files.trim().split('\n').filter(Boolean).map((file: string) => ({
                      path: file,
                      name: file.split('/').pop(),
                      type: 'file'
                    }));
                  }
                } catch (e3) {
                  continue;
                }
              }
            }
          }
        } catch (e3) {
          // Ignore
        }
      }
    }
  } catch (error) {
    console.error('Error getting files from git:', error);
  }
  
  return fileList;
}

// Get file tree - public
router.get('/:owner/:repo/tree/:branch?', optionalAuthenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo, branch } = req.params;
    const branchName = branch || 'main';

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    // Check access
    const hasAccess = await checkRepositoryAccess(repository, req.user?.userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Kirish huquqi yo\'q' });
    }

    const repoPath = join(REPOS_DIR, owner, repo);
    const git = simpleGit(repoPath);

    let fileList: any[] = [];

    try {
      // Get current branch
      const branches = await git.branchLocal();
      
      // Check if requested branch exists
      if (branchName && branches.all.includes(branchName)) {
        // Checkout to requested branch if it's different from current
        if (branches.current !== branchName) {
          console.log(`Switching branch from ${branches.current} to ${branchName}`);
          await git.checkout(branchName);
        }
      }
      
      const currentBranch = branchName && branches.all.includes(branchName) ? branchName : (branches.current || 'main');
      
      // Try to get files from git first (even if working directory is empty)
      fileList = await getFilesFromGit(git, currentBranch);
      
      // If no files from git, read from filesystem
      if (fileList.length === 0) {
        try {
          fileList = await getFilesFromFS(repoPath);
        } catch (fsError: any) {
          console.error('Error reading from filesystem:', fsError);
        }
      }
    } catch (gitError: any) {
      // If git operations fail, read from filesystem
      console.log('Git operations failed, reading from filesystem:', gitError.message);
      try {
        fileList = await getFilesFromFS(repoPath);
      } catch (fsError: any) {
        console.error('Error reading from filesystem:', fsError);
      }
    }

    res.json({ files: fileList, branch: branchName });
  } catch (error: any) {
    console.error('Get tree error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Get file content - public
router.get('/:owner/:repo/blob/:branch/:path(*)', optionalAuthenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo, branch, path } = req.params;

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    // Check access
    const hasAccess = await checkRepositoryAccess(repository, req.user?.userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Kirish huquqi yo\'q' });
    }

    const repoPath = join(REPOS_DIR, owner, repo);
    const filePath = join(repoPath, path);
    const git = simpleGit(repoPath);

    let content = '';

    try {
      // Try to get file content from git first
      content = await git.show([`${branch}:${path}`]);
    } catch (gitError: any) {
      // If git show fails, read from filesystem
      try {
        content = await readFile(filePath, 'utf8');
      } catch (fsError: any) {
        return res.status(404).json({ error: 'Fayl topilmadi' });
      }
    }

    res.json({ content, path, branch });
  } catch (error: any) {
    console.error('Get blob error:', error);
    res.status(500).json({ error: 'Fayl topilmadi' });
  }
});

// Create or update file
router.post('/:owner/:repo/file', authenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;
    const { filePath, content, commitMessage, branch } = req.body;

    if (!filePath || content === undefined) {
      return res.status(400).json({ error: 'Fayl yo\'li va kontent kiritilishi kerak' });
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
    const fullFilePath = join(repoPath, filePath);
    
    // Create directory if needed
    await mkdir(dirname(fullFilePath), { recursive: true });
    
    // Write file
    await writeFile(fullFilePath, content, 'utf8');

    // Git operations
    const git = simpleGit(repoPath);
    await git.add(filePath);
    
    const commitMsg = commitMessage || `Update ${filePath}`;
    await git.commit(commitMsg);

    res.json({ 
      message: 'Fayl muvaffaqiyatli saqlandi va commit qilindi',
      filePath,
      commit: commitMsg
    });
  } catch (error: any) {
    console.error('File save error:', error);
    res.status(500).json({ error: 'Fayl saqlashda xatolik' });
  }
});

// Delete file
router.delete('/:owner/:repo/file', authenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;
    const { filePath, commitMessage } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'Fayl yo\'li kiritilishi kerak' });
    }

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    if (repository.owner_id !== req.user!.userId) {
      return res.status(403).json({ error: 'Fayl o\'chirish huquqi yo\'q' });
    }

    const repoPath = join(REPOS_DIR, owner, repo);
    const fullFilePath = join(repoPath, filePath);
    
    const { unlink } = await import('fs/promises');
    await unlink(fullFilePath);

    const git = simpleGit(repoPath);
    await git.add(filePath);
    
    const commitMsg = commitMessage || `Delete ${filePath}`;
    await git.commit(commitMsg);

    res.json({ message: 'Fayl muvaffaqiyatli o\'chirildi' });
  } catch (error: any) {
    console.error('File delete error:', error);
    res.status(500).json({ error: 'Fayl o\'chirishda xatolik' });
  }
});

// Push endpoint (simplified - in production use git-http-backend)
router.post('/:owner/:repo/push', authenticate, async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;
    const { branch, files } = req.body;

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).json({ error: 'Repository topilmadi' });
    }

    const repoPath = join(REPOS_DIR, owner, repo);
    const git = simpleGit(repoPath);

    // Write files
    for (const file of files) {
      const filePath = join(repoPath, file.path);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, file.content, 'utf8');
    }

    // Add, commit, and push
    await git.add('.');
    await git.commit(`Update files - ${new Date().toISOString()}`);
    
    try {
      await git.push('origin', branch || 'main');
    } catch {
      // If remote doesn't exist, just commit locally
    }

    res.json({ message: 'Muvaffaqiyatli push qilindi' });
  } catch (error: any) {
    console.error('Push error:', error);
    res.status(500).json({ error: 'Push xatosi' });
  }
});

export default router;

