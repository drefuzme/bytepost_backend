import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const PORT = process.env.PORT || 5000;
// CORS configuration with frontend URL
app.use(cors({
    origin: [
        'http://localhost:3000',
        'http://localhost:5173',
        'https://bytepostorg.vercel.app',
        'https://drefuz.info',
        'https://www.drefuz.info'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Routes
import authRoutes from './routes/auth.js';
import repoRoutes from './routes/repositories.js';
import gitRoutes from './routes/git.js';
import gitPushRoutes from './routes/git-push.js';
import gitHttpRoutes from './routes/git-http.js';
import userRoutes from './routes/users.js';
import deployTokenRoutes from './routes/deploy-tokens.js';
import executeRoutes from './routes/execute.js';
import liveServerRoutes from './routes/live-server.js';
import postsRoutes from './routes/posts.js';
import uploadRoutes from './routes/upload.js';
import chatRoutes from './routes/chat.js';
import issuesRoutes from './routes/issues.js';
import pullRequestsRoutes from './routes/pull-requests.js';
import notificationsRoutes from './routes/notifications.js';
import searchRoutes from './routes/search.js';
import uploadFilesRoutes from './routes/upload-files.js';
import adminRoutes from './routes/admin.js';
app.use('/api/auth', authRoutes);
app.use('/api/repos', repoRoutes);
app.use('/api/repos', deployTokenRoutes);
app.use('/api/git', gitRoutes);
app.use('/api/git', gitPushRoutes);
app.use('/api/users', userRoutes);
app.use('/api', executeRoutes);
app.use('/api', liveServerRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api', uploadRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/repos', issuesRoutes);
app.use('/api/repos', pullRequestsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/repos', uploadFilesRoutes);
app.use('/api/admin', adminRoutes);
// Serve uploaded files
app.use('/uploads', express.static(join(__dirname, '../uploads')));
// Git HTTP backend (for git clone/push)
app.use('/', gitHttpRoutes);
// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'BytePost API is running' });
});
app.listen(PORT, () => {
    console.log(` Server is running on http://localhost:${PORT}`);
});
//# sourceMappingURL=index.js.map