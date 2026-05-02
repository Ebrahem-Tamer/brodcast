require('dotenv').config();
const config = require('./config');
const botManager = require('./botManager');
const Bot = require('./models/Bot');
const Broadcast = require('./models/Broadcast');
const { startWebServer } = require('./web/server');

async function main() {
    try {
        console.log('Using local JSON storage');

        const configTokens = Array.isArray(config.BOT_TOKENS)
            ? config.BOT_TOKENS.filter(t => t !== 'TOKEN_1_HERE' && t !== 'TOKEN_2_HERE')
            : [];
        const storedBots = await Bot.find();
        const storedTokens = storedBots.map(bot => bot.token).filter(Boolean);
        const tokensToLoad = [...new Set([...configTokens, ...storedTokens])];

        console.log(`Syncing ${tokensToLoad.length} bot(s)...`);
        await Bot.updateMany({ token: { $nin: tokensToLoad } }, { $set: { status: 'offline' } });

        for (const token of tokensToLoad) {
            await botManager.addBot(token);
        }

        await startWebServer({
            config,
            botManager,
            Bot,
            Broadcast
        });

        console.log('Server is fully active');
    } catch (err) {
        console.error('Fatal error during startup:', err.message);
        setTimeout(() => process.exit(1), 2000);
    }
}

process.on('SIGTERM', () => {
    console.log('Shutting down gracefully...');
    process.exit(0);
});

main();
