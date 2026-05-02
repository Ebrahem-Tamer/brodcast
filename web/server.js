const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

function resolveBaseUrl(host, port, publicUrl) {
  if (publicUrl) return publicUrl;
  const protocol = process.env.DASHBOARD_PROTOCOL || process.env.PROTOCOL || 'http';
  const publicHost = process.env.PUBLIC_HOST || host;
  return `${protocol}://${publicHost}:${port}`;
}

async function startWebServer(deps) {
  const { config, botManager, Bot, Broadcast } = deps;

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: "*" }
  });

  botManager.setIo(io);

  app.use(cors());
  app.use(express.json());

  const dashboardDistPath = path.join(__dirname, '..', 'dashboard', 'dist');
  console.log(`[DIAGNOSTIC] Dashboard dist path should be: ${dashboardDistPath}`);
  const dashboardDistExists = fs.existsSync(dashboardDistPath);
  const dashboardIndexPath = path.join(dashboardDistPath, 'index.html');
  const dashboardIndexExists = fs.existsSync(dashboardIndexPath);

  if (dashboardDistExists) {
    console.log('[DIAGNOSTIC] dashboard/dist directory FOUND.');
    const files = fs.readdirSync(dashboardDistPath);
    console.log(`[DIAGNOSTIC] Contents of dashboard/dist: ${files.join(', ')}`);
  } else {
    console.error('[DIAGNOSTIC] CRITICAL: dashboard/dist directory NOT FOUND.');
  }
  if (dashboardDistExists && dashboardIndexExists) {
    app.use(express.static(dashboardDistPath));
  } else {
    console.error('[DIAGNOSTIC] CRITICAL: Dashboard build is missing (index.html not found).');
  }

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      dashboard: {
        distExists: dashboardDistExists,
        indexExists: dashboardIndexExists
      }
    });
  });

  app.get(/^(?!\/api)(?!\/socket\.io).*/, (req, res) => {
    if (dashboardDistExists && dashboardIndexExists) return res.sendFile(dashboardIndexPath);
    return res.status(503).send(
      'Dashboard build not found. Build the dashboard (dashboard/) and ensure dashboard/dist is deployed.'
    );
  });

  app.get('/api/stats', async (req, res) => {
    try {
      const totalBots = await Bot.countDocuments();
      const activeBots = await Bot.countDocuments({ status: 'active' });
      const bannedBots = await Bot.countDocuments({ status: 'banned' });
      const latestBroadcast = await botManager.getLatestBroadcast();

      res.json({
        totalBots,
        activeBots,
        bannedBots,
        latestBroadcast
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/bots/add', async (req, res) => {
    const { token } = req.body;
    try {
      if (!token) {
        return res.status(400).json({ error: 'Token is required' });
      }

      await botManager.addBot(token);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/bots', async (req, res) => {
    try {
      const bots = await Bot.find();
      res.json(bots);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/bots/:id', async (req, res) => {
    try {
      const bot = await Bot.findById(req.params.id);
      if (!bot) return res.status(404).json({ error: 'Bot not found' });

      botManager.removeBotClient(bot.token);

      await Bot.findByIdAndDelete(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/check-guild/:guildId', async (req, res) => {
    try {
      const results = await botManager.checkGuildPresence(req.params.guildId);
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/broadcast/start', async (req, res) => {
    const { message, targetCount, guildId } = req.body;
    try {
      await botManager.startBroadcast(message, targetCount, guildId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/broadcast/stop', (req, res) => {
    botManager.stopBroadcast();
    res.json({ success: true });
  });

  app.post('/api/stats/reset', async (req, res) => {
    try {
      await botManager.resetStats();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  setInterval(async () => {
    try {
      const stats = {
        activeBots: await Bot.countDocuments({ status: 'active' }),
        bannedBots: await Bot.countDocuments({ status: 'banned' }),
        latestBroadcast: await botManager.getLatestBroadcast()
      };
      io.emit('statsUpdate', stats);
    } catch (error) {
      console.error('Failed to emit statsUpdate:', error);
    }
  }, 2000);

  const PORT = config.PORT || 5000;
  const HOST = config.HOST || '0.0.0.0';
  const PUBLIC_URL = config.PUBLIC_URL || '';
  const baseUrl = resolveBaseUrl(HOST, PORT, PUBLIC_URL);

  return new Promise((resolve, reject) => {
    server.listen(PORT, HOST, () => {
      console.log('\n' + '='.repeat(40));
      console.log('🚀 SYSTEM IS ONLINE');
      console.log('='.repeat(40));
      if (PUBLIC_URL) {
        console.log(`🔗 Dashboard: ${PUBLIC_URL}`);
      } else {
        console.log(`🔗 Access your dashboard at: ${baseUrl}`);
        console.log(`💡 Tip: For a direct link, set the PUBLIC_URL environment variable`);
        console.log(`         to your server's public URL (e.g., ${baseUrl})`);
      }
      console.log('='.repeat(40) + '\n');
      console.log(`🌐 Dashboard running on ${baseUrl}`);
      resolve({ server, baseUrl });
    });
    server.on('error', reject);
  });
}

module.exports = { startWebServer };
