const { createModel } = require('../storage/jsonStore');

module.exports = createModel('bots', {
    token: '',
    username: '',
    clientId: '',
    inviteLink: '',
    status: 'offline',
    messagesSent: 0,
    successCount: 0,
    failCount: 0,
    lastUsed: null
});
