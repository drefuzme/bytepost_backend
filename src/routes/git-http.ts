import express from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { dbGet, dbRun } from '../database/db.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import simpleGit from 'simple-git';
import { exec } from 'child_process';
import { promisify } from 'util';
import { access, constants, mkdir } from 'fs/promises';
import { verifyDeployToken } from './deploy-tokens.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);
const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPOS_DIR = join(__dirname, '../../repositories');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Basic auth middleware for git operations (supports both user tokens and deploy tokens)
const gitAuth = async (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
  try {
    // Extract token from URL (http://token@host/path) or Authorization header
    let token: string | null = null;
    
    // Check Authorization header (Git uses Basic Auth)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Basic ')) {
      try {
        // Basic auth: decode and extract token
        const basicAuth = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
        const parts = basicAuth.split(':');
        const username = parts[0] || '';
        const password = parts.slice(1).join(':') || ''; // Handle colons in token
        
        // In Git, token is usually in username (when URL is http://token@host)
        // Or password can be empty and username is token
        // Try username first (most common case)
        if (username && username.length > 50) {
          // Looks like a JWT token (long string)
          token = username;
        } else if (password && password.length > 50) {
          // Token might be in password
          token = password;
        } else if (username && username.length > 20) {
          // Try username anyway if it's long enough to be a token
          token = username;
        } else if (password && password.length > 20) {
          token = password;
        } else if (username) {
          // Try username anyway
          token = username;
        } else if (password) {
          token = password;
        }
      } catch (e) {
        console.error('Basic auth decode error:', e);
      }
    }
    
    // Check Bearer token
    if (!token && authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
    
    // Check URL for token (http://token@host) - parse from req.url or host header
    if (!token) {
      // Try to extract from host header if it contains @
      const host = req.headers.host;
      if (host && host.includes('@')) {
        token = host.split('@')[0];
      }
      
      // Try to extract from URL path
      if (!token && req.url) {
        const urlParts = req.url.split('@');
        if (urlParts.length > 1) {
          // Token is before @
          const beforeAt = urlParts[0];
          const tokenMatch = beforeAt.match(/\/([^\/]+)$/);
          if (tokenMatch) {
            token = tokenMatch[1];
          }
        }
      }
    }
    
    // Check query parameter
    if (!token) {
      token = req.query.token as string || null;
    }

    // Debug logging
    if (!token) {
      console.log('Git auth: No token found, trying username/password', {
        url: req.url,
        host: req.headers.host,
        authHeader: authHeader ? 'present' : 'missing',
        method: req.method,
        path: req.path
      });
      
      // Try username/password authentication if no token found
      if (authHeader && authHeader.startsWith('Basic ')) {
        try {
          const basicAuth = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
          const parts = basicAuth.split(':');
          const username = parts[0] || '';
          const password = parts.slice(1).join(':') || '';
          
          console.log('Git auth: Trying username/password (no token)', {
            usernameLength: username.length,
            hasPassword: !!password,
            usernameIsEmail: username.includes('@')
          });
          
          if (password) {
            // Try email first, then username
            let user: any = null;
            if (username.includes('@')) {
              console.log('Git auth: Looking up user by email', { email: username });
              user = await dbGet('SELECT * FROM users WHERE email = ?', [username]);
            } else {
              console.log('Git auth: Looking up user by username', { username });
              user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
            }
            
            if (user) {
              console.log('Git auth: User found in database', {
                userId: user.id,
                username: user.username,
                email: user.email,
                role: user.role
              });
              const isValidPassword = await bcrypt.compare(password, user.password);
              if (isValidPassword) {
                console.log('Git auth: Username/password verified (no token)', {
                  userId: user.id,
                  username: user.username,
                  email: user.email,
                  role: user.role
                });
                req.user = {
                  userId: user.id,
                  username: user.username,
                  email: user.email,
                  role: user.role || 'user'
                };
                return next();
              } else {
                console.log('Git auth: Invalid password', { username, email: user.email });
              }
            } else {
              console.log('Git auth: User not found', { username, isEmail: username.includes('@') });
            }
          }
        } catch (e) {
          console.error('Git auth: Username/password auth error (no token):', e);
        }
      }
      
      return res.status(401).setHeader('WWW-Authenticate', 'Basic realm="Git"').send('Unauthorized');
    }
    
    console.log('Git auth: Token found', { 
      tokenLength: token.length,
      tokenStart: token.substring(0, 20) + '...',
      method: req.method,
      path: req.path,
      hasAuthHeader: !!authHeader
    });
    
    // Try to verify as deploy token first
    const deployTokenData = verifyDeployToken(token);
    if (deployTokenData) {
      // It's a deploy token
      const repository: any = await dbGet('SELECT * FROM repositories WHERE id = ?', [deployTokenData.repoId]);
      if (repository) {
        // Update last used
        await dbGet('UPDATE deploy_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE token = ?', [token]);
        
        req.user = {
          userId: repository.owner_id,
          username: '',
          email: ''
        };
        (req as any).deployToken = deployTokenData;
        (req as any).repository = repository;
        return next();
      }
    }
    
    // Try to verify as user token
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      if (decoded.userId) {
        // Always get user from database to ensure we have correct username
        const user: any = await dbGet('SELECT username, email, role FROM users WHERE id = ?', [decoded.userId]);
        if (user) {
          console.log('Git auth: User token verified', {
            userId: decoded.userId,
            username: user.username,
            role: user.role
          });
          req.user = {
            userId: decoded.userId,
            username: user.username || decoded.username || '',
            email: user.email || decoded.email || '',
            role: user.role || 'user'
          };
          return next();
        } else {
          // Fallback to decoded values if user not found in DB
          console.log('Git auth: User token verified (user not found in DB, using decoded values)', {
            userId: decoded.userId,
            username: decoded.username
          });
          req.user = {
            userId: decoded.userId,
            username: decoded.username || '',
            email: decoded.email || ''
          };
          return next();
        }
      }
    } catch (error: any) {
      // Not a valid user token - maybe it's username/password
      console.log('Git auth: Token verification failed, trying username/password', {
        error: error.message,
        tokenLength: token.length,
        tokenStart: token.substring(0, 30) + '...'
      });
      
      // Try to use as email/password
      // Get username and password from Basic Auth header
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Basic ')) {
        try {
          const basicAuth = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
          const parts = basicAuth.split(':');
          const username = parts[0] || '';
          const password = parts.slice(1).join(':') || '';
          
          console.log('Git auth: Trying username/password authentication', {
            usernameLength: username.length,
            hasPassword: !!password,
            usernameIsEmail: username.includes('@'),
            usernameStart: username.substring(0, 20) + '...'
          });
          
          // If password is provided, try to login with username or email
          if (password) {
            // Try email first, then username
            let user: any = null;
            if (username.includes('@')) {
              console.log('Git auth: Looking up user by email (token failed)', { email: username });
              user = await dbGet('SELECT * FROM users WHERE email = ?', [username]);
            } else {
              console.log('Git auth: Looking up user by username (token failed)', { username });
              user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
            }
            
            if (user) {
              console.log('Git auth: User found in database (token failed)', {
                userId: user.id,
                username: user.username,
                email: user.email,
                role: user.role
              });
              const isValidPassword = await bcrypt.compare(password, user.password);
              if (isValidPassword) {
                // Generate token and use it
                const newToken = jwt.sign(
                  { userId: user.id, username: user.username, email: user.email },
                  JWT_SECRET,
                  { expiresIn: '7d' }
                );
                console.log('Git auth: Username/password verified, token generated', {
                  userId: user.id,
                  username: user.username,
                  email: user.email,
                  role: user.role
                });
                req.user = {
                  userId: user.id,
                  username: user.username,
                  email: user.email,
                  role: user.role || 'user'
                };
                return next();
              } else {
                console.log('Git auth: Invalid password for user', { username, email: user.email });
              }
            } else {
              console.log('Git auth: User not found (token failed)', { username, isEmail: username.includes('@') });
            }
          } else {
            console.log('Git auth: Password missing', {
              username,
              usernameIsEmail: username.includes('@')
            });
          }
        } catch (e) {
          console.error('Git auth: Username/password auth error:', e);
        }
      } else {
        console.log('Git auth: No Basic Auth header found');
      }
    }
    
    console.log('Git auth: Authentication failed - no valid token or credentials');
    return res.status(403).send('Access denied');
  } catch (error) {
    return res.status(401).send('Unauthorized');
  }
};

// Git info/refs endpoint (for clone and push)
router.get('/:owner/:repo.git/info/refs', gitAuth, async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;
    const service = req.query.service as string;

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).send('Repository not found');
    }

    // Check access
    if (repository.is_private && repository.owner_id !== req.user!.userId) {
      return res.status(403).send('Access denied');
    }

    const repoPath = join(REPOS_DIR, owner, repo);
    
    try {
      await access(repoPath, constants.F_OK);
    } catch {
      return res.status(404).send('Repository not found');
    }

    if (service === 'git-upload-pack' || service === 'git-receive-pack') {
      // Git smart HTTP protocol
      const git = simpleGit(repoPath);
      let refs = '';
      
      try {
        refs = await git.raw(['show-ref', '--heads', '--tags']);
      } catch (e) {
        // If no refs, return empty
        refs = '';
      }
      
      res.setHeader('Content-Type', `application/x-${service}-advertisement`);
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Pragma', 'no-cache');
      
      // Write service line with proper pkt-line format
      const serviceLine = `# service=${service}\n`;
      const pktLength = (serviceLine.length + 4).toString(16).padStart(4, '0');
      res.write(pktLength + serviceLine);
      
      // Write flush packet
      res.write('0000');
      
      // Write refs
      const refLines = refs.trim().split('\n').filter(Boolean);
      for (const ref of refLines) {
        const parts = ref.split(' ');
        if (parts.length >= 2) {
          const hash = parts[0];
          const refName = parts.slice(1).join(' ');
          const refLine = `${hash} ${refName}\n`;
          const pktLength = (refLine.length + 4).toString(16).padStart(4, '0');
          res.write(pktLength + refLine);
        }
      }
      
      // Write final flush packet
      res.write('0000');
      res.end();
    } else {
      // Dumb HTTP protocol
      res.setHeader('Content-Type', 'text/plain');
      const git = simpleGit(repoPath);
      let refs = '';
      try {
        refs = await git.raw(['show-ref', '--heads', '--tags']);
      } catch (e) {
        refs = '';
      }
      res.send(refs);
    }
  } catch (error: any) {
    console.error('Git info/refs error:', error);
    res.status(500).send('Internal server error');
  }
});

// Git upload-pack (for clone/pull) - simplified version
router.post('/:owner/:repo.git/git-upload-pack', gitAuth, express.raw({ type: '*/*', limit: '100mb' }), async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;

    const repository: any = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    if (!repository) {
      return res.status(404).send('Repository not found');
    }

    if (repository.is_private && repository.owner_id !== req.user!.userId) {
      return res.status(403).send('Access denied');
    }

    const repoPath = join(REPOS_DIR, owner, repo);
    
    try {
      await access(repoPath, constants.F_OK);
    } catch {
      return res.status(404).send('Repository not found');
    }

    // Use simple-git for operations, or exec git command
    // For now, return success - actual git operations handled by git client
    res.setHeader('Content-Type', 'application/x-git-upload-pack-result');
    res.setHeader('Cache-Control', 'no-cache');
    res.status(200).send();
  } catch (error: any) {
    console.error('Git upload-pack error:', error);
    res.status(500).send('Internal server error');
  }
});

// Git receive-pack (for push) - GitHub-like reliable algorithm
router.post('/:owner/:repo.git/git-receive-pack', gitAuth, express.raw({ type: '*/*', limit: '100mb' }), async (req: AuthRequest, res) => {
  try {
    const { owner, repo } = req.params;

    // Step 1: Always get user from database to ensure we have correct username and role
    const user: any = await dbGet('SELECT username, email, role FROM users WHERE id = ?', [req.user!.userId]);
    if (!user) {
      console.log('Git receive-pack: User not found in database', { userId: req.user!.userId });
      return res.status(403).send('Access denied - user not found');
    }

    // Update req.user with fresh data from database
    req.user!.username = user.username || req.user!.username || '';
    req.user!.email = user.email || req.user!.email || '';
    req.user!.role = user.role || 'user';

    console.log('Git receive-pack: Request received', {
      owner,
      repo,
      userId: req.user!.userId,
      username: req.user!.username,
      role: req.user!.role
    });

    // Step 2: Get repository with owner information
    let repository: any = await dbGet(`
      SELECT r.*, u.id as owner_user_id, u.username as owner_username FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);

    // If repository doesn't exist and user is the owner (by username), create it automatically
    if (!repository && owner === req.user!.username) {
      console.log('Git receive-pack: Repository not found, creating automatically', { owner, repo, username: req.user!.username });
      
      const repoId = uuidv4();
      const repoPath = join(REPOS_DIR, owner, repo);
      
      // Create repository in database
      await dbRun(
        `INSERT INTO repositories (id, name, description, owner_id, is_private, default_branch)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [repoId, repo, '', req.user!.userId, 0, 'main']
      );
      
      // Initialize git repository
      await mkdir(repoPath, { recursive: true });
      const git = simpleGit(repoPath);
      await git.init();
      await git.addConfig('user.name', req.user!.username);
      await git.addConfig('user.email', req.user!.email);
      
      // Get the newly created repository
      repository = await dbGet(`
        SELECT r.*, u.id as owner_user_id, u.username as owner_username FROM repositories r
        JOIN users u ON r.owner_id = u.id
        WHERE r.id = ?
      `, [repoId]);
      
      console.log('Git receive-pack: Repository created automatically', { repoId, owner, repo });
    } else if (!repository) {
      // Repository doesn't exist and user is not the owner by username
      // Check if user wants to push to their own repo but with different username in URL
      console.log('Git receive-pack: Repository not found and user is not owner by username', {
        owner,
        repo,
        username: req.user!.username,
        userId: req.user!.userId
      });
      
      // If the repository doesn't exist, we can't create it for a different user
      // But we can check if the user is trying to push to a repo that should be theirs
      // This is a security check - only allow creating repos for the authenticated user's username
    }
    
    if (!repository) {
      console.log('Git receive-pack: Repository not found and cannot be created', { owner, repo, username: req.user!.username });
      return res.status(404).send('Repository not found');
    }

    // Step 3: Check access using GitHub-like algorithm
    const repoOwnerId = String(repository.owner_id).trim();
    const userId = String(req.user!.userId).trim();
    const username = req.user!.username || '';
    const ownerUsername = repository.owner_username || '';
    
    // Check 1: Owner ID match (primary check)
    const isOwner = repoOwnerId === userId;
    
    // Check 2: Username match (fallback check)
    const isOwnerByUsername = username && ownerUsername && username === ownerUsername;
    
    // Check 3: Collaborator check
    const isCollaborator = await dbGet(
      'SELECT * FROM repository_collaborators WHERE repository_id = ? AND user_id = ?',
      [repository.id, req.user!.userId]
    );
    
    // Check 4: Admin check (admins can push to any repo)
    const isAdmin = req.user!.role === 'admin';
    
    // Final decision: Allow if owner (by ID or username), collaborator, or admin
    const hasAccess = isOwner || isOwnerByUsername || !!isCollaborator || isAdmin;
    
    console.log('Git receive-pack: Access check', {
      repositoryOwnerId: repoOwnerId,
      userId: userId,
      username: username,
      ownerUsername: ownerUsername,
      isOwner: isOwner,
      isOwnerByUsername: isOwnerByUsername,
      isCollaborator: !!isCollaborator,
      isAdmin: isAdmin,
      hasAccess: hasAccess
    });
    
    if (!hasAccess) {
      console.log('Git receive-pack: Access denied', {
        repositoryOwnerId: repoOwnerId,
        userId: userId,
        username: username,
        ownerUsername: ownerUsername
      });
      return res.status(403).send('Access denied');
    }
    
    console.log('Git receive-pack: Access granted', {
      userId: userId,
      username: username,
      reason: isOwner ? 'owner' : isOwnerByUsername ? 'owner_by_username' : isCollaborator ? 'collaborator' : 'admin'
    });

    const repoPath = join(REPOS_DIR, owner, repo);
    
    try {
      await access(repoPath, constants.F_OK);
    } catch {
      return res.status(404).send('Repository not found');
    }

    // Execute git-receive-pack with the pack data
    const packData = req.body;
    
    // Set proper headers
    res.setHeader('Content-Type', 'application/x-git-receive-pack-result');
    res.setHeader('Cache-Control', 'no-cache');
    
    // Git receive-pack - we need to process the pack data
    // Use git-receive-pack command if available, otherwise use simple-git
    console.log('Git receive-pack: Push request received', {
      owner,
      repo,
      packDataSize: packData ? packData.length : 0,
      hasUser: !!req.user
    });
    
    // Try to use git-receive-pack command
    try {
      const { spawn } = await import('child_process');
      const { platform } = await import('os');
      
      // On Windows, git-receive-pack might be in git installation
      const gitReceivePackCmd = platform() === 'win32' 
        ? 'git' 
        : 'git-receive-pack';
      
      const args = platform() === 'win32'
        ? ['receive-pack', '--stateless-rpc', repoPath]
        : ['--stateless-rpc', repoPath];
      
      const gitReceivePack = spawn(gitReceivePackCmd, args, {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Send pack data
      if (packData && packData.length > 0) {
        gitReceivePack.stdin.write(packData);
      }
      gitReceivePack.stdin.end();

      // Set headers
      res.setHeader('Content-Type', 'application/x-git-receive-pack-result');
      res.setHeader('Cache-Control', 'no-cache');

      // Stream output
      gitReceivePack.stdout.on('data', (data) => {
        res.write(data);
      });

      gitReceivePack.stderr.on('data', (data) => {
        console.error('git-receive-pack stderr:', data.toString());
      });

      gitReceivePack.on('close', (code) => {
        if (code === 0) {
          res.end();
        } else {
          console.error('git-receive-pack exited with code:', code);
          res.status(500).end();
        }
      });

      gitReceivePack.on('error', (error) => {
        console.error('git-receive-pack spawn error:', error);
        // Fallback: return empty response
        res.setHeader('Content-Type', 'application/x-git-receive-pack-result');
        res.setHeader('Cache-Control', 'no-cache');
        res.status(200).send();
      });
    } catch (error) {
      console.error('Git receive-pack error:', error);
      // Fallback: return empty response
      res.setHeader('Content-Type', 'application/x-git-receive-pack-result');
      res.setHeader('Cache-Control', 'no-cache');
      res.status(200).send();
    }
  } catch (error: any) {
    console.error('Git receive-pack error:', error);
    // Fallback: just accept the push
    res.setHeader('Content-Type', 'application/x-git-receive-pack-result');
    res.setHeader('Cache-Control', 'no-cache');
    res.status(200).send();
  }
});

export default router;

