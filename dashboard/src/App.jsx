import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { Bot, Send, ShieldAlert, CheckCircle, XCircle, Activity } from 'lucide-react';

const socket = io(window.location.origin);

function App() {
  const [stats, setStats] = useState({
    totalBots: 0,
    activeBots: 0,
    bannedBots: 0,
    latestBroadcast: null
  });
  const [bots, setBots] = useState([]);
  const [liveLogs, setLiveLogs] = useState([]);
  const [token, setToken] = useState('');
  const [guildId, setGuildId] = useState('');
  const [message, setMessage] = useState('');
  const [targetCount, setTargetCount] = useState(1000);
  const [presenceData, setPresenceData] = useState({}); 
  const [broadcastProgress, setBroadcastProgress] = useState(null); 

  useEffect(() => {
    fetchStats();
    fetchBots();

    socket.on('statsUpdate', (data) => {
      setStats(prev => ({ ...prev, ...data }));
    });

    socket.on('broadcastProgress', (data) => {
      setBroadcastProgress(data);
      setStats(prev => ({
        ...prev,
        latestBroadcast: {
          ...(prev.latestBroadcast || {}),
          successCount: data.successCount,
          failCount: data.failCount,
          totalTarget: data.totalTarget,
          status: data.status,
          guildId: data.guildId
        }
      }));
    });

    socket.on('liveLog', (log) => {
      setLiveLogs(prev => [log, ...prev].slice(0, 100));
    });

    return () => {
      socket.off('statsUpdate');
      socket.off('broadcastProgress');
      socket.off('liveLog');
    };
  }, []);

  const checkPresence = async () => {
    if (!guildId) return;
    try {
      const res = await axios.get(`/api/check-guild/${guildId}`);
      const mapping = {};
      res.data.forEach(item => {
        mapping[item.botId] = item.inGuild;
      });
      setPresenceData(mapping);
    } catch (err) {
      alert('خطأ في التحقق من السيرفر');
    }
  };

  const fetchStats = async () => {
    try {
      const res = await axios.get('/api/stats');
      setStats(res.data);
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  const fetchBots = async () => {
    try {
      const res = await axios.get('/api/bots');
      setBots(res.data);
    } catch (err) {
      console.error('Error fetching bots:', err);
    }
  };

  const addBot = async () => {
    try {
      if (!token) return alert('الرجاء إدخال توكن!');
      await axios.post('/api/bots/add', { token });
      setToken('');
      fetchBots();
      alert('تم إضافة البوت بنجاح!');
    } catch (err) {
      alert('فشل في إضافة البوت: ' + err.response?.data?.error);
    }
  };

  const deleteBot = async (id) => {
    if (!confirm('هل أنت متأكد من حذف هذا البوت؟')) return;
    try {
      await axios.delete(`/api/bots/${id}`);
      fetchBots();
    } catch (err) {
      alert('Failed to delete bot');
    }
  };

  const startBroadcast = async () => {
    try {
      if (!guildId) return alert('الرجاء إدخال معرف السيرفر (Guild ID) أولاً!');
      if (!message) return alert('الرجاء كتابة رسالة!');
      await axios.post('/api/broadcast/start', { message, targetCount, guildId });
      setLiveLogs([{ message: 'بدء إرسال التعليمات للسيرفر...', timestamp: new Date(), isError: false }]);
      alert('بدأت عملية البرودكاست!');
      fetchStats();
    } catch (err) {
      alert('فشل في بدء الإرسال: ' + err.response?.data?.error);
    }
  };

  const stopBroadcast = async () => {
    try {
      await axios.post('/api/broadcast/stop');
      fetchStats();
      fetchBots();
    } catch (err) {
      alert('Failed to stop broadcast');
    }
  };

  const resetStats = async () => {
    if (!confirm('هل أنت متأكد من تصفير جميع الإحصائيات والسجلات؟')) return;
    try {
      await axios.post('/api/stats/reset');
      setLiveLogs([]);
      setBroadcastProgress(null);
      fetchStats();
      fetchBots();
      alert('تم تصفير الإحصائيات بنجاح!');
    } catch (err) {
      alert('Failed to reset stats');
    }
  };

  return (
    <div className="dashboard">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* تأكد من وجود ملف logo.png في مجلد dashboard/public */}
          <img src="/logo.png" alt="Falcons RP" style={{ width: '40px', height: '40px', borderRadius: '8px' }} />
          <h1 style={{ color: '#3b82f6' }}>Falcons RP</h1>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Activity size={20} className="status-active" />
          <span>النظام متصل</span>
        </div>
      </header>

      <section className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">إجمالي البوتات</div>
          <div className="stat-value">{stats.totalBots}</div>
          <Bot size={24} style={{ marginTop: '1rem', color: '#3b82f6' }} />
        </div>
        <div className="stat-card">
          <div className="stat-label">بوتات تعمل</div>
          <div className="stat-value status-active">{stats.activeBots}</div>
          <CheckCircle size={24} style={{ marginTop: '1rem' }} />
        </div>
        <div className="stat-card">
          <div className="stat-label">بوتات محظورة</div>
          <div className="stat-value status-banned">{stats.bannedBots}</div>
          <ShieldAlert size={24} style={{ marginTop: '1rem' }} />
        </div>
        <div className="stat-card">
          <div className="stat-label">عمليات ناجحة</div>
          <div className="stat-value">{stats.latestBroadcast?.successCount || 0}</div>
          <CheckCircle size={24} style={{ marginTop: '1rem', color: '#10b981' }} />
        </div>
        <div className="stat-card">
          <div className="stat-label">عمليات فاشلة</div>
          <div className="stat-value status-banned">{stats.latestBroadcast?.failCount || 0}</div>
          <XCircle size={24} style={{ marginTop: '1rem' }} />
        </div>
      </section>

      <main className="main-content">
        <div className="card">
          <h3>إضافة بوت جديد</h3>
          <div className="input-group">
            <label>توكن البوت (Bot Token)</label>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ضع التوكن هنا..."
            />
          </div>
          <button onClick={addBot}>إضافة البوت</button>

          <h3 style={{ marginTop: '2rem' }}>بدء برودكاست جديد</h3>
          <div className="input-group">
            <label>معرف السيرفر المستهدف (Guild ID) - إجباري</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                value={guildId}
                onChange={(e) => setGuildId(e.target.value)}
                placeholder="أدخل معرف السيرفر هنا (إجباري)..."
                style={{ flex: 1 }}
              />
              <button
                onClick={checkPresence}
                style={{ width: 'auto', background: '#3b82f6', whiteSpace: 'nowrap' }}
                disabled={!guildId}
              >فحص التواجد</button>
            </div>
            {Object.keys(presenceData).length > 0 && Object.values(presenceData).every(v => v === true) && (
              <p style={{ color: '#10b981', fontSize: '0.85rem', marginTop: '0.5rem', fontWeight: 'bold' }}>
                ✅ جميع البوتات ف نفس السيرفر
              </p>
            )}
          </div>
          <div className="input-group">
            <label>نص الرسالة</label>
            <textarea
              rows="4"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="اكتب الرسالة هنا..."
            ></textarea>
          </div>
          <div className="input-group">
            <label>عدد اعضاء السيرفر</label>
            <input
              type="number"
              value={targetCount}
              onChange={(e) => setTargetCount(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              style={{ background: '#10b981', flex: 1 }}
              onClick={startBroadcast}
              disabled={stats.latestBroadcast?.status === 'running'}
            >
              <Send size={18} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              بدء الإرسال المتسلسل
            </button>
            {stats.latestBroadcast?.status === 'running' && (
              <button
                style={{ background: '#ef4444', flex: 1 }}
                onClick={stopBroadcast}
              >إيقاف الإرسال</button>
            )}
          </div>

          <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>قائمة البوتات (ترتيب الإرسال)</h3>
            <button
              onClick={resetStats}
              style={{ width: 'auto', background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
            >رسترت الإحصائيات 🔄</button>
          </div>
          <div className="log-container" style={{ maxHeight: '300px' }}>
            {bots.length > 0 ? bots.map((bot, index) => {
              const isInGuild = presenceData[bot._id] !== undefined ? presenceData[bot._id] : true;
              return (
                <div key={bot._id} className="log-entry" style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  borderColor: !isInGuild ? '#ef4444' : (bot.status === 'active' ? '#10b981' : '#ef4444'),
                  background: !isInGuild ? 'rgba(239, 68, 68, 0.05)' : 'transparent'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>
                      <strong style={{ color: '#3b82f6', marginRight: '0.5rem' }}>#{index + 1}</strong>
                      {bot.username || "جاري التحميل..."}
                      {!isInGuild && <span style={{ color: '#ef4444', fontSize: '0.8rem', fontWeight: 'bold', marginLeft: '0.5rem' }}> [غير موجود بالسيرفر! ⛔]</span>}
                    </span>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {bot.inviteLink && (
                        <a href={bot.inviteLink} target="_blank" rel="noopener noreferrer" style={{ padding: '0.2rem 0.5rem', background: '#3b82f6', color: 'white', borderRadius: '4px', fontSize: '0.7rem', textDecoration: 'none' }}>دعوة للسيرفر</a>
                      )}
                      <button onClick={() => deleteBot(bot._id)} style={{ width: 'auto', padding: '0.2rem 0.5rem', background: '#ef4444', fontSize: '0.7rem' }}>حذف</button>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>الحالة: {bot.status}</span>
                    <span>أرسل: <strong style={{ color: '#10b981' }}>{bot.successCount || 0}</strong> رسالة</span>
                  </div>
                </div>
              );
            }) : <p>لا يوجد بوتات مضافة حالياً</p>}
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={20} color="#3b82f6" />
            اللوحة الرقمية (Live Console)
          </h3>

          <div style={{ background: '#0a0f1e', borderRadius: '8px', padding: '1rem', flex: 1, border: '1px solid #1e293b', position: 'relative', overflow: 'hidden' }}>
            <div className="console-header" style={{ borderBottom: '1px solid #1e293b', marginBottom: '0.5rem', paddingBottom: '0.5rem', fontSize: '0.7rem', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
              <span>FALCONS_SYSTEM_v2.0</span>
              <span>LIVE_STREAM</span>
            </div>

            <div className="log-container" style={{ maxHeight: '600px', background: 'transparent', border: 'none', padding: 0 }}>
              {liveLogs.length > 0 ? liveLogs.map((log, i) => (
                <div key={i} className="log-entry" style={{
                  margin: '2px 0',
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                  border: 'none',
                  padding: '1px 0',
                  color: log.isError ? '#ef4444' : '#10b981',
                  background: 'transparent'
                }}>
                  <span style={{ color: '#475569', marginRight: '0.5rem' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                  <span style={{ color: '#3b82f6', marginRight: '0.5rem' }}>➜</span>
                  {log.message}
                </div>
              )) : <p style={{ color: '#475569', fontFamily: 'monospace' }}>بانتظار نشاط النظام...</p>}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;