import sqlite3 from 'sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '../data/database.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Database connection error:', err);
    process.exit(1);
  }

  const email = process.argv[2] || 'admin@gmail.com';
  const role = process.argv[3] || 'admin';

  console.log(`🔧 Updating user ${email} to role: ${role}...`);

  // First check if user exists
  db.get('SELECT id, username, email, role FROM users WHERE email = ?', [email], (err, user) => {
    if (err) {
      console.error('❌ Error checking user:', err);
      db.close();
      process.exit(1);
    }

    if (!user) {
      console.error(`❌ User with email ${email} not found!`);
      db.close();
      process.exit(1);
    }

    console.log(`📋 Current user info:`);
    console.log(`   ID: ${user.id}`);
    console.log(`   Username: ${user.username}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Current Role: ${user.role || 'user'}`);

    // Update role
    db.run('UPDATE users SET role = ? WHERE email = ?', [role, email], function(err) {
      if (err) {
        console.error('❌ Error updating user:', err);
        db.close();
        process.exit(1);
      }

      if (this.changes === 0) {
        console.log('⚠️  No changes made. User might already have this role.');
      } else {
        console.log(`✅ Success! User ${email} is now ${role}`);
        console.log(`   Changes: ${this.changes} row(s) updated`);
      }

      db.close();
    });
  });
});

