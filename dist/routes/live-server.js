import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { writeFile, mkdir, readFile, readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { createServer } from 'http';
import { dbGet } from '../database/db.js';
import simpleGit from 'simple-git';
const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMP_DIR = join(tmpdir(), 'git-platform-live-server');
// Use environment variable for repos directory, fallback to relative path
const REPOS_DIR = process.env.REPOS_DIR || join(__dirname, '../../repositories');
// Store active servers
const activeServers = new Map();
// Ensure temp directory exists
mkdir(TEMP_DIR, { recursive: true }).catch(() => { });
// Helper function to recursively read repository files
async function readRepoFiles(repoPath, branch = 'main', basePath = '') {
    const files = [];
    const git = simpleGit(repoPath);
    try {
        // Try to get files from git
        const fileList = await git.raw(['ls-tree', '-r', '--name-only', branch]);
        const filePaths = fileList.trim().split('\n').filter(p => p);
        for (const filePath of filePaths) {
            try {
                const content = await git.show([`${branch}:${filePath}`]);
                files.push({
                    path: filePath,
                    content: content
                });
            }
            catch (err) {
                // Skip if file can't be read
                console.log(`Skipping file ${filePath}:`, err);
            }
        }
    }
    catch (err) {
        // Fallback to filesystem
        try {
            const entries = await readdir(repoPath);
            for (const entry of entries) {
                const fullPath = join(repoPath, entry);
                const stats = await stat(fullPath);
                const relativePath = basePath ? join(basePath, entry) : entry;
                if (stats.isDirectory()) {
                    const subFiles = await readRepoFiles(fullPath, branch, relativePath);
                    files.push(...subFiles);
                }
                else {
                    const content = await readFile(fullPath, 'utf8');
                    files.push({
                        path: relativePath,
                        content: content
                    });
                }
            }
        }
        catch (fsErr) {
            console.error('Error reading from filesystem:', fsErr);
        }
    }
    return files;
}
// Start live server from repository
router.post('/live-server/start-from-repo', authenticate, async (req, res) => {
    try {
        const { owner, repo, branch = 'main', htmlPath, port } = req.body;
        const userId = req.user.userId;
        const serverId = `${userId}_${Date.now()}`;
        if (!owner || !repo) {
            return res.status(400).json({ error: 'Owner va repo kiritilishi kerak' });
        }
        // Check repository access
        const repository = await dbGet(`
      SELECT r.* FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE u.username = ? AND r.name = ?
    `, [owner, repo]);
        if (!repository) {
            return res.status(404).json({ error: 'Repository topilmadi' });
        }
        // Check if user has access
        const isOwner = repository.owner_id === userId;
        const isPublic = !repository.is_private;
        // Check if user is collaborator
        let isCollaborator = false;
        if (!isOwner && !isPublic) {
            const collaborator = await dbGet('SELECT * FROM repository_collaborators WHERE repository_id = ? AND user_id = ?', [repository.id, userId]);
            isCollaborator = !!collaborator;
        }
        if (!isOwner && !isPublic && !isCollaborator) {
            return res.status(403).json({ error: 'Bu repository\'ga kirish huquqi yo\'q' });
        }
        const repoPath = join(REPOS_DIR, owner, repo);
        const serverPort = port || 3000 + Math.floor(Math.random() * 1000);
        const serverDir = join(TEMP_DIR, serverId);
        // Create server directory
        await mkdir(serverDir, { recursive: true });
        // Read all files from repository
        const files = await readRepoFiles(repoPath, branch);
        if (files.length === 0) {
            return res.status(400).json({ error: 'Repository bo\'sh' });
        }
        // Find HTML file
        let htmlFile = files.find((f) => f.path === htmlPath);
        if (!htmlFile) {
            htmlFile = files.find((f) => f.path.endsWith('.html') || f.path.endsWith('.htm'));
        }
        if (!htmlFile) {
            return res.status(400).json({ error: 'HTML fayl topilmadi' });
        }
        // Get HTML file directory for base path
        const htmlDir = dirname(htmlFile.path);
        const basePath = htmlDir === '.' ? '' : htmlDir;
        // Write all files to server directory
        for (const file of files) {
            const filePath = join(serverDir, file.path);
            const fileDir = dirname(filePath);
            await mkdir(fileDir, { recursive: true });
            await writeFile(filePath, file.content || '', 'utf8');
        }
        // Create HTTP server
        const httpServer = createServer(async (req, res) => {
            try {
                let requestedPath = req.url?.split('?')[0] || '/';
                // Handle root path - serve HTML file
                if (requestedPath === '/') {
                    requestedPath = '/' + htmlFile.path;
                }
                // Remove leading slash
                let filePath = requestedPath.startsWith('/') ? requestedPath.substring(1) : requestedPath;
                // Normalize path separators
                filePath = filePath.replace(/\\/g, '/');
                // Try to find the file - first check if it exists as-is
                let fullPath = join(serverDir, filePath);
                let fileExists = false;
                try {
                    await stat(fullPath);
                    fileExists = true;
                    console.log(`[Live Server] File found at: ${fullPath}`);
                }
                catch (e) {
                    // File doesn't exist at this path, try resolving relative to HTML file directory
                    if (basePath) {
                        const relativePath = join(basePath, filePath).replace(/\\/g, '/');
                        const relativeFullPath = join(serverDir, relativePath);
                        try {
                            await stat(relativeFullPath);
                            fileExists = true;
                            filePath = relativePath;
                            fullPath = relativeFullPath;
                            console.log(`[Live Server] File found at relative path: ${fullPath}`);
                        }
                        catch (e2) {
                            // Try from root (if file is in root but HTML is in subdirectory)
                            const rootPath = join(serverDir, filePath);
                            try {
                                await stat(rootPath);
                                fileExists = true;
                                fullPath = rootPath;
                                console.log(`[Live Server] File found at root: ${fullPath}`);
                            }
                            catch (e3) {
                                console.log(`[Live Server] File not found: ${filePath}`);
                            }
                        }
                    }
                    else {
                        // No base path, try root
                        try {
                            await stat(fullPath);
                            fileExists = true;
                            console.log(`[Live Server] File found at root: ${fullPath}`);
                        }
                        catch (e3) {
                            console.log(`[Live Server] File not found: ${filePath}`);
                        }
                    }
                }
                // Security check - ensure path is within serverDir
                if (!fullPath.startsWith(serverDir)) {
                    res.writeHead(403, { 'Content-Type': 'text/plain' });
                    res.end('Forbidden');
                    return;
                }
                try {
                    const content = await readFile(fullPath, 'utf8');
                    // Set content type
                    let contentType = 'text/html';
                    if (filePath.endsWith('.css'))
                        contentType = 'text/css';
                    else if (filePath.endsWith('.js'))
                        contentType = 'application/javascript';
                    else if (filePath.endsWith('.json'))
                        contentType = 'application/json';
                    else if (filePath.endsWith('.png'))
                        contentType = 'image/png';
                    else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg'))
                        contentType = 'image/jpeg';
                    else if (filePath.endsWith('.svg'))
                        contentType = 'image/svg+xml';
                    else if (filePath.endsWith('.gif'))
                        contentType = 'image/gif';
                    else if (filePath.endsWith('.webp'))
                        contentType = 'image/webp';
                    else if (filePath.endsWith('.woff') || filePath.endsWith('.woff2'))
                        contentType = 'font/woff';
                    else if (filePath.endsWith('.ttf'))
                        contentType = 'font/ttf';
                    else if (filePath.endsWith('.eot'))
                        contentType = 'application/vnd.ms-fontobject';
                    else if (filePath.endsWith('.otf'))
                        contentType = 'font/otf';
                    res.writeHead(200, {
                        'Content-Type': contentType,
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type'
                    });
                    res.end(content);
                }
                catch (error) {
                    console.log(`[Live Server] Error reading file: ${filePath} (requested: ${requestedPath})`);
                    console.log(`[Live Server] Full path: ${fullPath}`);
                    console.log(`[Live Server] Error:`, error);
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('File not found: ' + filePath);
                }
            }
            catch (error) {
                console.error('Server error:', error);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Server error');
            }
        });
        // Start server
        httpServer.listen(serverPort, () => {
            console.log(`Live server started on port ${serverPort} for repo ${owner}/${repo} (branch: ${branch})`);
        });
        // Store server info
        activeServers.set(serverId, {
            port: serverPort,
            process: httpServer,
            repoPath: `${owner}/${repo}`,
            branch: branch
        });
        res.json({
            success: true,
            serverId,
            port: serverPort,
            url: `http://localhost:${serverPort}`,
            htmlFile: htmlFile.path,
            message: 'Live server muvaffaqiyatli ishga tushdi'
        });
    }
    catch (error) {
        console.error('Live server start from repo error:', error);
        res.status(500).json({
            success: false,
            error: 'Live server ishga tushirishda xatolik',
            message: error.message
        });
    }
});
// Start live server
router.post('/live-server/start', authenticate, async (req, res) => {
    try {
        const { files, port } = req.body;
        const userId = req.user.userId;
        const serverId = `${userId}_${Date.now()}`;
        if (!files || !Array.isArray(files) || files.length === 0) {
            return res.status(400).json({ error: 'Fayllar kiritilishi kerak' });
        }
        // Find HTML file
        const htmlFile = files.find((f) => f.path.endsWith('.html') || f.path.endsWith('.htm'));
        if (!htmlFile) {
            return res.status(400).json({ error: 'HTML fayl topilmadi' });
        }
        const serverPort = port || 3000 + Math.floor(Math.random() * 1000);
        const serverDir = join(TEMP_DIR, serverId);
        // Create server directory
        await mkdir(serverDir, { recursive: true });
        // Write all files
        for (const file of files) {
            const filePath = join(serverDir, file.path);
            const fileDir = dirname(filePath);
            await mkdir(fileDir, { recursive: true });
            await writeFile(filePath, file.content || '', 'utf8');
        }
        // Get HTML file directory for base path
        const htmlDirForFiles = dirname(htmlFile.path);
        const basePathForFiles = htmlDirForFiles === '.' ? '' : htmlDirForFiles;
        // Create simple HTTP server
        const httpServer = createServer(async (req, res) => {
            try {
                let requestedPath = req.url?.split('?')[0] || '/';
                // Handle root path - serve HTML file
                if (requestedPath === '/') {
                    requestedPath = '/' + htmlFile.path;
                }
                // Remove leading slash
                let filePath = requestedPath.startsWith('/') ? requestedPath.substring(1) : requestedPath;
                // Normalize path separators
                filePath = filePath.replace(/\\/g, '/');
                console.log(`[Live Server] Request: ${requestedPath} -> Resolved: ${filePath}`);
                console.log(`[Live Server] Base path: ${basePathForFiles}, HTML file: ${htmlFile.path}`);
                // Try to find the file - first check if it exists as-is
                let fullPath = join(serverDir, filePath);
                let fileExists = false;
                try {
                    await stat(fullPath);
                    fileExists = true;
                    console.log(`[Live Server] File found at: ${fullPath}`);
                }
                catch (e) {
                    // File doesn't exist at this path, try resolving relative to HTML file directory
                    if (basePathForFiles) {
                        const relativePath = join(basePathForFiles, filePath).replace(/\\/g, '/');
                        const relativeFullPath = join(serverDir, relativePath);
                        try {
                            await stat(relativeFullPath);
                            fileExists = true;
                            filePath = relativePath;
                            fullPath = relativeFullPath;
                            console.log(`[Live Server] File found at relative path: ${fullPath}`);
                        }
                        catch (e2) {
                            // Try from root (if file is in root but HTML is in subdirectory)
                            const rootPath = join(serverDir, filePath);
                            try {
                                await stat(rootPath);
                                fileExists = true;
                                fullPath = rootPath;
                                console.log(`[Live Server] File found at root: ${fullPath}`);
                            }
                            catch (e3) {
                                console.log(`[Live Server] File not found: ${filePath}`);
                            }
                        }
                    }
                    else {
                        // No base path, try root
                        try {
                            await stat(fullPath);
                            fileExists = true;
                            console.log(`[Live Server] File found at root: ${fullPath}`);
                        }
                        catch (e3) {
                            console.log(`[Live Server] File not found: ${filePath}`);
                        }
                    }
                }
                // Security check - ensure path is within serverDir
                if (!fullPath.startsWith(serverDir)) {
                    res.writeHead(403, { 'Content-Type': 'text/plain' });
                    res.end('Forbidden');
                    return;
                }
                try {
                    const content = await readFile(fullPath, 'utf8');
                    // Set content type
                    let contentType = 'text/html';
                    if (filePath.endsWith('.css'))
                        contentType = 'text/css';
                    else if (filePath.endsWith('.js'))
                        contentType = 'application/javascript';
                    else if (filePath.endsWith('.json'))
                        contentType = 'application/json';
                    else if (filePath.endsWith('.png'))
                        contentType = 'image/png';
                    else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg'))
                        contentType = 'image/jpeg';
                    else if (filePath.endsWith('.svg'))
                        contentType = 'image/svg+xml';
                    else if (filePath.endsWith('.gif'))
                        contentType = 'image/gif';
                    else if (filePath.endsWith('.webp'))
                        contentType = 'image/webp';
                    else if (filePath.endsWith('.woff') || filePath.endsWith('.woff2'))
                        contentType = 'font/woff';
                    else if (filePath.endsWith('.ttf'))
                        contentType = 'font/ttf';
                    else if (filePath.endsWith('.eot'))
                        contentType = 'application/vnd.ms-fontobject';
                    else if (filePath.endsWith('.otf'))
                        contentType = 'font/otf';
                    res.writeHead(200, {
                        'Content-Type': contentType,
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type'
                    });
                    res.end(content);
                }
                catch (error) {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('File not found');
                }
            }
            catch (error) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Server error');
            }
        });
        // Start server
        httpServer.listen(serverPort, () => {
            console.log(`Live server started on port ${serverPort} for user ${userId}`);
        });
        // Store server info
        activeServers.set(serverId, {
            port: serverPort,
            process: httpServer
        });
        res.json({
            success: true,
            serverId,
            port: serverPort,
            url: `http://localhost:${serverPort}`,
            message: 'Live server muvaffaqiyatli ishga tushdi'
        });
    }
    catch (error) {
        console.error('Live server start error:', error);
        res.status(500).json({
            success: false,
            error: 'Live server ishga tushirishda xatolik',
            message: error.message
        });
    }
});
// Stop live server
router.post('/live-server/stop', authenticate, async (req, res) => {
    try {
        const { serverId } = req.body;
        const userId = req.user.userId;
        if (!serverId) {
            return res.status(400).json({ error: 'Server ID kiritilishi kerak' });
        }
        // Check if server belongs to user
        if (!serverId.startsWith(userId)) {
            return res.status(403).json({ error: 'Bu server sizga tegishli emas' });
        }
        const server = activeServers.get(serverId);
        if (!server) {
            return res.status(404).json({ error: 'Server topilmadi' });
        }
        // Close server
        if (server.process) {
            server.process.close(() => {
                console.log(`Live server stopped: ${serverId}`);
            });
        }
        // Remove from map
        activeServers.delete(serverId);
        res.json({
            success: true,
            message: 'Live server to\'xtatildi'
        });
    }
    catch (error) {
        console.error('Live server stop error:', error);
        res.status(500).json({
            success: false,
            error: 'Live server to\'xtatishda xatolik',
            message: error.message
        });
    }
});
// Get active servers for user
router.get('/live-server/active', authenticate, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userServers = Array.from(activeServers.entries())
            .filter(([id]) => id.startsWith(userId))
            .map(([id, server]) => ({
            serverId: id,
            port: server.port,
            url: `http://localhost:${server.port}`
        }));
        res.json({
            success: true,
            servers: userServers
        });
    }
    catch (error) {
        console.error('Get active servers error:', error);
        res.status(500).json({
            success: false,
            error: 'Serverlarni olishda xatolik',
            message: error.message
        });
    }
});
export default router;
//# sourceMappingURL=live-server.js.map