const express = require('express');
const router = express.Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');

// =====================================================
// AUTHENTICATION HELPER
// =====================================================
async function authenticateUser(req, res) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ message: 'Authentication required. Please log in.' });
        return null;
    }

    const token = authHeader.slice(7).trim();
    const jwtSecret = process.env.JWT_SECRET || 'fallback_secret';

    try {
        const decoded = jwt.verify(token, jwtSecret);
        const userId = Number(decoded.userId ?? decoded.id ?? decoded.user_id);

        if (!Number.isSafeInteger(userId) || userId <= 0) {
            res.status(401).json({ message: 'Invalid token user ID.' });
            return null;
        }

        const result = await pool.query('SELECT user_id FROM users WHERE user_id = $1', [userId]);
        if (result.rows.length === 0) {
            res.status(401).json({ message: 'User not found in database.' });
            return null;
        }

        return userId;
    } catch (error) {
        console.error('Authentication error:', error.message);
        res.status(401).json({ message: 'Invalid or expired token.' });
        return null;
    }
}

// =====================================================
// HELPER: Get the staff's approved page_id
// Checks both pages.created_by and page_staff membership
// =====================================================
async function getStaffPageId(userId) {
    const result = await pool.query(`
        SELECT p.page_id FROM pages p
        WHERE LOWER(p.status) = 'approved'
          AND (
            p.created_by = $1
            OR EXISTS (
                SELECT 1 FROM page_staff ps
                WHERE ps.page_id = p.page_id
                  AND ps.user_id = $1
                  AND LOWER(ps.status) = 'active'
            )
          )
        LIMIT 1
    `, [userId]);
    return result.rows.length > 0 ? result.rows[0].page_id : null;
}

// =====================================================
// GET /api/categories
// Returns all announcement categories for the dropdown
// =====================================================
router.get('/categories', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT category_id, category_name, description
             FROM announcement_categories
             ORDER BY category_id ASC`
        );
        return res.status(200).json({ categories: result.rows });
    } catch (error) {
        console.error('Error fetching categories:', error);
        return res.status(500).json({ message: 'Failed to fetch categories.' });
    }
});

// =====================================================
// CREATE NEW PAGE REQUEST
// POST /api/create-page
// =====================================================
router.post('/create-page', async (req, res) => {
    try {
        const userId = await authenticateUser(req, res);
        if (!userId) return;

        const { pageName, pageDescription, pageCategory, departmentId, organizationId } = req.body;

        if (!pageName || !pageName.trim() || !pageCategory || !pageCategory.trim()) {
            return res.status(400).json({ message: 'Page name and category are required.' });
        }

        const queryText = `
            INSERT INTO pages (page_name, page_description, description, department_id, organization_id, created_by, status)
            VALUES ($1, $2, $2, $3, $4, $5, 'Pending')
            RETURNING *;
        `;

        const values = [
            pageName.trim(),
            pageDescription || '',
            departmentId ? Number(departmentId) : null,
            organizationId ? Number(organizationId) : null,
            userId
        ];

        const result = await pool.query(queryText, values);
        return res.status(201).json({
            message: 'Page submitted successfully! Awaiting admin approval.',
            page: result.rows[0]
        });
    } catch (error) {
        console.error('Error creating page:', error);
        return res.status(500).json({ message: 'Failed to create page: ' + error.message });
    }
});

// =====================================================
// CHECK USER'S PAGE STATUS
// GET /api/my-page-status
// =====================================================
router.get('/my-page-status', async (req, res) => {
    try {
        const userId = await authenticateUser(req, res);
        if (!userId) return;

        const pageQuery = await pool.query(
            `SELECT p.page_id, p.page_name, p.page_description, p.description, p.status,
                    p.department_id, p.organization_id
             FROM pages p
             WHERE LOWER(p.status) IN ('approved', 'pending', 'rejected')
               AND (
                   p.created_by = $1
                   OR EXISTS (
                       SELECT 1 FROM page_staff ps
                       WHERE ps.page_id = p.page_id
                         AND ps.user_id = $1
                         AND LOWER(ps.status) = 'active'
                   )
               )
             ORDER BY p.page_id DESC
             LIMIT 1`,
            [userId]
        );

        if (pageQuery.rows.length === 0) {
            return res.status(200).json({ exists: false, status: 'none' });
        }

        const page = pageQuery.rows[0];

        return res.status(200).json({
            exists: true,
            pageId: page.page_id,
            pageName: page.page_name,
            description: page.page_description || page.description || '',
            status: String(page.status || 'Pending').toLowerCase(),
            category: page.department_id ? 'Academic College' : 'Student Organization'
        });
    } catch (error) {
        console.error('Error fetching page status:', error);
        return res.status(500).json({ message: 'Failed to fetch page status: ' + error.message });
    }
});

// =====================================================
// UPDATE PAGE INFORMATION
// PUT /api/mypage/update
// =====================================================
router.put('/mypage/update', async (req, res) => {
    try {
        const userId = await authenticateUser(req, res);
        if (!userId) return;

        const { pageName, category, description } = req.body;
        if (!pageName || !pageName.trim()) {
            return res.status(400).json({ message: 'Page name is required.' });
        }

        const pageCheck = await pool.query(
            `SELECT page_id FROM pages WHERE created_by = $1 ORDER BY page_id DESC LIMIT 1`,
            [userId]
        );

        if (pageCheck.rows.length === 0) {
            return res.status(404).json({ message: 'No page found for this user.' });
        }

        const pageId = pageCheck.rows[0].page_id;
        const desc = description || '';

        const updateRes = await pool.query(
            `UPDATE pages 
             SET page_name = $1, page_description = $2, description = $2, updated_at = NOW()
             WHERE page_id = $3 
             RETURNING *`,
            [pageName.trim(), desc, pageId]
        );

        return res.status(200).json({
            message: 'Page updated successfully',
            page: updateRes.rows[0]
        });
    } catch (error) {
        console.error('Error updating page:', error);
        return res.status(500).json({ message: 'Failed to update page: ' + error.message });
    }
});

// =====================================================
// GET PAGE POSTS (for My Page Dashboard feed)
// GET /api/mypage/posts?pageId=...
// Excludes archived posts
// =====================================================
router.get('/mypage/posts', async (req, res) => {
    try {
        const userId = await authenticateUser(req, res);
        if (!userId) return;

        const pageId = req.query.pageId;
        if (!pageId) {
            return res.status(400).json({ message: 'Page ID is required.' });
        }

        const [announcements, events] = await Promise.all([
            pool.query(
                `SELECT announcement_id AS id, title, content AS description, created_at,
                        category_id, is_pinned, 'Announcement' AS type, status
                 FROM announcements
                 WHERE page_id = $1 AND LOWER(status) != 'archived'
                 ORDER BY created_at DESC`,
                [pageId]
            ).catch(() => ({ rows: [] })),

            pool.query(
                `SELECT event_id AS id, event_title AS title, event_description AS description,
                        event_date AS date, location, capacity, created_at, 'Event' AS type, status
                 FROM events
                 WHERE page_id = $1 AND LOWER(status) != 'archived'
                 ORDER BY event_date DESC`,
                [pageId]
            ).catch(() => ({ rows: [] }))
        ]);

        const combined = [...announcements.rows, ...events.rows];
        combined.sort((a, b) => new Date(b.created_at || b.date) - new Date(a.created_at || a.date));

        return res.status(200).json({ posts: combined });
    } catch (error) {
        console.error('Error fetching page posts:', error);
        return res.status(500).json({ message: 'Failed to fetch page posts.' });
    }
});

// =====================================================
// CREATE ANNOUNCEMENT
// POST /api/announcements
// =====================================================
router.post('/announcements', async (req, res) => {
    try {
        const userId = await authenticateUser(req, res);
        if (!userId) return;

        const { title, content, category_id, is_pinned } = req.body;

        if (!title?.trim() || !content?.trim()) {
            return res.status(400).json({ message: 'Title and content are required.' });
        }
        if (!category_id) {
            return res.status(400).json({ message: 'Category is required.' });
        }

        const pageId = await getStaffPageId(userId);
        if (!pageId) {
            return res.status(403).json({ message: 'You do not manage an approved page.' });
        }

        const result = await pool.query(
            `INSERT INTO announcements
                (page_id, creator_user_id, category_id, title, content, is_pinned, status, published_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'Published', NOW(), NOW(), NOW())
             RETURNING *`,
            [pageId, userId, Number(category_id), title.trim(), content.trim(), is_pinned || false]
        );

        return res.status(201).json({ announcement: result.rows[0] });
    } catch (err) {
        console.error('Error creating announcement:', err);
        return res.status(500).json({ message: 'Failed to create announcement: ' + err.message });
    }
});

// =====================================================
// EDIT ANNOUNCEMENT
// PUT /api/announcements/:id
// =====================================================
router.put('/announcements/:id', async (req, res) => {
    try {
        const userId = await authenticateUser(req, res);
        if (!userId) return;

        const { id } = req.params;
        const { title, content, category_id, is_pinned } = req.body;

        if (!title?.trim() || !content?.trim()) {
            return res.status(400).json({ message: 'Title and content are required.' });
        }

        const check = await pool.query(
            `SELECT announcement_id FROM announcements WHERE announcement_id = $1 AND creator_user_id = $2`,
            [id, userId]
        );
        if (check.rowCount === 0) {
            return res.status(403).json({ message: 'You can only edit your own announcements.' });
        }

        const result = await pool.query(
            `UPDATE announcements
             SET title = $1, content = $2, category_id = $3, is_pinned = $4, updated_at = NOW()
             WHERE announcement_id = $5
             RETURNING *`,
            [title.trim(), content.trim(), Number(category_id) || 1, is_pinned || false, id]
        );

        return res.status(200).json({ announcement: result.rows[0] });
    } catch (err) {
        console.error('Error updating announcement:', err);
        return res.status(500).json({ message: 'Failed to update announcement: ' + err.message });
    }
});

// =====================================================
// SOFT DELETE ANNOUNCEMENT (sets status = 'Archived')
// DELETE /api/announcements/:id
// =====================================================
router.delete('/announcements/:id', async (req, res) => {
    try {
        const userId = await authenticateUser(req, res);
        if (!userId) return;

        const { id } = req.params;

        const check = await pool.query(
            `SELECT announcement_id FROM announcements WHERE announcement_id = $1 AND creator_user_id = $2`,
            [id, userId]
        );
        if (check.rowCount === 0) {
            return res.status(403).json({ message: 'You can only delete your own announcements.' });
        }

        await pool.query(
            `UPDATE announcements SET status = 'Archived', updated_at = NOW() WHERE announcement_id = $1`,
            [id]
        );

        return res.status(200).json({ message: 'Announcement archived successfully.' });
    } catch (err) {
        console.error('Error archiving announcement:', err);
        return res.status(500).json({ message: 'Failed to archive announcement: ' + err.message });
    }
});

// =====================================================
// CREATE EVENT
// POST /api/events
// =====================================================
router.post('/events', async (req, res) => {
    try {
        const userId = await authenticateUser(req, res);
        if (!userId) return;

        const { event_title, event_description, event_date, location, capacity } = req.body;

        if (!event_title?.trim()) {
            return res.status(400).json({ message: 'Event title is required.' });
        }
        if (!event_date) {
            return res.status(400).json({ message: 'Event date is required.' });
        }

        const pageId = await getStaffPageId(userId);
        if (!pageId) {
            return res.status(403).json({ message: 'You do not manage an approved page.' });
        }

        const result = await pool.query(
            `INSERT INTO events
                (page_id, creator_user_id, event_title, event_description, event_date, location, capacity, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'Upcoming', NOW())
             RETURNING *`,
            [
                pageId, userId,
                event_title.trim(),
                event_description?.trim() || null,
                event_date,
                location?.trim() || null,
                capacity ? parseInt(capacity) : null
            ]
        );

        return res.status(201).json({ event: result.rows[0] });
    } catch (err) {
        console.error('Error creating event:', err);
        return res.status(500).json({ message: 'Failed to create event: ' + err.message });
    }
});

// =====================================================
// EDIT EVENT
// PUT /api/events/:id
// =====================================================
router.put('/events/:id', async (req, res) => {
    try {
        const userId = await authenticateUser(req, res);
        if (!userId) return;

        const { id } = req.params;
        const { event_title, event_description, event_date, location, capacity } = req.body;

        if (!event_title?.trim()) {
            return res.status(400).json({ message: 'Event title is required.' });
        }

        const check = await pool.query(
            `SELECT event_id FROM events WHERE event_id = $1 AND creator_user_id = $2`,
            [id, userId]
        );
        if (check.rowCount === 0) {
            return res.status(403).json({ message: 'You can only edit your own events.' });
        }

        const result = await pool.query(
            `UPDATE events
             SET event_title = $1, event_description = $2, event_date = $3, location = $4, capacity = $5
             WHERE event_id = $6
             RETURNING *`,
            [
                event_title.trim(),
                event_description?.trim() || null,
                event_date,
                location?.trim() || null,
                capacity ? parseInt(capacity) : null,
                id
            ]
        );

        return res.status(200).json({ event: result.rows[0] });
    } catch (err) {
        console.error('Error updating event:', err);
        return res.status(500).json({ message: 'Failed to update event: ' + err.message });
    }
});

// =====================================================
// SOFT DELETE EVENT (sets status = 'Archived')
// DELETE /api/events/:id
// =====================================================
router.delete('/events/:id', async (req, res) => {
    try {
        const userId = await authenticateUser(req, res);
        if (!userId) return;

        const { id } = req.params;

        const check = await pool.query(
            `SELECT event_id FROM events WHERE event_id = $1 AND creator_user_id = $2`,
            [id, userId]
        );
        if (check.rowCount === 0) {
            return res.status(403).json({ message: 'You can only delete your own events.' });
        }

        await pool.query(
            `UPDATE events SET status = 'Archived' WHERE event_id = $1`,
            [id]
        );

        return res.status(200).json({ message: 'Event archived successfully.' });
    } catch (err) {
        console.error('Error archiving event:', err);
        return res.status(500).json({ message: 'Failed to archive event: ' + err.message });
    }
});

// =====================================================
// GET APPROVED PAGES (public, for student feed sidebar)
// =====================================================
router.get('/approved-pages', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT page_id AS id, page_name AS name, page_description AS description, status
             FROM pages WHERE LOWER(status) = 'approved'`
        );
        res.status(200).json({ pages: result.rows });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;