module.exports = {
    PORT: Number(process.env.PORT || process.env.DASHBOARD_PORT || '3000'),
    HOST: process.env.HOST || '0.0.0.0',
    PUBLIC_URL: process.env.DASHBOARD_PUBLIC_URL || process.env.PUBLIC_URL || process.env.BASE_URL || '',
    BOT_STATUS_TEXT: process.env.BOT_STATUS_TEXT || 'Falcons RP ',
    BOT_STATUS_TYPE: process.env.BOT_STATUS_TYPE || 'Playing',
    STREAMING_URL: process.env.STREAMING_URL || '',
    BOT_TOKENS: process.env.BOT_TOKENS ? process.env.BOT_TOKENS.split(',').map(t => t.trim()).filter(Boolean) : [],
    MESSAGES_PER_BURST: parseInt(process.env.MESSAGES_PER_BURST || '10', 10),
    BURST_INTERVAL: parseInt(process.env.BURST_INTERVAL || '6000', 10),
};
