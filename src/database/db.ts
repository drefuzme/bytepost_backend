import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '../../data/database.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('✅ Connected to SQLite database');
    initializeDatabase();
  }
});

// Promisify database methods with proper parameter handling
export const dbRun = (sql: string, params: any[] = []): Promise<any> => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

export const dbGet = (sql: string, params: any[] = []): Promise<any> => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export const dbAll = (sql: string, params: any[] = []): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

function initializeDatabase() {

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar_url TEXT,
      role TEXT DEFAULT 'user',
      is_banned INTEGER DEFAULT 0,
      ban_reason TEXT,
      banned_at DATETIME,
      last_active DATETIME,
      is_verified INTEGER DEFAULT 0,
      icon_type TEXT DEFAULT 'user',
      verify_icon_type TEXT DEFAULT 'checkCircle2',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add role column if it doesn't exist (for existing databases)
  db.run(`
    ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'
  `, (err) => {
    // Ignore error if column already exists
  });

  // Add ban columns if they don't exist
  db.run(`
    ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0
  `, (err) => {
    // Ignore error if column already exists
  });

  db.run(`
    ALTER TABLE users ADD COLUMN ban_reason TEXT
  `, (err) => {
    // Ignore error if column already exists
  });

  db.run(`
    ALTER TABLE users ADD COLUMN banned_at DATETIME
  `, (err) => {
    // Ignore error if column already exists
  });

  db.run(`
    ALTER TABLE users ADD COLUMN last_active DATETIME
  `, (err) => {
    // Ignore error if column already exists
  });

  // Add bio column if it doesn't exist
  db.run(`
    ALTER TABLE users ADD COLUMN bio TEXT
  `, (err) => {
    // Ignore error if column already exists
  });

  db.run(`
    ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0
  `, (err) => {
    // Ignore error if column already exists
  });

  db.run(`
    ALTER TABLE users ADD COLUMN icon_type TEXT DEFAULT 'user'
  `, (err) => {
    // Ignore error if column already exists
  });

  db.run(`
    ALTER TABLE users ADD COLUMN verify_icon_type TEXT DEFAULT 'checkCircle2'
  `, (err) => {
    // Ignore error if column already exists
  });

  // Add group columns to conversations table if they don't exist
  db.run(`
    ALTER TABLE conversations ADD COLUMN name TEXT
  `, (err) => {
    // Ignore error if column already exists
  });

  db.run(`
    ALTER TABLE conversations ADD COLUMN created_by TEXT
  `, (err) => {
    // Ignore error if column already exists
  });

  // Add role column to conversation_participants table if it doesn't exist
  db.run(`
    ALTER TABLE conversation_participants ADD COLUMN role TEXT DEFAULT 'member'
  `, (err) => {
    // Ignore error if column already exists
  });

  // Repositories table
  db.run(`
    CREATE TABLE IF NOT EXISTS repositories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      owner_id TEXT NOT NULL,
      is_private INTEGER DEFAULT 0,
      default_branch TEXT DEFAULT 'main',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    )
  `);

  // Repository collaborators
  db.run(`
    CREATE TABLE IF NOT EXISTS repository_collaborators (
      id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      permission TEXT DEFAULT 'read',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (repository_id) REFERENCES repositories(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(repository_id, user_id)
    )
  `);

  // Deploy tokens (for git operations without login)
  db.run(`
    CREATE TABLE IF NOT EXISTS deploy_tokens (
      id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      permissions TEXT DEFAULT 'read,write',
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME,
      FOREIGN KEY (repository_id) REFERENCES repositories(id)
    )
  `);

  // Posts table (for blog)
  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      image_url TEXT,
      likes_count INTEGER DEFAULT 0,
      comments_count INTEGER DEFAULT 0,
      reposts_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Post likes table
  db.run(`
    CREATE TABLE IF NOT EXISTS post_likes (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(post_id, user_id)
    )
  `);

  // Comments table
  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Post reposts table
  db.run(`
    CREATE TABLE IF NOT EXISTS post_reposts (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(post_id, user_id)
    )
  `);

  // Poll votes table
  db.run(`
    CREATE TABLE IF NOT EXISTS poll_votes (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      option_index INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(post_id, user_id)
    )
  `);

  // Repository stars table
  db.run(`
    CREATE TABLE IF NOT EXISTS repository_stars (
      id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(repository_id, user_id)
    )
  `);

  // User follows table
  db.run(`
    CREATE TABLE IF NOT EXISTS user_follows (
      id TEXT PRIMARY KEY,
      follower_id TEXT NOT NULL,
      following_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(follower_id, following_id),
      CHECK(follower_id != following_id)
    )
  `);

  // Conversations table (for chat)
  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT DEFAULT 'direct',
      name TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Conversation participants table
  db.run(`
    CREATE TABLE IF NOT EXISTS conversation_participants (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(conversation_id, user_id)
    )
  `);

  // Messages table
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Add image_url column to messages table if it doesn't exist
  db.run(`
    ALTER TABLE messages ADD COLUMN image_url TEXT
  `, (err) => {
    if (err) {
      if (err.message?.includes('duplicate column') || err.message?.includes('already exists')) {
        console.log('✅ image_url column already exists in messages table');
      } else {
        console.error('Error adding image_url column:', err);
      }
    } else {
      console.log('✅ Added image_url column to messages table');
    }
  });

  // Create index for faster message queries
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON conversation_participants(user_id)`);

  // Labels table (for issues and pull requests)
  db.run(`
    CREATE TABLE IF NOT EXISTS labels (
      id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#0366d6',
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
      UNIQUE(repository_id, name)
    )
  `);

  // Issues table
  db.run(`
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      status TEXT DEFAULT 'open',
      author_id TEXT NOT NULL,
      assignee_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      closed_at DATETIME,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE(repository_id, number)
    )
  `);

  // Pull Requests table
  db.run(`
    CREATE TABLE IF NOT EXISTS pull_requests (
      id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      status TEXT DEFAULT 'open',
      author_id TEXT NOT NULL,
      base_branch TEXT NOT NULL DEFAULT 'main',
      head_branch TEXT NOT NULL,
      base_repo_id TEXT,
      head_repo_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      merged_at DATETIME,
      closed_at DATETIME,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (base_repo_id) REFERENCES repositories(id) ON DELETE SET NULL,
      FOREIGN KEY (head_repo_id) REFERENCES repositories(id) ON DELETE SET NULL,
      UNIQUE(repository_id, number)
    )
  `);

  // Issue labels junction table
  db.run(`
    CREATE TABLE IF NOT EXISTS issue_labels (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      label_id TEXT NOT NULL,
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
      FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE,
      UNIQUE(issue_id, label_id)
    )
  `);

  // Pull request labels junction table
  db.run(`
    CREATE TABLE IF NOT EXISTS pull_request_labels (
      id TEXT PRIMARY KEY,
      pull_request_id TEXT NOT NULL,
      label_id TEXT NOT NULL,
      FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE,
      UNIQUE(pull_request_id, label_id)
    )
  `);

  // Issue/Pull Request comments table
  db.run(`
    CREATE TABLE IF NOT EXISTS issue_comments (
      id TEXT PRIMARY KEY,
      issue_id TEXT,
      pull_request_id TEXT,
      user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
      FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CHECK ((issue_id IS NOT NULL AND pull_request_id IS NULL) OR (issue_id IS NULL AND pull_request_id IS NOT NULL))
    )
  `);

  // Create indexes for faster queries
  db.run(`CREATE INDEX IF NOT EXISTS idx_issues_repository ON issues(repository_id, status, created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_issues_author ON issues(author_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues(assignee_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pull_requests_repository ON pull_requests(repository_id, status, created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pull_requests_author ON pull_requests(author_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_issue_comments_issue ON issue_comments(issue_id, created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_issue_comments_pr ON issue_comments(pull_request_id, created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_labels_repository ON labels(repository_id)`);

  // Notifications table
  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      link TEXT,
      read BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create indexes for notifications
  db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type)`);

  console.log('✅ Database tables initialized');
}

export default db;

