require('dotenv').config();
const mongoose = require('mongoose');
const config = require('./config');
const botManager = require('./botManager');
const Bot = require('./models/Bot');
const Broadcast = require('./models/Broadcast');
const { startWebServer } = require('./web/server');

// السطر 10: جلب الرابط من إعدادات Railway
const MONGO_URI = 'mongodb+srv://user_1207683121928212561:frY%25GfhHMw*3M7k!eTfI2tIj%5E88wi%5Ekk@thailandcodes.bbmhmjb.mongodb.net/db_1207683121928212561?retryWrites=true&w=majority';

async function main() {
    try {
        console.log('Connecting to MongoDB...');
        
        // الاتصال بقاعدة البيانات
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB successfully');

        if (config.BOT_TOKENS && Array.isArray(config.BOT_TOKENS)) {
            console.log('Syncing bots with config...');
            const configTokens = config.BOT_TOKENS.filter(t => t !== 'TOKEN_1_HERE' && t !== 'TOKEN_2_HERE');

            await Bot.updateMany({ token: { $nin: configTokens } }, { status: 'offline' });

            for (const token of configTokens) {
                await botManager.addBot(token);
            }
        }

        // تشغيل سيرفر الويب
        await startWebServer({
            config,
            botManager,
            Bot,
            Broadcast
        });
        
        console.log('🚀 Server is fully active');

    } catch (err) {
        console.error('❌ Fatal error during startup:', err.message);
        // تأخير بسيط لرؤية الخطأ في اللوج قبل القفل
        setTimeout(() => process.exit(1), 2000);
    }
}

// التعامل مع إغلاق Railway المنظم
process.on('SIGTERM', () => {
    console.log('Shutting down gracefully...');
    mongoose.connection.close();
    process.exit(0);
});

main();
