const { createModel } = require('../storage/jsonStore');

module.exports = createModel('broadcasts', {
    message: '',
    status: 'pending',
    startTime: null,
    guildId: '',
    endTime: null,
    totalTarget: 0,
    successCount: 0,
    failCount: 0,
    processedUsers: [],
    currentBotIndex: 0,
    logs: [],
    liveRecipients: []
});
