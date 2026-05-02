const { createModel } = require('../storage/jsonStore');

module.exports = createModel('recipients', {
    userId: '',
    lastSentAt: null,
    sentCount: 0
});
