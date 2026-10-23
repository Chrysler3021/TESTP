import React, { useState, useEffect, useCallback } from 'react';
import MyPageDashboardLayout from '../../../assets/components/MyPageDashboardLayout';
import '../../styles/StaffDashboard.css';
import '../../styles/Profile.css';
import '../../styles/Settings.css';
import '../../styles/MyPageDashboard.css';

const API = 'http://localhost:5000/api';

function authHeaders() {
    const token = localStorage.getItem('token');
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
}

export default function MyPageDashboard({ onSwitchToStaffDashboard }) {
    const [activeTab, setActiveTab] = useState('overview');

    // Page info
    const [pageId, setPageId] = useState(null);
    const [pageName, setPageName] = useState('My Page');
    const [pageCode, setPageCode] = useState('');
    const [pageBio, setPageBio] = useState('');

    // Feed (combined announcements + events, sorted by date)
    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(true);

    // Categories for the announcement dropdown
    const [categories, setCategories] = useState([]);

    // Local interaction state (UI only)
    const [likes, setLikes] = useState({});
    const [bookmarks, setBookmarks] = useState({});

    // Post creator state
    const [isExpanded, setIsExpanded] = useState(false);
    const [postType, setPostType] = useState('announcement');
    const [quickTitle, setQuickTitle] = useState('');
    const [quickBody, setQuickBody] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('');
    const [eventDate, setEventDate] = useState('');
    const [eventLocation, setEventLocation] = useState('');
    const [eventCapacity, setEventCapacity] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Editing state — stores the post being edited
    const [editingPost, setEditingPost] = useState(null);

    // -------------------------------------------------------
    // FETCH POSTS for this page only
    // -------------------------------------------------------
    const fetchPosts = useCallback(async (pid) => {
        try {
            const res = await fetch(`${API}/mypage/posts?pageId=${pid}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (res.ok) {
                const data = await res.json();
                const list = Array.isArray(data.posts) ? data.posts : [];
                list.sort((a, b) => new Date(b.created_at || b.date) - new Date(a.created_at || a.date));
                setPosts(list);
            }
        } catch (err) {
            console.error('Failed to fetch posts:', err);
        }
    }, []);

    // -------------------------------------------------------
    // INIT: fetch page info and categories on mount
    // -------------------------------------------------------
    useEffect(() => {
        const init = async () => {
            setLoading(true);
            try {
                const token = localStorage.getItem('token');
                if (!token) return;
                const headers = { 'Authorization': `Bearer ${token}` };

                // Load page status + categories in parallel
                const [statusRes, catRes] = await Promise.all([
                    fetch(`${API}/my-page-status`, { headers }),
                    fetch(`${API}/categories`)
                ]);

                if (catRes.ok) {
                    const catData = await catRes.json();
                    const cats = catData.categories || [];
                    setCategories(cats);
                    if (cats.length > 0) setSelectedCategory(cats[0].category_id);
                }

                if (statusRes.ok) {
                    const statusData = await statusRes.json();
                    if (statusData.exists && statusData.status === 'approved') {
                        const pid = statusData.pageId;
                        const name = statusData.pageName || 'My Page';
                        setPageId(pid);
                        setPageName(name);
                        // Auto-generate page code from initials
                        const code = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 4);
                        setPageCode(code);
                        setPageBio(statusData.description || '');
                        await fetchPosts(pid);
                    }
                }
            } catch (err) {
                console.error('Failed to initialize dashboard:', err);
            } finally {
                setLoading(false);
            }
        };
        init();
    }, [fetchPosts]);

    // -------------------------------------------------------
    // Reset the post creator form
    // -------------------------------------------------------
    const resetForm = () => {
        setQuickTitle('');
        setQuickBody('');
        setEventDate('');
        setEventLocation('');
        setEventCapacity('');
        setEditingPost(null);
        setIsExpanded(false);
        setPostType('announcement');
        if (categories.length > 0) setSelectedCategory(categories[0].category_id);
    };

    // -------------------------------------------------------
    // LOCAL UI HANDLERS
    // -------------------------------------------------------
    const handleLikeToggle = (key) => {
        setLikes(prev => {
            const cur = prev[key] || { count: 0, liked: false };
            const liked = !cur.liked;
            return { ...prev, [key]: { liked, count: liked ? cur.count + 1 : Math.max(0, cur.count - 1) } };
        });
    };

    const handleBookmarkToggle = (key) => {
        setBookmarks(prev => ({ ...prev, [key]: !prev[key] }));
    };

    // -------------------------------------------------------
    // SOFT DELETE — calls DELETE endpoint, removes from state
    // -------------------------------------------------------
    const handleDeletePost = async (post) => {
        const label = post.type === 'Event' ? 'event' : 'announcement';
        if (!window.confirm(`Archive this ${label}? It will be hidden from all feeds.`)) return;

        const endpoint = post.type === 'Event'
            ? `${API}/events/${post.id}`
            : `${API}/announcements/${post.id}`;

        try {
            const res = await fetch(endpoint, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });

            if (res.ok) {
                setPosts(prev => prev.filter(p => !(p.type === post.type && p.id === post.id)));
            } else {
                const data = await res.json().catch(() => ({}));
                alert(data.message || 'Failed to archive post.');
            }
        } catch (err) {
            console.error('Delete error:', err);
            alert('Failed to connect to server.');
        }
    };

    // -------------------------------------------------------
    // START EDITING — populate form with post data
    // -------------------------------------------------------
    const handleStartEdit = (post) => {
        setEditingPost(post);
        setPostType(post.type === 'Event' ? 'event' : 'announcement');
        setQuickTitle(post.title || '');
        setQuickBody(post.description || '');
        setEventDate(post.date ? String(post.date).split('T')[0] : '');
        setEventLocation(post.location || '');
        setEventCapacity(post.capacity ? String(post.capacity) : '');
        if (post.type === 'Announcement') {
            setSelectedCategory(post.category_id || (categories[0]?.category_id || ''));
        }
        setIsExpanded(true);
    };

    // -------------------------------------------------------
    // PUBLISH / UPDATE — handles both create and edit
    // -------------------------------------------------------
    const handleQuickPublish = async (e) => {
        e.preventDefault();
        if (!quickTitle.trim()) return;
        if (!pageId) {
            alert('Your page is not approved yet.');
            return;
        }

        setSubmitting(true);
        try {
            if (editingPost) {
                // --- UPDATE EXISTING POST ---
                const isEvent = editingPost.type === 'Event';
                const endpoint = isEvent
                    ? `${API}/events/${editingPost.id}`
                    : `${API}/announcements/${editingPost.id}`;

                const body = isEvent
                    ? { event_title: quickTitle, event_description: quickBody, event_date: eventDate, location: eventLocation, capacity: eventCapacity }
                    : { title: quickTitle, content: quickBody, category_id: selectedCategory };

                const res = await fetch(endpoint, {
                    method: 'PUT',
                    headers: authHeaders(),
                    body: JSON.stringify(body)
                });

                if (res.ok) {
                    setPosts(prev => prev.map(p =>
                        (p.type === editingPost.type && p.id === editingPost.id)
                            ? {
                                ...p,
                                title: quickTitle,
                                description: quickBody,
                                ...(isEvent ? { date: eventDate, location: eventLocation, capacity: eventCapacity || null } : { category_id: selectedCategory })
                            }
                            : p
                    ));
                    resetForm();
                } else {
                    const data = await res.json().catch(() => ({}));
                    alert(data.message || 'Failed to update post.');
                }

            } else {
                // --- CREATE NEW POST ---
                if (postType === 'announcement') {
                    const res = await fetch(`${API}/announcements`, {
                        method: 'POST',
                        headers: authHeaders(),
                        body: JSON.stringify({
                            title: quickTitle,
                            content: quickBody,
                            category_id: selectedCategory,
                            is_pinned: false
                        })
                    });
                    const data = await res.json();
                    if (res.ok && data.announcement) {
                        const a = data.announcement;
                        setPosts(prev => [{
                            id: a.announcement_id,
                            title: a.title,
                            description: a.content,
                            created_at: a.created_at,
                            category_id: a.category_id,
                            type: 'Announcement',
                            status: a.status
                        }, ...prev]);
                        resetForm();
                    } else {
                        alert(data.message || 'Failed to create announcement.');
                    }

                } else {
                    // Event
                    if (!eventDate) {
                        alert('Event date is required.');
                        setSubmitting(false);
                        return;
                    }
                    const res = await fetch(`${API}/events`, {
                        method: 'POST',
                        headers: authHeaders(),
                        body: JSON.stringify({
                            event_title: quickTitle,
                            event_description: quickBody,
                            event_date: eventDate,
                            location: eventLocation,
                            capacity: eventCapacity
                        })
                    });
                    const data = await res.json();
                    if (res.ok && data.event) {
                        const ev = data.event;
                        setPosts(prev => [{
                            id: ev.event_id,
                            title: ev.event_title,
                            description: ev.event_description,
                            date: ev.event_date,
                            location: ev.location,
                            capacity: ev.capacity,
                            created_at: ev.created_at,
                            type: 'Event',
                            status: ev.status
                        }, ...prev]);
                        resetForm();
                    } else {
                        alert(data.message || 'Failed to create event.');
                    }
                }
            }
        } catch (err) {
            console.error('Failed to publish post:', err);
            alert('Failed to connect to server.');
        } finally {
            setSubmitting(false);
        }
    };

    // -------------------------------------------------------
    // RENDER
    // -------------------------------------------------------
    return (
        <MyPageDashboardLayout
            activeTab={activeTab}
            pageName={pageName}
            pageCode={pageCode}
            onTabChange={(tab) => {
                if (tab === 'profile') window.location.href = '/staff/mypage/profile';
                else if (tab === 'settings') window.location.href = '/staff/mypage/settings';
                else if (tab === 'registrations') window.location.href = '/staff/mypage/registrations';
                else if (tab === 'help') window.location.href = '/staff/mypage/help';
                else setActiveTab(tab);
            }}
            onSwitchToStaffDashboard={onSwitchToStaffDashboard}
        >
            <main className="lg-col-6 space-y-6" style={{ width: '100%' }}>

                {/* ── QUICK POST CREATOR ── */}
                <div className="card" style={{ padding: '0.875rem 1.25rem', width: '100%' }}>
                    {!isExpanded ? (
                        <div className="flex items-center gap-3">
                            <div
                                onClick={() => { setEditingPost(null); setIsExpanded(true); }}
                                style={{
                                    flex: 1, backgroundColor: 'var(--slate-100)', borderRadius: '9999px',
                                    padding: '0.625rem 1.25rem', color: 'var(--slate-500)', fontSize: '0.875rem', cursor: 'pointer'
                                }}
                            >
                                Post an announcement or event to your page...
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleQuickPublish} className="space-y-3">
                            {/* Form header */}
                            <div className="flex items-center justify-between" style={{ borderBottom: '1px solid var(--slate-100)', paddingBottom: '0.5rem' }}>
                                <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--slate-800)' }}>
                                    {editingPost ? 'Edit Post' : 'Create Post'}
                                </span>
                                <button type="button" onClick={resetForm} style={{ background: 'none', border: 'none', color: 'var(--slate-400)', cursor: 'pointer', fontSize: '1rem' }}>
                                    <i className="fa-solid fa-xmark"></i>
                                </button>
                            </div>

                            {/* Type toggle — only for new posts */}
                            {!editingPost && (
                                <div className="flex items-center gap-2" style={{ background: 'var(--slate-50)', padding: '0.375rem', borderRadius: '0.5rem' }}>
                                    {['announcement', 'event'].map(type => (
                                        <button
                                            key={type}
                                            type="button"
                                            onClick={() => setPostType(type)}
                                            style={{
                                                flex: 1, padding: '0.375rem', borderRadius: '0.375rem',
                                                fontSize: '0.75rem', fontWeight: 600, border: 'none', cursor: 'pointer',
                                                background: postType === type ? '#ffffff' : 'transparent',
                                                color: postType === type ? '#881337' : 'var(--slate-500)',
                                                boxShadow: postType === type ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                                            }}
                                        >
                                            <i className={`fa-solid ${type === 'announcement' ? 'fa-bullhorn' : 'fa-calendar-days'}`} style={{ marginRight: '0.35rem' }}></i>
                                            {type.charAt(0).toUpperCase() + type.slice(1)}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Title */}
                            <input
                                type="text"
                                placeholder={postType === 'announcement' ? 'Announcement title...' : 'Event title...'}
                                value={quickTitle}
                                onChange={(e) => setQuickTitle(e.target.value)}
                                required
                                style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: '1px solid var(--slate-200)', fontSize: '0.875rem' }}
                            />

                            {/* Category — announcements only */}
                            {(postType === 'announcement' || (editingPost?.type === 'Announcement')) && (
                                <select
                                    value={selectedCategory}
                                    onChange={(e) => setSelectedCategory(e.target.value)}
                                    required
                                    style={{
                                        width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.5rem',
                                        border: '1px solid var(--slate-200)', fontSize: '0.875rem',
                                        backgroundColor: '#fff', color: '#334155'
                                    }}
                                >
                                    <option value="" disabled>Select a category...</option>
                                    {categories.map(cat => (
                                        <option key={cat.category_id} value={cat.category_id}>
                                            {cat.category_name}
                                        </option>
                                    ))}
                                </select>
                            )}

                            {/* Event-specific fields */}
                            {(postType === 'event' || (editingPost?.type === 'Event')) && (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                                    <div>
                                        <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--slate-500)', display: 'block', marginBottom: '0.25rem' }}>DATE *</label>
                                        <input
                                            type="date"
                                            value={eventDate}
                                            onChange={(e) => setEventDate(e.target.value)}
                                            required={postType === 'event' && !editingPost}
                                            style={{ width: '100%', padding: '0.4rem 0.5rem', borderRadius: '0.5rem', border: '1px solid var(--slate-200)', fontSize: '0.8rem' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--slate-500)', display: 'block', marginBottom: '0.25rem' }}>LOCATION</label>
                                        <input
                                            type="text"
                                            placeholder="e.g. CCS Auditorium"
                                            value={eventLocation}
                                            onChange={(e) => setEventLocation(e.target.value)}
                                            style={{ width: '100%', padding: '0.4rem 0.5rem', borderRadius: '0.5rem', border: '1px solid var(--slate-200)', fontSize: '0.8rem' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--slate-500)', display: 'block', marginBottom: '0.25rem' }}>CAPACITY</label>
                                        <input
                                            type="number"
                                            placeholder="e.g. 100"
                                            value={eventCapacity}
                                            onChange={(e) => setEventCapacity(e.target.value)}
                                            min="1"
                                            style={{ width: '100%', padding: '0.4rem 0.5rem', borderRadius: '0.5rem', border: '1px solid var(--slate-200)', fontSize: '0.8rem' }}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Body / Description */}
                            <textarea
                                rows="3"
                                placeholder={postType === 'announcement' ? 'Write announcement content...' : 'Describe the event...'}
                                value={quickBody}
                                onChange={(e) => setQuickBody(e.target.value)}
                                required
                                autoFocus
                                style={{ width: '100%', padding: '0.625rem 0.75rem', borderRadius: '0.5rem', border: '1px solid var(--slate-200)', fontSize: '0.875rem', resize: 'none' }}
                            ></textarea>

                            {/* Actions */}
                            <div className="flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={resetForm}
                                    style={{ padding: '0.4rem 0.875rem', background: 'var(--slate-100)', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--slate-600)', border: 'none', cursor: 'pointer' }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="btn-nav"
                                    style={{ padding: '0.4rem 1.125rem', fontSize: '0.75rem' }}
                                >
                                    {submitting ? 'Saving...' : (editingPost ? 'Update' : 'Post')}
                                </button>
                            </div>
                        </form>
                    )}
                </div>

                {/* ── FEED ── */}
                {loading ? (
                    <p style={{ textAlign: 'center', color: 'var(--slate-500)', padding: '2rem' }}>
                        <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: '0.5rem' }}></i>
                        Loading your page posts...
                    </p>
                ) : !pageId ? (
                    <article className="card" style={{ padding: '2.5rem', textAlign: 'center' }}>
                        <i className="fa-solid fa-flag" style={{ fontSize: '2rem', color: '#94a3b8', marginBottom: '0.75rem', display: 'block' }}></i>
                        <h3 style={{ fontWeight: 700, color: '#334155', margin: '0 0 0.5rem 0' }}>Page not approved yet</h3>
                        <p style={{ color: 'var(--slate-500)', fontSize: '0.875rem' }}>Posts will appear here once your page is approved by an administrator.</p>
                    </article>
                ) : posts.length === 0 ? (
                    <article className="card" style={{ padding: '2.5rem', textAlign: 'center' }}>
                        <i className="fa-solid fa-bullhorn" style={{ fontSize: '2rem', color: '#94a3b8', marginBottom: '0.75rem', display: 'block' }}></i>
                        <h3 style={{ fontWeight: 700, color: '#334155', margin: '0 0 0.5rem 0' }}>No posts yet</h3>
                        <p style={{ color: 'var(--slate-500)', fontSize: '0.875rem' }}>Create your first announcement or event above.</p>
                    </article>
                ) : (
                    <div className="space-y-4">
                        {posts.map((post) => {
                            const key = `${post.type}-${post.id}`;
                            const postLike = likes[key] || { count: 0, liked: false };
                            const isBookmarked = bookmarks[key] || false;
                            const isEvent = post.type === 'Event';

                            const dateDisplay = isEvent
                                ? (post.date ? new Date(post.date).toLocaleDateString() : 'TBD')
                                : (post.created_at ? new Date(post.created_at).toLocaleDateString() : 'Recent');

                            return (
                                <article key={key} className="card card-interactive" style={{ padding: '1.5rem' }}>
                                    {/* Post header */}
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div style={{
                                                width: '2.5rem', height: '2.5rem', borderRadius: '5.75rem',
                                                backgroundColor: 'var(--amber-100)', color: 'var(--amber-700)',
                                                fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem'
                                            }}>
                                                {(pageCode || pageName).substring(0, 3).toUpperCase()}
                                            </div>
                                            <div>
                                                <h3 style={{ fontWeight: 700, color: 'var(--slate-900)', fontSize: '0.875rem' }}>{pageName}</h3>
                                                <p style={{ fontSize: '11px', color: 'var(--slate-400)', marginTop: '0.125rem' }}>
                                                    {dateDisplay} &bull;{' '}
                                                    <span style={{ color: isEvent ? 'var(--amber-700)' : 'var(--emerald-600)', fontWeight: 600 }}>
                                                        {post.type}
                                                    </span>
                                                </p>
                                            </div>
                                        </div>

                                        {/* Post actions */}
                                        <div className="flex items-center gap-2">
                                            <button
                                                className="bookmark-btn action-btn"
                                                onClick={() => handleBookmarkToggle(key)}
                                                title="Bookmark"
                                                style={{ padding: '0.25rem', background: 'none', border: 'none', cursor: 'pointer' }}
                                            >
                                                <i className={`${isBookmarked ? 'fa-solid bookmarked-btn' : 'fa-regular'} fa-bookmark`} style={{ fontSize: '1rem' }}></i>
                                            </button>
                                            <button
                                                onClick={() => handleStartEdit(post)}
                                                className="action-btn"
                                                title="Edit post"
                                                style={{ padding: '0.25rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--slate-600)' }}
                                            >
                                                <i className="fa-solid fa-pen" style={{ fontSize: '0.9rem' }}></i>
                                            </button>
                                            <button
                                                onClick={() => handleDeletePost(post)}
                                                className="action-btn"
                                                title="Archive post"
                                                style={{ padding: '0.25rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rose-600)' }}
                                            >
                                                <i className="fa-solid fa-trash" style={{ fontSize: '1rem' }}></i>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Post body */}
                                    <div style={{ marginTop: '1rem' }}>
                                        <h4 style={{ fontWeight: 700, color: 'var(--slate-900)', fontSize: '1rem' }}>{post.title}</h4>
                                        <p style={{ color: 'var(--slate-600)', fontSize: '0.875rem', marginTop: '0.5rem', lineHeight: 1.625 }}>
                                            {post.description}
                                        </p>

                                        {/* Event metadata chips */}
                                        {isEvent && (post.location || post.date || post.capacity) && (
                                            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.875rem', flexWrap: 'wrap' }}>
                                                {post.date && (
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--slate-500)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                        <i className="fa-regular fa-calendar" style={{ color: '#7B0D1E' }}></i>
                                                        {new Date(post.date).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                                                    </span>
                                                )}
                                                {post.location && (
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--slate-500)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                        <i className="fa-solid fa-location-dot" style={{ color: '#7B0D1E' }}></i>
                                                        {post.location}
                                                    </span>
                                                )}
                                                {post.capacity && (
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--slate-500)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                        <i className="fa-solid fa-users" style={{ color: '#7B0D1E' }}></i>
                                                        {post.capacity} slots
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Post footer */}
                                    <div className="flex items-center justify-between" style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--slate-100)', fontSize: '0.75rem', color: 'var(--slate-500)' }}>
                                        <button
                                            className="like-btn action-btn"
                                            onClick={() => handleLikeToggle(key)}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem' }}
                                        >
                                            <i className={`${postLike.liked ? 'fa-solid liked-btn' : 'fa-regular'} fa-heart`} style={{ fontSize: '0.875rem' }}></i>
                                            <span>{postLike.count > 0 ? `${postLike.count} Like${postLike.count > 1 ? 's' : ''}` : 'Like'}</span>
                                        </button>
                                        <span style={{ fontSize: '0.7rem', color: 'var(--slate-400)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                            <i className={`fa-solid ${isEvent ? 'fa-calendar-check' : 'fa-circle-check'}`} style={{ color: isEvent ? 'var(--amber-700)' : 'var(--emerald-600)' }}></i>
                                            {post.status}
                                        </span>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}

            </main>
        </MyPageDashboardLayout>
    );
}