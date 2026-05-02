const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const Bot = require('./models/Bot');
const Broadcast = require('./models/Broadcast');
const Recipient = require('./models/Recipient');
const config = require('./config');

const MESSAGE_QUOTA_PER_BOT = parseInt(process.env.MESSAGE_QUOTA_PER_BOT || '300', 10);
const LIVE_RECIPIENTS_LIMIT = 12;

class BotManager {
    constructor() {
        this.clients = new Map();
        this.status = 'idle';
        this.currentBroadcast = null;
        this.recipientCache = new Set();
        this.recipientCacheLoaded = false;
        this.io = null;
    }

    async ensureRecipientCache() {
        if (this.recipientCacheLoaded) return;

        const recipients = await Recipient.find({}, 'userId');
        recipients.forEach(recipient => this.recipientCache.add(recipient.userId));
        this.recipientCacheLoaded = true;
    }

    async recordRecipient(member) {
        this.recipientCache.add(member.id);
        await Recipient.findOneAndUpdate(
            { userId: member.id },
            { $set: { lastSentAt: new Date().toISOString() }, $inc: { sentCount: 1 } },
            { upsert: true }
        );
    }

    async getLatestBroadcast() {
        const broadcasts = await Broadcast.find();
        if (broadcasts.length === 0) return null;

        return broadcasts.sort((a, b) => {
            const first = new Date(a.startTime || a.createdAt || 0).getTime();
            const second = new Date(b.startTime || b.createdAt || 0).getTime();
            return second - first;
        })[0];
    }

    async getActiveBots() {
        const bots = await Bot.find({ status: 'active' });
        return bots.sort((a, b) => {
            const first = new Date(a.createdAt || 0).getTime();
            const second = new Date(b.createdAt || 0).getTime();
            return first - second;
        });
    }

    emitProgressUpdate() {
        if (!this.io || !this.currentBroadcast) return;

        this.io.emit('broadcastProgress', {
            successCount: this.currentBroadcast.successCount,
            failCount: this.currentBroadcast.failCount,
            totalTarget: this.currentBroadcast.totalTarget,
            status: this.currentBroadcast.status,
            liveRecipients: this.currentBroadcast.liveRecipients || [],
            guildId: this.currentBroadcast.guildId
        });
    }

    emitBotStatusChange() {
        if (!this.io) return;
        this.io.emit('botStatusChange');
    }

    async addBot(token) {
        if (this.clients.has(token)) return;

        const client = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
        });

        try {
            await client.login(token);

            const activityType = ActivityType[config.BOT_STATUS_TYPE] || ActivityType.Playing;
            const activityOptions = { type: activityType };
            if (activityType === ActivityType.Streaming && config.STREAMING_URL) {
                activityOptions.url = config.STREAMING_URL;
            }
            client.user.setActivity(config.BOT_STATUS_TEXT, activityOptions);

            this.clients.set(token, client);

            const inviteLink = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`;

            await Bot.findOneAndUpdate(
                { token },
                {
                    $set: {
                        status: 'active',
                        username: client.user.username,
                        clientId: client.user.id,
                        inviteLink
                    }
                },
                { upsert: true }
            );

            this.emitBotStatusChange();
            console.log(`Bot logged in: ${client.user.username}`);
        } catch (error) {
            console.error(`Failed to login bot with token: ${token.substring(0, 10)}...`);
            await Bot.findOneAndUpdate(
                { token },
                { $set: { status: 'offline' } },
                { upsert: true }
            );
            this.emitBotStatusChange();
        }
    }

    async removeBotClient(token) {
        const client = this.clients.get(token);
        if (!client) return;

        client.destroy();
        this.clients.delete(token);
        this.emitBotStatusChange();
    }

    async startBroadcast(message, totalTarget, guildId) {
        if (this.status === 'running') {
            throw new Error('Broadcast already running');
        }

        const bots = await this.getActiveBots();
        if (bots.length === 0) {
            throw new Error('No active bots available');
        }

        await this.ensureRecipientCache();

        this.status = 'running';
        this.currentBroadcast = await Broadcast.create({
            message,
            totalTarget: Number(totalTarget),
            guildId,
            startTime: new Date().toISOString(),
            status: 'running',
            successCount: 0,
            failCount: 0,
            processedUsers: [],
            liveRecipients: [],
            logs: [],
            currentBotIndex: 0
        });

        this.emitProgressUpdate();
        this.broadcastLoop(guildId);
    }

    async broadcastLoop(guildId) {
        const botsData = await this.getActiveBots();
        const processedMembers = new Set(this.currentBroadcast.processedUsers || []);
        let sentCount = this.currentBroadcast.successCount || 0;
        let currentBotIndex = 0;

        while (
            this.status === 'running' &&
            sentCount < this.currentBroadcast.totalTarget &&
            currentBotIndex < botsData.length
        ) {
            const currentBotData = botsData[currentBotIndex];
            const client = this.clients.get(currentBotData.token);

            if (!client) {
                currentBotIndex += 1;
                continue;
            }

            this.logToDashboard(`Starting with Bot #${currentBotIndex + 1} (${client.user.username})`, currentBotData._id);

            let membersToMessage = [];

            while (this.status === 'running') {
                try {
                    if (guildId) {
                        const guild = await client.guilds.fetch(guildId);
                        const fetchedMembers = await guild.members.fetch();
                        membersToMessage = Array.from(fetchedMembers.values()).filter(member => (
                            !member.user.bot && !processedMembers.has(member.id)
                        ));
                    } else {
                        const seen = new Set();
                        for (const [, guild] of client.guilds.cache) {
                            const fetchedMembers = await guild.members.fetch();
                            fetchedMembers.forEach(member => {
                                if (member.user.bot || processedMembers.has(member.id) || seen.has(member.id)) {
                                    return;
                                }
                                membersToMessage.push(member);
                                seen.add(member.id);
                            });
                        }
                    }
                    break;
                } catch (err) {
                    if (!err.message.includes('rate limited')) {
                        this.logToDashboard(`Error fetching members: ${err.message}`, currentBotData._id, true);
                        break;
                    }

                    const retryAfterMatch = err.message.match(/(\d+\.?\d*)/);
                    const retryAfter = retryAfterMatch ? parseFloat(retryAfterMatch[0]) : 30;
                    this.logToDashboard(
                        `Rate limited while fetching members. Waiting ${retryAfter}s...`,
                        currentBotData._id,
                        true
                    );
                    await new Promise(resolve => setTimeout(resolve, (retryAfter * 1000) + 2000));
                }
            }

            let botSentThisRound = 0;
            let burstCounter = 0;
            let botBanned = false;

            for (const member of membersToMessage) {
                if (
                    this.status !== 'running' ||
                    sentCount >= this.currentBroadcast.totalTarget ||
                    botSentThisRound >= MESSAGE_QUOTA_PER_BOT
                ) {
                    break;
                }

                if (processedMembers.has(member.id)) continue;

                try {
                    await member.send(this.currentBroadcast.message);

                    const logMessage = `Sent to ${member.user.tag}`;
                    this.logToDashboard(`Bot #${currentBotIndex + 1}: ${logMessage}`, currentBotData._id);

                    sentCount += 1;
                    botSentThisRound += 1;
                    burstCounter += 1;

                    processedMembers.add(member.id);
                    this.currentBroadcast.successCount = sentCount;
                    this.currentBroadcast.processedUsers.push(member.id);
                    this.currentBroadcast.logs.push({
                        botId: currentBotData._id,
                        timestamp: new Date().toISOString(),
                        message: logMessage,
                        isError: false
                    });

                    await this.recordRecipient(member);

                    const liveEntry = {
                        id: member.id,
                        tag: member.user.tag,
                        botUsername: client.user.username
                    };

                    this.currentBroadcast.liveRecipients = this.currentBroadcast.liveRecipients || [];
                    this.currentBroadcast.liveRecipients.unshift(liveEntry);

                    if (this.currentBroadcast.liveRecipients.length > LIVE_RECIPIENTS_LIMIT) {
                        this.currentBroadcast.liveRecipients.pop();
                    }

                    await Bot.findByIdAndUpdate(currentBotData._id, {
                        $inc: { successCount: 1 },
                        $set: { lastUsed: new Date().toISOString() }
                    });
                    await this.currentBroadcast.save();
                    this.emitProgressUpdate();
                    this.emitBotStatusChange();

                    if (burstCounter >= (config.MESSAGES_PER_BURST || 10)) {
                        await new Promise(resolve => setTimeout(resolve, config.BURST_INTERVAL || 3000));
                        burstCounter = 0;
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                } catch (error) {
                    this.logToDashboard(
                        `Bot #${currentBotIndex + 1}: Error sending to ${member.user.tag}: ${error.message}`,
                        currentBotData._id,
                        true
                    );

                    processedMembers.add(member.id);
                    this.currentBroadcast.processedUsers.push(member.id);
                    this.currentBroadcast.failCount += 1;
                    this.currentBroadcast.logs.push({
                        botId: currentBotData._id,
                        timestamp: new Date().toISOString(),
                        message: `Failed: ${member.user.tag} (${error.message})`,
                        isError: true
                    });
                    await this.currentBroadcast.save();
                    this.emitProgressUpdate();

                    if (
                        error.status === 401 ||
                        error.message.includes('flagged') ||
                        error.message.includes('anti-spam')
                    ) {
                        await Bot.findByIdAndUpdate(currentBotData._id, { $set: { status: 'banned' } });
                        this.logToDashboard(
                            `Bot #${currentBotIndex + 1}: Marked as banned.`,
                            currentBotData._id,
                            true
                        );
                        this.clients.delete(currentBotData.token);
                        this.emitBotStatusChange();
                        botBanned = true;
                        break;
                    }
                }
            }

            if (botBanned || botSentThisRound >= MESSAGE_QUOTA_PER_BOT) {
                if (!botBanned) {
                    this.logToDashboard(
                        `Bot #${currentBotIndex + 1} finalized its ${MESSAGE_QUOTA_PER_BOT} messages quota.`,
                        currentBotData._id
                    );
                }
                currentBotIndex += 1;
                continue;
            }

            if (sentCount >= this.currentBroadcast.totalTarget) {
                break;
            }

            this.logToDashboard(`Bot #${currentBotIndex + 1} finished all available members in the guild.`);
            break;
        }

        let completionMessage = '';

        if (sentCount >= this.currentBroadcast.totalTarget) {
            completionMessage = `Success: Target reached (${sentCount})`;
            this.status = 'completed';
        } else if (this.status === 'stopped') {
            completionMessage = `Stopped: Broadcast was manually stopped. Total: ${sentCount}`;
        } else {
            completionMessage = `Finished: All available members have been messaged. Total: ${sentCount}`;
            this.status = 'finished';
        }

        this.currentBroadcast.status = this.status;
        this.currentBroadcast.endTime = new Date().toISOString();
        await this.currentBroadcast.save();
        this.emitProgressUpdate();
        this.logToDashboard(completionMessage);
    }

    async checkGuildPresence(guildId) {
        const results = [];
        const botsData = await this.getActiveBots();

        for (const botData of botsData) {
            const client = this.clients.get(botData.token);
            let inGuild = false;

            if (client) {
                try {
                    await client.guilds.fetch(guildId);
                    inGuild = true;
                } catch {
                    inGuild = false;
                }
            }

            results.push({
                botId: botData._id,
                inGuild
            });
        }

        return results;
    }

    setIo(io) {
        this.io = io;
    }

    stopBroadcast() {
        if (this.status !== 'running') return;
        this.status = 'stopped';
        this.logToDashboard('Broadcast manually stopped by user.', null, true);
    }

    async resetStats() {
        await Bot.updateMany({}, { $set: { successCount: 0, failCount: 0, lastUsed: null } });
        await Broadcast.deleteMany({});
        await Recipient.deleteMany({});

        this.recipientCache.clear();
        this.recipientCacheLoaded = false;
        this.currentBroadcast = null;

        this.logToDashboard('Statistics and logs have been reset.');
        this.emitBotStatusChange();
        return true;
    }

    logToDashboard(message, botId = null, isError = false) {
        console.log(message);

        if (!this.io) return;

        this.io.emit('liveLog', {
            message,
            botId,
            isError,
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = new BotManager();
