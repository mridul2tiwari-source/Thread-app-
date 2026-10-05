import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function ThreadFeed() {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setCurrentUserId(session.user.id);
    });
    fetchThreads();

    const channel = supabase.channel('public:threads')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'threads' }, () => {
        fetchThreads();
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  const fetchThreads = async () => {
    const { data, error } = await supabase
      .from('threads')
      .select('*, users(name, avatar_url)')
      .order('created_at', { ascending: false });
    
    if (data) setThreads(data);
    setLoading(false);
  };

  const handlePost = async () => {
    if (!text && !imageFile) return;
    setUploading(true);

    let image_url = null;
    if (imageFile) {
      const ext = imageFile.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
      const { data, error } = await supabase.storage.from('threads').upload(fileName, imageFile);
      if (!error && data) {
        const { data: publicUrlData } = supabase.storage.from('threads').getPublicUrl(fileName);
        image_url = publicUrlData.publicUrl;
      }
    }

    const { error } = await supabase.from('threads').insert({
      author_id: currentUserId,
      content: text,
      image_url: image_url
    });

    if (!error) {
      setText('');
      setImageFile(null);
    }
    setUploading(false);
  };

  const handleDelete = async (id) => {
    await supabase.from('threads').delete().eq('id', id);
  };

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', paddingBottom: 80 }}>
      {/* Create Post UI */}
      <div style={{ padding: 16, borderBottom: '1px solid #333', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <textarea 
          placeholder="What's on your mind?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ width: '100%', background: 'transparent', border: 'none', color: '#fff', fontSize: 16, outline: 'none', resize: 'none', minHeight: 60, fontFamily: 'inherit' }}
        />
        {imageFile && <div style={{ color: '#aaa', fontSize: 12 }}>Image selected: {imageFile.name}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ cursor: 'pointer', color: '#6c8cff', display: 'flex', alignItems: 'center', gap: 5 }}>
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => setImageFile(e.target.files[0])} />
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            <span style={{fontSize: 14}}>Photo</span>
          </label>
          <button 
            onClick={handlePost} 
            disabled={uploading || (!text && !imageFile)}
            style={{ background: '#fff', color: '#000', border: 'none', borderRadius: 20, padding: '6px 16px', fontWeight: 'bold', cursor: 'pointer', opacity: (uploading || (!text && !imageFile)) ? 0.5 : 1 }}
          >
            {uploading ? 'Posting...' : 'Post'}
          </button>
        </div>
      </div>

      {/* Feed UI */}
      {loading ? <div style={{ padding: 20, textAlign: 'center', color: '#666' }}>Loading...</div> : 
        threads.map(t => (
          <div key={t.id} style={{ padding: 16, borderBottom: '1px solid #222', display: 'flex', gap: 12 }}>
            <img src={(t.users && t.users.avatar_url) ? t.users.avatar_url : 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + t.author_id} alt="avatar" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <b style={{ color: '#fff', fontSize: 15 }}>{(t.users && t.users.name) ? t.users.name : 'User'}</b>
                {t.author_id === currentUserId && (
                  <button onClick={() => handleDelete(t.id)} style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer' }}>Delete</button>
                )}
              </div>
              <p style={{ color: '#eee', marginTop: 4, marginBottom: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 15 }}>{t.content}</p>
              {t.image_url && (
                <img src={t.image_url} alt="post" style={{ width: '100%', borderRadius: 12, marginTop: 8, border: '1px solid #333' }} />
              )}
            </div>
          </div>
        ))
      }
    </div>
  );
}
