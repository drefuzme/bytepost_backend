import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, mkdir, access } from 'fs/promises';
import { constants } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
const execAsync = promisify(exec);
const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMP_DIR = join(tmpdir(), 'git-platform-exec');
// Ensure temp directory exists
mkdir(TEMP_DIR, { recursive: true }).catch(() => { });
// Execute code
router.post('/execute', authenticate, async (req, res) => {
    try {
        const { code, language, filePath, input } = req.body;
        if (!code || !language) {
            return res.status(400).json({ error: 'Code va language kiritilishi kerak' });
        }
        // Supported languages
        const supportedLanguages = ['javascript', 'python', 'typescript', 'bash', 'shell'];
        if (!supportedLanguages.includes(language)) {
            return res.status(400).json({
                error: `Tillar qo'llab-quvvatlanmaydi. Qo'llab-quvvatlanadigan tillar: ${supportedLanguages.join(', ')}`
            });
        }
        let command = '';
        let tempFile = '';
        const timestamp = Date.now();
        const userId = req.user.userId;
        try {
            switch (language) {
                case 'javascript':
                    tempFile = join(TEMP_DIR, `${userId}_${timestamp}.js`);
                    await writeFile(tempFile, code, 'utf8');
                    command = `node "${tempFile}"`;
                    break;
                case 'typescript':
                    tempFile = join(TEMP_DIR, `${userId}_${timestamp}.ts`);
                    await writeFile(tempFile, code, 'utf8');
                    // Try to use ts-node if available, otherwise compile with tsc
                    command = `ts-node "${tempFile}" 2>&1 || (npx -y typescript && npx -y ts-node "${tempFile}")`;
                    break;
                case 'python':
                    tempFile = join(TEMP_DIR, `${userId}_${timestamp}.py`);
                    await writeFile(tempFile, code, 'utf8');
                    // Try to detect Python command (python3 or python)
                    let pythonCmd = 'python';
                    try {
                        await execAsync('python3 --version', { timeout: 2000 });
                        pythonCmd = 'python3';
                    }
                    catch (e) {
                        try {
                            await execAsync('python --version', { timeout: 2000 });
                            pythonCmd = 'python';
                        }
                        catch (e2) {
                            // Will fail later with better error message
                        }
                    }
                    // Check if requirements.txt exists in the same directory (if filePath is provided)
                    let requirementsPath = '';
                    if (filePath) {
                        const fileDir = dirname(filePath);
                        const reqPath = join(fileDir, 'requirements.txt');
                        try {
                            await access(reqPath, constants.F_OK);
                            requirementsPath = reqPath;
                        }
                        catch (e) {
                            // requirements.txt not found, continue without it
                        }
                    }
                    // Install requirements if found
                    if (requirementsPath) {
                        command = `${pythonCmd} -m pip install -r "${requirementsPath}" --quiet --disable-pip-version-check && ${pythonCmd} "${tempFile}"`;
                    }
                    else {
                        command = `${pythonCmd} "${tempFile}"`;
                    }
                    // Add input if provided
                    if (input) {
                        command = `echo "${input.replace(/"/g, '\\"')}" | ${command}`;
                    }
                    break;
                case 'bash':
                case 'shell':
                    tempFile = join(TEMP_DIR, `${userId}_${timestamp}.sh`);
                    await writeFile(tempFile, code, 'utf8');
                    // On Windows, use Git Bash or WSL if available
                    const isWindows = process.platform === 'win32';
                    if (isWindows) {
                        command = `bash "${tempFile}"`;
                    }
                    else {
                        command = `bash "${tempFile}"`;
                    }
                    break;
                default:
                    return res.status(400).json({ error: 'Til qo\'llab-quvvatlanmaydi' });
            }
            // Execute with timeout (30 seconds for Python, 10 seconds for others)
            const timeout = language === 'python' ? 30000 : 10000;
            const timeoutMessage = language === 'python'
                ? 'Timeout: Kod 30 soniyadan ko\'p vaqt olmoqda'
                : 'Timeout: Kod 10 soniyadan ko\'p vaqt olmoqda';
            const { stdout, stderr } = await Promise.race([
                execAsync(command, {
                    maxBuffer: 1024 * 1024 * 10, // 10MB
                    timeout: timeout,
                    encoding: 'utf8',
                }),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(timeoutMessage)), timeout);
                })
            ]);
            // Clean up temp file
            try {
                if (tempFile) {
                    await unlink(tempFile);
                }
            }
            catch (e) {
                // Ignore cleanup errors
            }
            res.json({
                success: true,
                stdout: stdout || '',
                stderr: stderr || '',
                exitCode: 0
            });
        }
        catch (error) {
            // Clean up temp file
            try {
                if (tempFile) {
                    await unlink(tempFile);
                }
            }
            catch (e) {
                // Ignore cleanup errors
            }
            // Check if it's a timeout
            if (error.message && error.message.includes('Timeout')) {
                return res.status(408).json({
                    success: false,
                    error: error.message,
                    stdout: '',
                    stderr: error.message,
                    exitCode: -1
                });
            }
            // Check if command failed
            if (error.code === 'ENOENT') {
                let errorMessage = '';
                if (language === 'python') {
                    errorMessage = 'Python o\'rnatilmagan. Iltimos, Python 3.x ni o\'rnating: https://www.python.org/downloads/';
                }
                else if (language === 'javascript') {
                    errorMessage = 'Node.js o\'rnatilmagan. Iltimos, Node.js ni o\'rnating: https://nodejs.org/';
                }
                else if (language === 'typescript') {
                    errorMessage = 'TypeScript o\'rnatilmagan. Iltimos, TypeScript ni o\'rnating: npm install -g typescript ts-node';
                }
                else {
                    errorMessage = `${language} o'rnatilmagan`;
                }
                return res.status(400).json({
                    success: false,
                    error: errorMessage,
                    stdout: '',
                    stderr: error.message,
                    exitCode: -1
                });
            }
            // Return stderr if available
            const errorOutput = error.stderr || error.stdout || error.message;
            res.status(400).json({
                success: false,
                error: 'Kod ishga tushirishda xatolik',
                stdout: error.stdout || '',
                stderr: errorOutput,
                exitCode: error.code || -1
            });
        }
    }
    catch (error) {
        console.error('Execute error:', error);
        res.status(500).json({
            success: false,
            error: 'Server xatosi',
            stdout: '',
            stderr: error.message,
            exitCode: -1
        });
    }
});
export default router;
//# sourceMappingURL=execute.js.map