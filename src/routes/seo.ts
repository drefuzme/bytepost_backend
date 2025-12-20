import express from 'express';
import { dbAll } from '../database/db.js';

const router = express.Router();
const SITE_URL = process.env.FRONTEND_URL || 'https://drefuz.info';

// Generate dynamic sitemap.xml
router.get('/sitemap.xml', async (req, res) => {
  try {
    // Get all public repositories
    const repos = await dbAll(`
      SELECT u.username, r.name, r.updated_at
      FROM repositories r
      JOIN users u ON r.owner_id = u.id
      WHERE r.is_private = 0
      ORDER BY r.updated_at DESC
      LIMIT 1000
    `);

    // Get all public blog posts
    const posts = await dbAll(`
      SELECT id, updated_at
      FROM posts
      WHERE is_published = 1
      ORDER BY updated_at DESC
      LIMIT 1000
    `);

    // Get all public users
    const users = await dbAll(`
      SELECT username, updated_at
      FROM users
      WHERE username IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 1000
    `);

    // Generate sitemap XML
    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
  
  <!-- Homepage -->
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  
  <!-- Blog -->
  <url>
    <loc>${SITE_URL}/blog</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
`;

    // Add repositories
    repos.forEach((repo: any) => {
      const lastmod = repo.updated_at ? new Date(repo.updated_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      sitemap += `  <url>
    <loc>${SITE_URL}/${repo.username}/${repo.name}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
`;
    });

    // Add blog posts
    posts.forEach((post: any) => {
      const lastmod = post.updated_at ? new Date(post.updated_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      sitemap += `  <url>
    <loc>${SITE_URL}/blog/post/${post.id}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
`;
    });

    // Add user profiles
    users.forEach((user: any) => {
      const lastmod = user.updated_at ? new Date(user.updated_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      sitemap += `  <url>
    <loc>${SITE_URL}/${user.username}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>
`;
    });

    sitemap += `</urlset>`;

    res.setHeader('Content-Type', 'application/xml');
    res.send(sitemap);
  } catch (error: any) {
    console.error('Sitemap generation error:', error);
    res.status(500).send('Error generating sitemap');
  }
});

// Robots.txt endpoint (optional, can also be static file)
router.get('/robots.txt', (req, res) => {
  const robots = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin
Disallow: /chat
Disallow: /dashboard
Disallow: /login
Disallow: /register
Disallow: /forgot-password
Disallow: /reset-password

Allow: /
Allow: /blog
Allow: /*/repo
Allow: /*/profile

Sitemap: ${SITE_URL}/sitemap.xml

Crawl-delay: 1
`;
  res.setHeader('Content-Type', 'text/plain');
  res.send(robots);
});

export default router;

